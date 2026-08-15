-- ============================================================
-- Phase 6 — Reporting aggregation (admin-only)
--
-- All aggregation lives in SQL (GROUP BY), never in JS: the
-- dashboard must stay fast as the sales table grows.
--
-- Every function is SECURITY DEFINER (so it can read across all
-- cashiers' sales) and therefore MUST self-guard with is_admin() —
-- a cashier calling one gets 42501, same as an RLS denial.
--
-- Money stays integer piasters. Two revenue conventions, kept
-- explicit per function:
--   * "revenue" on the dashboard/cashier/product views = GROSS,
--     VAT-inclusive, what the customer paid (sales.total /
--     sale_items.line_total).
--   * report_profit uses NET revenue (VAT extracted) vs cost,
--     because VAT is not the store's money.
--
-- Date bounds: p_from/p_to are timestamptz, filtered on
-- sales.created_at. Callers pass UTC day edges (see
-- lib/supabase/queries/reports.ts). Bucketing uses date_trunc in
-- the DB session TZ, which is UTC on Supabase — good enough until
-- a store-timezone setting exists (Cairo is UTC+2/+3), mirroring
-- the same note in lib/supabase/queries/sales.ts.
--
-- COST CAVEAT: sale_items snapshots name/price/tax_rate but NOT
-- cost. report_profit therefore joins the CURRENT products.cost to
-- historical sales — so editing a product's cost retroactively
-- shifts past profit. Fully-historical profit would need a cost
-- snapshot column on sale_items (a future migration).
-- ============================================================

create or replace function public.reports_guard()
returns void
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  if not public.is_admin() then
    raise exception 'reports: admin only' using errcode = '42501';
  end if;
end;
$$;

-- ---------- Summary cards: revenue / sale count / avg basket ----------

create or replace function public.report_summary(
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  revenue numeric,     -- piasters, gross (VAT-inclusive)
  sale_count bigint,
  avg_basket numeric   -- piasters, revenue / sale_count, rounded
)
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  perform public.reports_guard();
  return query
  select
    coalesce(sum(s.total), 0)::numeric,
    count(*)::bigint,
    coalesce(round(sum(s.total)::numeric / nullif(count(*), 0)), 0)::numeric
  from public.sales s
  where s.created_at >= p_from and s.created_at <= p_to;
end;
$$;

-- ---------- Sales over time (day / week / month buckets) ----------

create or replace function public.report_sales_over_time(
  p_from timestamptz,
  p_to timestamptz,
  p_bucket text default 'day'
)
returns table (
  bucket_start timestamptz,
  revenue numeric,      -- piasters, gross
  sale_count bigint,
  avg_basket numeric    -- piasters
)
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  perform public.reports_guard();
  if p_bucket not in ('day', 'week', 'month') then
    raise exception 'report_sales_over_time: bucket must be day, week or month';
  end if;
  return query
  select
    date_trunc(p_bucket, s.created_at) as bucket_start,
    coalesce(sum(s.total), 0)::numeric,
    count(*)::bigint,
    coalesce(round(sum(s.total)::numeric / nullif(count(*), 0)), 0)::numeric
  from public.sales s
  where s.created_at >= p_from and s.created_at <= p_to
  group by 1
  order by 1;
end;
$$;

-- ---------- Top products (by revenue or by quantity) ----------

create or replace function public.report_top_products(
  p_from timestamptz,
  p_to timestamptz,
  p_by text default 'revenue',
  p_limit int default 10
)
returns table (
  product_id uuid,
  name_ar text,
  name_en text,
  qty numeric,        -- units / kg sold
  revenue numeric     -- piasters, gross (line_total, discount applied)
)
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  perform public.reports_guard();
  if p_by not in ('revenue', 'qty') then
    raise exception 'report_top_products: p_by must be revenue or qty';
  end if;
  return query
  select
    si.product_id,
    -- name from the latest snapshot in range (products may have been renamed)
    (array_agg(si.name_ar order by si.created_at desc))[1],
    (array_agg(si.name_en order by si.created_at desc))[1],
    coalesce(sum(si.qty), 0)::numeric,
    coalesce(sum(si.line_total), 0)::numeric
  from public.sale_items si
  join public.sales s on s.id = si.sale_id
  where s.created_at >= p_from and s.created_at <= p_to
  group by si.product_id
  order by
    case when p_by = 'qty' then sum(si.qty) else sum(si.line_total) end desc
  limit greatest(p_limit, 1);
end;
$$;

-- ---------- Sales by category ----------
-- Category is the product's CURRENT category (sale_items don't snapshot
-- it); products with a since-cleared category fall into "Uncategorized"
-- (null id) — the UI labels that.

