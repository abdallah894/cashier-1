-- Operational reporting: store timezone and business day, daily / VAT /
-- refund / void reports, stock movement, valuation and aging reports, a
-- low-stock alert queue, supplier links and explained reorder suggestions.
--
-- BUSINESS DAY: a day runs from local midnight (plus the configured cutoff)
-- to the next, in the store timezone (default Africa/Cairo). The boundaries
-- are computed by PostgreSQL's tz database, so they are exact across the
-- Egyptian DST changes (a 23 h and a 25 h day each year) and consecutive
-- days tile the timeline with no gap or overlap.
--
-- GROSS vs NET: "gross" is what the customer paid (VAT-inclusive);
-- "net ex VAT" is the revenue after extracting VAT line by line, exactly as
-- create_sale does. Every column says which one it is.
--
-- COST: profit and valuation use the approved cost design (moving-average
-- products.cost, sale_items.unit_cost snapshot).

insert into public.audit_actions (action, target_type) values
  ('store_settings_changed', 'settings'),
  ('business_day_closed', 'business_day'),
  ('reorder_alert_handled', 'reorder_alert'),
  ('product_supplier_changed', 'product');

-- ---------- store settings ----------
create table public.store_settings (
  id boolean primary key default true check (id),
  timezone text not null default 'Africa/Cairo',
  business_day_cutoff_minutes integer not null default 0 check (business_day_cutoff_minutes between 0 and 1439),
  reorder_cover_days integer not null default 14 check (reorder_cover_days between 1 and 365),
  reorder_lookback_days integer not null default 28 check (reorder_lookback_days between 7 and 365),
  default_lead_time_days integer not null default 3 check (default_lead_time_days between 0 and 120)
);
insert into public.store_settings (id) values (true);
alter table public.store_settings enable row level security;
create policy "store settings: authenticated read" on public.store_settings for select to authenticated using (true);
-- No write policies: settings change through update_store_settings (audited).

create or replace function public.store_tz()
returns text
language sql stable security definer set search_path = ''
as $$ select timezone from public.store_settings where id; $$;

create or replace function public.business_cutoff()
returns interval
language sql stable security definer set search_path = ''
as $$ select business_day_cutoff_minutes * interval '1 minute' from public.store_settings where id; $$;

-- The business day a timestamp belongs to.
create or replace function public.business_day(ts timestamptz)
returns date
language sql stable set search_path = ''
as $$ select ((ts at time zone public.store_tz()) - public.business_cutoff())::date; $$;

-- The instant a business day starts.
create or replace function public.business_day_start(d date)
returns timestamptz
language sql stable set search_path = ''
as $$ select (d::timestamp + public.business_cutoff()) at time zone public.store_tz(); $$;

-- Inclusive instant range covering the days from..to.
create or replace function public.business_day_range(p_from_day date, p_to_day date)
returns table (range_start timestamptz, range_end timestamptz)
language sql stable set search_path = ''
as $$
  select public.business_day_start(p_from_day), public.business_day_start(p_to_day + 1) - interval '1 microsecond';
$$;

