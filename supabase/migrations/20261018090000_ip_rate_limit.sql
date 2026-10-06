-- Phase 2: rate limit for routes that have no signed-in user (ops cron/alerts,
-- backup reports, payment webhook). Same fixed-window counter and table as
-- consume_rate_limit, but keyed by a caller-supplied opaque key (the app passes
-- scope + a SHA-256 of the client IP, never the raw address). Service role only.
create or replace function public.consume_ip_rate_limit(p_key text, p_limit integer, p_window_seconds integer)
returns table (allowed boolean, remaining integer, retry_after_seconds integer)
language plpgsql security definer set search_path = ''
as $$
declare
  v_bucket timestamptz;
  v_count integer;
begin
  if p_key is null or length(btrim(p_key)) = 0 or length(p_key) > 100
     or p_limit is null or p_limit < 1 or p_limit > 100000
     or p_window_seconds is null or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'rate limit: invalid arguments';
  end if;
  v_bucket := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into public.rate_limits as r (key, window_start, count)
  values ('ip:' || p_key, v_bucket, 1)
  on conflict (key, window_start) do update set count = r.count + 1
  returning r.count into v_count;
  if random() < 0.01 then
    delete from public.rate_limits where window_start < now() - interval '2 days';
  end if;
  return query select v_count <= p_limit, greatest(p_limit - v_count, 0),
                      ceil(extract(epoch from (v_bucket + p_window_seconds * interval '1 second' - now())))::integer;
end;
$$;
revoke execute on function public.consume_ip_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_ip_rate_limit(text, integer, integer) to service_role;