create or replace function public.report_sales_by_category(
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  category_id uuid,
  name_ar text,
  name_en text,
  qty numeric,
  revenue numeric     -- piasters, gross
)
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  perform public.reports_guard();
  return query
  select
    c.id,
    c.name_ar,
    c.name_en,
    coalesce(sum(si.qty), 0)::numeric,
    coalesce(sum(si.line_total), 0)::numeric
  from public.sale_items si
  join public.sales s on s.id = si.sale_id
  join public.products p on p.id = si.product_id
  left join public.categories c on c.id = p.category_id
  where s.created_at >= p_from and s.created_at <= p_to
  group by c.id, c.name_ar, c.name_en
  order by sum(si.line_total) desc;
end;
$$;

-- ---------- Sales by cashier ----------

create or replace function public.report_sales_by_cashier(
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  cashier_id uuid,
  full_name text,
  revenue numeric,    -- piasters, gross
  sale_count bigint
)
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  perform public.reports_guard();
  return query
  select
    pr.id,
    pr.full_name,
    coalesce(sum(s.total), 0)::numeric,
    count(*)::bigint
  from public.sales s
  join public.profiles pr on pr.id = s.cashier_id
  where s.created_at >= p_from and s.created_at <= p_to
  group by pr.id, pr.full_name
  order by sum(s.total) desc;
end;
$$;

-- ---------- Profit (net revenue vs cost) ----------
-- net = VAT extracted from each line's gross total, per line's snapshot
-- tax_rate — matches create_sale's round(gross / (1 + tax_rate)).
-- cost = current products.cost × qty (see COST CAVEAT at top of file).

create or replace function public.report_profit(
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  net_revenue numeric,  -- piasters, VAT excluded
  cost numeric,         -- piasters
  profit numeric,       -- piasters, net_revenue - cost
  margin numeric        -- fraction: profit / net_revenue (0..1), null if no revenue
)
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_net numeric;
  v_cost numeric;
begin
  perform public.reports_guard();
  select
    coalesce(sum(round(si.line_total / (1 + si.tax_rate))), 0),
    coalesce(sum(round(p.cost * si.qty)), 0)
  into v_net, v_cost
  from public.sale_items si
  join public.sales s on s.id = si.sale_id
  join public.products p on p.id = si.product_id
  where s.created_at >= p_from and s.created_at <= p_to;

  return query
  select
    v_net,
    v_cost,
    (v_net - v_cost)::numeric,
    case when v_net > 0 then round((v_net - v_cost) / v_net, 4) end;
end;
$$;

-- Admin-only, but callable by any authenticated user because the guard
-- lives inside each function; anon is blocked outright.
revoke execute on function
  public.reports_guard(),
  public.report_summary(timestamptz, timestamptz),
  public.report_sales_over_time(timestamptz, timestamptz, text),
  public.report_top_products(timestamptz, timestamptz, text, int),
  public.report_sales_by_category(timestamptz, timestamptz),
  public.report_sales_by_cashier(timestamptz, timestamptz),
  public.report_profit(timestamptz, timestamptz)
  from public, anon;

grant execute on function
  public.report_summary(timestamptz, timestamptz),
  public.report_sales_over_time(timestamptz, timestamptz, text),
  public.report_top_products(timestamptz, timestamptz, text, int),
  public.report_sales_by_category(timestamptz, timestamptz),
  public.report_sales_by_cashier(timestamptz, timestamptz),
  public.report_profit(timestamptz, timestamptz)
  to authenticated, service_role;