create or replace function public.update_store_settings(p jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := auth.uid(); v_keys integer := 0;
begin
  if v_actor is null or not public.is_admin() then raise exception 'settings: admin only'; end if;
  if p ? 'timezone' and not exists (select 1 from pg_catalog.pg_timezone_names where name = p->>'timezone') then
    raise exception 'settings: unknown timezone %', p->>'timezone';
  end if;
  update public.store_settings set
    timezone = coalesce(p->>'timezone', timezone),
    business_day_cutoff_minutes = coalesce((p->>'business_day_cutoff_minutes')::integer, business_day_cutoff_minutes),
    reorder_cover_days = coalesce((p->>'reorder_cover_days')::integer, reorder_cover_days),
    reorder_lookback_days = coalesce((p->>'reorder_lookback_days')::integer, reorder_lookback_days),
    default_lead_time_days = coalesce((p->>'default_lead_time_days')::integer, default_lead_time_days)
  where id;
  select count(*) into v_keys from jsonb_object_keys(p);
  perform public.write_audit_event(v_actor, null, 'store_settings_changed', 'settings', null,
    jsonb_build_object('item_count', v_keys), null);
end;
$$;

-- ---------- existing time series buckets by business day ----------
create or replace function public.report_sales_over_time(p_from timestamptz, p_to timestamptz, p_bucket text default 'day')
returns table (bucket_start timestamptz, revenue numeric, sale_count bigint, avg_basket numeric)
language plpgsql security definer set search_path = '' stable
as $$
begin
  perform public.reports_guard();
  if p_bucket not in ('day', 'week', 'month') then
    raise exception 'report_sales_over_time: bucket must be day, week or month';
  end if;
  -- bucket_start is the local business date at 00:00 UTC (a calendar date, not an instant),
  -- so formatting it in UTC always shows the right store-local date.
  return query
  select (date_trunc(p_bucket, public.business_day(s.created_at)::timestamp)::date)::timestamp at time zone 'UTC',
         coalesce(sum(s.total), 0)::numeric,
         count(*)::bigint,
         coalesce(round(sum(s.total)::numeric / nullif(count(*), 0)), 0)::numeric
  from public.sales s
  where s.created_at >= p_from and s.created_at <= p_to
  group by 1
  order by 1;
end;
$$;
grant execute on function public.report_sales_over_time(timestamptz, timestamptz, text) to authenticated, service_role;

-- ---------- daily summary ----------
create or replace function public.report_daily_summary(p_from_day date, p_to_day date)
returns table (
  day date, closed boolean, sale_count bigint,
  gross_sales numeric, discount_total numeric, promo_discount numeric, override_count bigint,
  net_sales_ex_vat numeric, vat_on_sales numeric,
  refund_count bigint, refunds_gross numeric, net_after_refunds_gross numeric,
  cash_net numeric, card_net numeric, void_count bigint, void_value numeric
)
language plpgsql security definer set search_path = '' stable
as $$
#variable_conflict use_column
declare v_from timestamptz; v_to timestamptz;
begin
  perform public.reports_guard();
  select r.range_start into v_from from public.business_day_range(p_from_day, p_from_day) r;
  select r.range_end into v_to from public.business_day_range(p_to_day, p_to_day) r;
  return query
  with days as (select g::date as day from generate_series(p_from_day, p_to_day, interval '1 day') g),
  s as (
    select public.business_day(sa.created_at) as day, count(*) as cnt, sum(sa.total) as gross, sum(sa.discount_total) as disc,
           sum(sa.subtotal) as net, sum(sa.tax_total) as vat
    from public.sales sa where sa.created_at between v_from and v_to group by 1
  ),
  promo as (
    select public.business_day(sa.created_at) as day, sum(sip.discount) as amt
    from public.sale_item_promotions sip
    join public.sale_items si on si.id = sip.sale_item_id
    join public.sales sa on sa.id = si.sale_id
    where sa.created_at between v_from and v_to group by 1
  ),
  ov as (
    select public.business_day(e.created_at) as day, count(*) as c
    from public.audit_events e where e.action = 'sale_discount_override' and e.created_at between v_from and v_to group by 1
  ),
  rf as (
    select public.business_day(r.created_at) as day, count(*) as c, sum(r.refund_total) as amt
    from public.returns r where r.created_at between v_from and v_to group by 1
  ),
  pay as (
    select public.business_day(p.created_at) as day,
           sum(case when p.tender = 'cash' then case p.direction when 'charge' then p.amount else -p.amount end else 0 end) as cash,
           sum(case when p.tender = 'card' then case p.direction when 'charge' then p.amount else -p.amount end else 0 end) as card
    from public.payments p where p.status = 'captured' and p.created_at between v_from and v_to group by 1
  ),
  vd as (
    select public.business_day(e.created_at) as day, count(*) as c, sum((e.metadata->>'amount')::numeric) as v
    from public.audit_events e where e.action = 'cart_void' and e.created_at between v_from and v_to group by 1
  )
  select days.day,
         exists (select 1 from public.business_days b where b.day = days.day),
         coalesce(s.cnt, 0)::bigint, coalesce(s.gross, 0)::numeric, coalesce(s.disc, 0)::numeric,
         coalesce(promo.amt, 0)::numeric, coalesce(ov.c, 0)::bigint,
         coalesce(s.net, 0)::numeric, coalesce(s.vat, 0)::numeric,
         coalesce(rf.c, 0)::bigint, coalesce(rf.amt, 0)::numeric, (coalesce(s.gross, 0) - coalesce(rf.amt, 0))::numeric,
         coalesce(pay.cash, 0)::numeric, coalesce(pay.card, 0)::numeric,
         coalesce(vd.c, 0)::bigint, coalesce(vd.v, 0)::numeric
  from days
  left join s on s.day = days.day
  left join promo on promo.day = days.day
  left join ov on ov.day = days.day
  left join rf on rf.day = days.day
  left join pay on pay.day = days.day
  left join vd on vd.day = days.day
  order by days.day;
end;
$$;

-- ---------- closing a business day ----------
create table public.business_days (
  day date primary key,
  closed_at timestamptz not null default now(),
  closed_by uuid not null references public.profiles(id) on delete restrict,
  sale_count bigint not null,
  gross_sales numeric not null,
  net_sales_ex_vat numeric not null,
  vat_on_sales numeric not null,
  discount_total numeric not null,
  refund_count bigint not null,
  refunds_gross numeric not null,
  cash_net numeric not null,
  card_net numeric not null,
  void_count bigint not null,
  void_value numeric not null
);
alter table public.business_days enable row level security;
create policy "business days: admins read" on public.business_days for select to authenticated using (public.is_admin());
create trigger business_days_immutable before update or delete on public.business_days
  for each row execute function public.reject_ledger_change();
create trigger business_days_no_truncate before truncate on public.business_days
  for each statement execute function public.reject_ledger_change();

create or replace function public.close_business_day(p_day date)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := auth.uid(); v_start timestamptz; v_end timestamptz; v public.business_days%rowtype; v_sum record;
begin
  if v_actor is null or not public.is_admin() then raise exception 'business day: admin only'; end if;
  if p_day >= public.business_day(now()) then raise exception 'business day: this day has not ended yet'; end if;
  if exists (select 1 from public.business_days where day = p_day) then raise exception 'business day: already closed'; end if;
  select r.range_start, r.range_end into v_start, v_end from public.business_day_range(p_day, p_day) r;
  if exists (select 1 from public.shifts where closed_at is null and opened_at >= v_start and opened_at <= v_end) then
    raise exception 'business day: shifts are still open for this day';
  end if;
  select * into v_sum from public.report_daily_summary(p_day, p_day);
  insert into public.business_days
    (day, closed_by, sale_count, gross_sales, net_sales_ex_vat, vat_on_sales, discount_total, refund_count, refunds_gross, cash_net, card_net, void_count, void_value)
  values
    (p_day, v_actor, v_sum.sale_count, v_sum.gross_sales, v_sum.net_sales_ex_vat, v_sum.vat_on_sales, v_sum.discount_total,
     v_sum.refund_count, v_sum.refunds_gross, v_sum.cash_net, v_sum.card_net, v_sum.void_count, v_sum.void_value);
  perform public.write_audit_event(v_actor, null, 'business_day_closed', 'business_day', null,
    jsonb_build_object('amount', v_sum.gross_sales, 'item_count', v_sum.sale_count), null);
end;
$$;

-- ---------- VAT ----------
create or replace function public.report_vat(p_from_day date, p_to_day date)
returns table (
  rate_bp integer, gross_sales numeric, net_sales numeric, vat_sales numeric,
  refund_gross numeric, refund_net numeric, refund_vat numeric, net_vat numeric, input_vat_purchases numeric
)
language plpgsql security definer set search_path = '' stable
as $$
#variable_conflict use_column
declare v_from timestamptz; v_to timestamptz;
begin
  perform public.reports_guard();
  select r.range_start into v_from from public.business_day_range(p_from_day, p_from_day) r;
  select r.range_end into v_to from public.business_day_range(p_to_day, p_to_day) r;
  return query
  with sr as (
    select round(si.tax_rate * 10000)::integer as rate, sum(si.line_total) as gross, sum(round(si.line_total / (1 + si.tax_rate))) as net
    from public.sale_items si join public.sales s on s.id = si.sale_id
    where s.created_at between v_from and v_to group by 1
  ),
  rr as (
    select round(ri.tax_rate * 10000)::integer as rate, sum(ri.line_refund_total) as gross, sum(round(ri.line_refund_total / (1 + ri.tax_rate))) as net
    from public.return_items ri join public.returns r on r.id = ri.return_id
    where r.created_at between v_from and v_to group by 1
  ),
  pr as (
    select round(gl.tax_rate * 10000)::integer as rate, sum(round(gl.qty * gl.unit_cost * gl.tax_rate)) as vat
    from public.goods_receipt_lines gl join public.goods_receipts g on g.id = gl.receipt_id
    where g.received_at between v_from and v_to group by 1
  ),
  rates as (select rate from sr union select rate from rr union select rate from pr)
  select rates.rate,
         coalesce(sr.gross, 0)::numeric, coalesce(sr.net, 0)::numeric, (coalesce(sr.gross, 0) - coalesce(sr.net, 0))::numeric,
         coalesce(rr.gross, 0)::numeric, coalesce(rr.net, 0)::numeric, (coalesce(rr.gross, 0) - coalesce(rr.net, 0))::numeric,
         ((coalesce(sr.gross, 0) - coalesce(sr.net, 0)) - (coalesce(rr.gross, 0) - coalesce(rr.net, 0)))::numeric,
         coalesce(pr.vat, 0)::numeric
  from rates
  left join sr on sr.rate = rates.rate
  left join rr on rr.rate = rates.rate
  left join pr on pr.rate = rates.rate
  order by rates.rate;
end;
$$;

-- ---------- refunds and voids ----------
create or replace function public.report_refunds_detail(p_from_day date, p_to_day date)
returns table (
  return_id uuid, return_number bigint, created_at timestamptz, day date, sale_number bigint,
  actor_name text, tender public.payment_method, refund_total numeric, restock boolean, reason text
)
language plpgsql security definer set search_path = '' stable
as $$
#variable_conflict use_column
declare v_from timestamptz; v_to timestamptz;
begin
  perform public.reports_guard();
  select r.range_start into v_from from public.business_day_range(p_from_day, p_from_day) r;
  select r.range_end into v_to from public.business_day_range(p_to_day, p_to_day) r;
  return query
  select rt.id, rt.return_number, rt.created_at, public.business_day(rt.created_at), s.sale_number,
         p.full_name, rt.refund_tender, rt.refund_total, rt.restock, rt.reason
  from public.returns rt
  join public.sales s on s.id = rt.sale_id
  join public.profiles p on p.id = rt.actor_id
  where rt.created_at between v_from and v_to
  order by rt.created_at desc;
end;
$$;

create or replace function public.report_voids_detail(p_from_day date, p_to_day date)
returns table (event_id uuid, created_at timestamptz, day date, actor_name text, item_count integer, amount numeric)
language plpgsql security definer set search_path = '' stable
as $$
#variable_conflict use_column
declare v_from timestamptz; v_to timestamptz;
begin
  perform public.reports_guard();
  select r.range_start into v_from from public.business_day_range(p_from_day, p_from_day) r;
  select r.range_end into v_to from public.business_day_range(p_to_day, p_to_day) r;
  return query
  select e.id, e.created_at, public.business_day(e.created_at), p.full_name,
         coalesce((e.metadata->>'item_count')::integer, 0), coalesce((e.metadata->>'amount')::numeric, 0)
  from public.audit_events e
  join public.profiles p on p.id = e.actor_id
  where e.action = 'cart_void' and e.created_at between v_from and v_to
  order by e.created_at desc;
end;
$$;

-- ---------- stock movement, valuation, aging ----------
create or replace function public.report_stock_movements(p_from_day date, p_to_day date)
returns table (
  product_id uuid, barcode text, name_ar text, name_en text,
  opening_qty numeric, received_qty numeric, sold_qty numeric, returned_qty numeric, adjusted_qty numeric, closing_qty numeric
)
language plpgsql security definer set search_path = '' stable
as $$
#variable_conflict use_column
declare v_from timestamptz; v_to timestamptz;
begin
  perform public.reports_guard();
  select r.range_start into v_from from public.business_day_range(p_from_day, p_from_day) r;
  select r.range_end into v_to from public.business_day_range(p_to_day, p_to_day) r;
  return query
  with agg as (
    select m.product_id as pid,
           coalesce(sum(m.qty_change) filter (where m.created_at >= v_from), 0) as since_from,
           coalesce(sum(m.qty_change) filter (where m.created_at > v_to), 0) as after_to,
           coalesce(sum(m.qty_change) filter (where m.created_at between v_from and v_to and m.reason = 'received'), 0) as received,
           coalesce(-sum(m.qty_change) filter (where m.created_at between v_from and v_to and m.reason = 'sale'), 0) as sold,
           coalesce(sum(m.qty_change) filter (where m.created_at between v_from and v_to and m.reason = 'return'), 0) as returned,
           coalesce(sum(m.qty_change) filter (where m.created_at between v_from and v_to and m.reason in ('correction', 'damaged')), 0) as adjusted,
           count(*) filter (where m.created_at between v_from and v_to) as in_range
    from public.stock_movements m group by m.product_id
  )
  select pr.id, pr.barcode, pr.name_ar, pr.name_en,
         pr.stock_qty - a.since_from, a.received, a.sold, a.returned, a.adjusted, pr.stock_qty - a.after_to
  from agg a join public.products pr on pr.id = a.pid
  where a.in_range > 0
  order by pr.name_en;
end;
$$;

create or replace function public.report_stock_valuation()
returns table (
  product_id uuid, barcode text, name_ar text, name_en text, category_id uuid, category_name_ar text, category_name_en text,
  qty numeric, unit_cost numeric, value_at_cost numeric, unit_price numeric, retail_value_gross numeric, retail_value_net numeric
)
language plpgsql security definer set search_path = '' stable
as $$
#variable_conflict use_column
begin
  perform public.reports_guard();
  return query
  select pr.id, pr.barcode, pr.name_ar, pr.name_en, pr.category_id, c.name_ar, c.name_en,
         pr.stock_qty, pr.cost, round(pr.stock_qty * pr.cost), pr.price,
         round(pr.stock_qty * pr.price), round(pr.stock_qty * pr.price / (1 + pr.tax_rate))
  from public.products pr left join public.categories c on c.id = pr.category_id
  where pr.active and pr.stock_qty > 0
  order by round(pr.stock_qty * pr.cost) desc, pr.name_en;
end;
$$;

-- Aging is measured as days since the product last sold: the system keeps a
-- moving-average cost, not cost layers, so batch age is not known.
create or replace function public.report_stock_aging(p_as_of_day date default null)
returns table (
  product_id uuid, barcode text, name_ar text, name_en text, qty numeric, value_at_cost numeric,
  last_received_at timestamptz, last_sold_at timestamptz, days_since_last_sale integer, bucket text
)
language plpgsql security definer set search_path = '' stable
as $$
#variable_conflict use_column
declare v_as_of date := coalesce(p_as_of_day, public.business_day(now()));
begin
  perform public.reports_guard();
  return query
  with last as (
    select m.product_id as pid,
           max(m.created_at) filter (where m.reason = 'received') as received,
           max(m.created_at) filter (where m.reason = 'sale') as sold
    from public.stock_movements m group by m.product_id
  ), base as (
    select pr.id as pid, pr.barcode, pr.name_ar, pr.name_en, pr.stock_qty, round(pr.stock_qty * pr.cost) as val,
           l.received, l.sold,
           case when l.sold is null then null else v_as_of - public.business_day(l.sold) end as days
    from public.products pr left join last l on l.pid = pr.id
    where pr.active and pr.stock_qty > 0
  )
  select b.pid, b.barcode, b.name_ar, b.name_en, b.stock_qty, b.val, b.received, b.sold, b.days,
         case when b.days is null then 'never_sold'
              when b.days <= 30 then '0-30' when b.days <= 60 then '31-60' when b.days <= 90 then '61-90' else '90+' end
  from base b
  order by b.val desc, b.name_en;
end;
$$;

-- ---------- supplier links ----------
create table public.product_suppliers (
  product_id uuid not null references public.products(id) on delete restrict,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  is_preferred boolean not null default false,
  supplier_sku text,
  lead_time_days integer check (lead_time_days >= 0),
  pack_size numeric(10,3) not null default 1 check (pack_size > 0),
  min_order_qty numeric(10,3) not null default 0 check (min_order_qty >= 0),
  unit_cost numeric(12,0) check (unit_cost >= 0),
  updated_at timestamptz not null default now(),
  primary key (product_id, supplier_id)
);
create unique index product_suppliers_one_preferred on public.product_suppliers (product_id) where is_preferred;
alter table public.product_suppliers enable row level security;
create policy "product suppliers: stock staff read" on public.product_suppliers for select to authenticated
  using (public.has_capability('stock.correct'));

create or replace function public.set_product_supplier(p jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := auth.uid(); v_product uuid := (p->>'product_id')::uuid; v_supplier uuid := (p->>'supplier_id')::uuid;
begin
  if v_actor is null or not public.is_admin() then raise exception 'supplier link: admin only'; end if;
  if not exists (select 1 from public.products where id = v_product) then raise exception 'supplier link: product not found'; end if;
  if not exists (select 1 from public.suppliers where id = v_supplier) then raise exception 'supplier link: supplier not found'; end if;
  if coalesce((p->>'is_preferred')::boolean, false) then
    update public.product_suppliers set is_preferred = false where product_id = v_product and supplier_id <> v_supplier;
  end if;
  insert into public.product_suppliers (product_id, supplier_id, is_preferred, supplier_sku, lead_time_days, pack_size, min_order_qty, unit_cost)
  values (v_product, v_supplier, coalesce((p->>'is_preferred')::boolean, false), nullif(btrim(coalesce(p->>'supplier_sku', '')), ''),
          (p->>'lead_time_days')::integer, coalesce((p->>'pack_size')::numeric, 1), coalesce((p->>'min_order_qty')::numeric, 0),
          (p->>'unit_cost')::numeric)
  on conflict (product_id, supplier_id) do update set
    is_preferred = excluded.is_preferred, supplier_sku = excluded.supplier_sku, lead_time_days = excluded.lead_time_days,
    pack_size = excluded.pack_size, min_order_qty = excluded.min_order_qty, unit_cost = excluded.unit_cost, updated_at = now();
  perform public.write_audit_event(v_actor, null, 'product_supplier_changed', 'product', v_product,
    jsonb_build_object('item_count', 1), null);
end;
$$;

-- ---------- low-stock alert queue ----------
create table public.reorder_alerts (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete restrict,
  status text not null default 'open' check (status in ('open', 'acknowledged', 'ordered', 'dismissed', 'resolved')),
  stock_qty_at_alert numeric(10,3) not null,
  threshold numeric(10,3) not null,
  po_id uuid references public.purchase_orders(id) on delete restrict,
  note text,
  opened_at timestamptz not null default now(),
  handled_by uuid references public.profiles(id) on delete restrict,
  handled_at timestamptz,
  resolved_at timestamptz
);
-- one live alert per product; a dismissed alert stays quiet until stock recovers
create unique index reorder_alerts_one_live on public.reorder_alerts (product_id)
  where status in ('open', 'acknowledged', 'ordered', 'dismissed');
alter table public.reorder_alerts enable row level security;
create policy "reorder alerts: stock staff read" on public.reorder_alerts for select to authenticated
  using (public.has_capability('stock.correct'));

create or replace function public.guard_reorder_alert()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then raise exception 'reorder_alerts is immutable (DELETE rejected)' using errcode = 'P0001'; end if;
  if old.status = 'resolved' then raise exception 'reorder_alerts is immutable once resolved' using errcode = 'P0001'; end if;
  if (new.id, new.product_id, new.stock_qty_at_alert, new.threshold, new.opened_at)
     is distinct from (old.id, old.product_id, old.stock_qty_at_alert, old.threshold, old.opened_at) then
    raise exception 'reorder_alerts is immutable (identity fields)' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger reorder_alerts_guard before update or delete on public.reorder_alerts
  for each row execute function public.guard_reorder_alert();

create or replace function public.reorder_alert_sync()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.active and new.stock_qty <= new.low_stock_threshold then
    insert into public.reorder_alerts (product_id, stock_qty_at_alert, threshold)
    values (new.id, new.stock_qty, new.low_stock_threshold)
    on conflict (product_id) where status in ('open', 'acknowledged', 'ordered', 'dismissed') do nothing;
  else
    update public.reorder_alerts set status = 'resolved', resolved_at = now()
    where product_id = new.id and status in ('open', 'acknowledged', 'ordered', 'dismissed');
  end if;
  return new;
end;
$$;
create trigger products_reorder_alert after update of stock_qty, low_stock_threshold, active on public.products
  for each row execute function public.reorder_alert_sync();

-- products that are already low when this ships
insert into public.reorder_alerts (product_id, stock_qty_at_alert, threshold)
select id, stock_qty, low_stock_threshold from public.products where active and stock_qty <= low_stock_threshold;

create or replace function public.refresh_reorder_alerts()
returns integer
language plpgsql security definer set search_path = ''
as $$
declare v_count integer;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'reorder: admin only'; end if;
  with ins as (
    insert into public.reorder_alerts (product_id, stock_qty_at_alert, threshold)
    select id, stock_qty, low_stock_threshold from public.products where active and stock_qty <= low_stock_threshold
    on conflict (product_id) where status in ('open', 'acknowledged', 'ordered', 'dismissed') do nothing
    returning 1
  ) select count(*) into v_count from ins;
  return v_count;
end;
$$;

create or replace function public.handle_reorder_alert(p_id uuid, p_action text, p_note text default null, p_po_id uuid default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := auth.uid(); v_alert public.reorder_alerts%rowtype; v_status text;
begin
  if v_actor is null or not public.has_capability('stock.correct') then raise exception 'reorder: capability required'; end if;
  select * into v_alert from public.reorder_alerts where id = p_id for update;
  if not found then raise exception 'reorder: alert not found'; end if;
  if v_alert.status = 'resolved' then raise exception 'reorder: alert is already resolved'; end if;
  v_status := case p_action when 'acknowledge' then 'acknowledged' when 'dismiss' then 'dismissed' when 'ordered' then 'ordered' else null end;
  if v_status is null then raise exception 'reorder: unknown action'; end if;
  if p_action = 'dismiss' and (p_note is null or length(btrim(p_note)) = 0) then raise exception 'reorder: a note is required to dismiss'; end if;
  if p_action = 'ordered' then
    if p_po_id is null or not exists (
      select 1 from public.purchase_order_lines where po_id = p_po_id and product_id = v_alert.product_id
    ) then
      raise exception 'reorder: choose an order that contains this product';
    end if;
  end if;
  update public.reorder_alerts
  set status = v_status, note = nullif(btrim(coalesce(p_note, '')), ''), po_id = coalesce(p_po_id, po_id),
      handled_by = v_actor, handled_at = now()
  where id = p_id;
  perform public.write_audit_event(v_actor, null, 'reorder_alert_handled', 'reorder_alert', p_id,
    jsonb_build_object('event_type', p_action), null);
end;
$$;

-- ---------- reorder suggestions that explain themselves ----------
create or replace function public.report_reorder_suggestions()
returns table (
  product_id uuid, barcode text, name_ar text, name_en text, unit public.product_unit,
  stock_qty numeric, low_stock_threshold numeric, avg_daily_sales numeric, days_of_cover numeric,
  lookback_days integer, lead_time_days integer, cover_days integer, on_order_qty numeric,
  pack_size numeric, min_order_qty numeric, suggested_qty numeric,
  supplier_id uuid, supplier_name text, unit_cost numeric, alert_id uuid, explanation text
)
language plpgsql security definer set search_path = '' stable
as $$
#variable_conflict use_column
declare v_lookback integer; v_cover integer; v_default_lead integer;
begin
  perform public.reports_guard();
  select reorder_lookback_days, reorder_cover_days, default_lead_time_days into v_lookback, v_cover, v_default_lead
  from public.store_settings where id;
  return query
  with sold as (
    select m.product_id as pid, greatest(-sum(m.qty_change), 0) as net_sold
    from public.stock_movements m
    where m.reason in ('sale', 'return') and m.created_at >= now() - v_lookback * interval '1 day'
    group by m.product_id
  ), on_po as (
    select l.product_id as pid, sum(l.ordered_qty - l.received_qty) as qty
    from public.purchase_order_lines l join public.purchase_orders o on o.id = l.po_id
    where o.status in ('ordered', 'partially_received') and l.received_qty < l.ordered_qty
    group by l.product_id
  ), pref as (
    select distinct on (ps.product_id) ps.product_id as pid, ps.supplier_id, s.name as supplier_name, ps.lead_time_days,
           ps.pack_size, ps.min_order_qty, ps.unit_cost
    from public.product_suppliers ps join public.suppliers s on s.id = ps.supplier_id
    order by ps.product_id, ps.is_preferred desc, s.name
  ), calc as (
    select pr.id as pid, pr.barcode, pr.name_ar, pr.name_en, pr.unit, pr.stock_qty, pr.low_stock_threshold,
           coalesce(so.net_sold, 0) / v_lookback as avg_daily,
           coalesce(po.qty, 0) as on_order,
           coalesce(pf.lead_time_days, v_default_lead) as lead,
           coalesce(pf.pack_size, 1) as pack, coalesce(pf.min_order_qty, 0) as min_qty,
           pf.supplier_id, pf.supplier_name, coalesce(pf.unit_cost, pr.cost) as unit_cost
    from public.products pr
    left join sold so on so.pid = pr.id
    left join on_po po on po.pid = pr.id
    left join pref pf on pf.pid = pr.id
    where pr.active
  ), need as (
    select c.*, c.avg_daily * (c.lead + v_cover) + c.low_stock_threshold - c.stock_qty - c.on_order as shortfall
    from calc c
  )
  select n.pid, n.barcode, n.name_ar, n.name_en, n.unit, n.stock_qty, n.low_stock_threshold,
         round(n.avg_daily, 4),
         case when n.avg_daily > 0 then round(n.stock_qty / n.avg_daily, 1) end,
         v_lookback, n.lead::integer, v_cover, n.on_order, n.pack, n.min_qty,
         (case when n.shortfall > 0 then greatest(ceil(n.shortfall / n.pack) * n.pack, n.min_qty) else 0 end)::numeric,
         n.supplier_id, n.supplier_name, n.unit_cost,
         (select a.id from public.reorder_alerts a where a.product_id = n.pid and a.status <> 'resolved' limit 1),
         format('Sells %s/day over the last %s days. Stock %s%s. Need %s/day x (%s days lead + %s days cover) = %s, plus safety stock %s, minus stock %s and %s already on order = %s short; rounded up to packs of %s%s = order %s.',
                round(n.avg_daily, 2), v_lookback, n.stock_qty,
                case when n.avg_daily > 0 then format(' (lasts %s days)', round(n.stock_qty / n.avg_daily, 1)) else '' end,
                round(n.avg_daily, 2), n.lead, v_cover, round(n.avg_daily * (n.lead + v_cover), 2), n.low_stock_threshold,
                n.stock_qty, n.on_order, round(n.shortfall, 2), n.pack,
                case when n.min_qty > 0 then format(', minimum order %s', n.min_qty) else '' end,
                (case when n.shortfall > 0 then greatest(ceil(n.shortfall / n.pack) * n.pack, n.min_qty) else 0 end))
  from need n
  where n.shortfall > 0
    and (n.stock_qty <= n.low_stock_threshold or (n.avg_daily > 0 and n.stock_qty / n.avg_daily < n.lead))
  order by (case when n.avg_daily > 0 then n.stock_qty / n.avg_daily end) nulls last, n.name_en;
end;
$$;

revoke execute on function
  public.store_tz(), public.business_cutoff(), public.business_day(timestamptz), public.business_day_start(date),
  public.business_day_range(date, date), public.update_store_settings(jsonb),
  public.report_daily_summary(date, date), public.close_business_day(date), public.report_vat(date, date),
  public.report_refunds_detail(date, date), public.report_voids_detail(date, date),
  public.report_stock_movements(date, date), public.report_stock_valuation(), public.report_stock_aging(date),
  public.set_product_supplier(jsonb), public.refresh_reorder_alerts(),
  public.handle_reorder_alert(uuid, text, text, uuid), public.report_reorder_suggestions()
from public, anon;
grant execute on function
  public.store_tz(), public.business_cutoff(), public.business_day(timestamptz), public.business_day_start(date),
  public.business_day_range(date, date), public.update_store_settings(jsonb),
  public.report_daily_summary(date, date), public.close_business_day(date), public.report_vat(date, date),
  public.report_refunds_detail(date, date), public.report_voids_detail(date, date),
  public.report_stock_movements(date, date), public.report_stock_valuation(), public.report_stock_aging(date),
  public.set_product_supplier(jsonb), public.refresh_reorder_alerts(),
  public.handle_reorder_alert(uuid, text, text, uuid), public.report_reorder_suggestions()
to authenticated, service_role;
