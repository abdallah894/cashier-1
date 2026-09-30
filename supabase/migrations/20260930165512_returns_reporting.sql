-- Keep return effects explicit: historic gross sales remain unchanged while
-- refunds and net sales are reported as separate auditable figures.

drop function public.report_summary(timestamptz, timestamptz);

create function public.report_summary(
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  revenue numeric,
  refunds numeric,
  net_revenue numeric,
  sale_count bigint,
  avg_basket numeric
)
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  perform public.reports_guard();
  return query
  with sales_total as (
    select coalesce(sum(s.total), 0)::numeric as gross, count(*)::bigint as count
    from public.sales s
    where s.created_at >= p_from and s.created_at <= p_to
  ), refund_total as (
    select coalesce(sum(r.refund_total), 0)::numeric as refunds
    from public.returns r
    where r.created_at >= p_from and r.created_at <= p_to
  )
  select
    sales_total.gross,
    refund_total.refunds,
    sales_total.gross - refund_total.refunds,
    sales_total.count,
    coalesce(round(sales_total.gross / nullif(sales_total.count, 0)), 0)::numeric
  from sales_total cross join refund_total;
end;
$$;

revoke execute on function public.report_summary(timestamptz, timestamptz) from public, anon;
grant execute on function public.report_summary(timestamptz, timestamptz) to authenticated, service_role;
