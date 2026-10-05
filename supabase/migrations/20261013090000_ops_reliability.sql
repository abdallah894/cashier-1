-- Production reliability: database-backed rate limiting (works across
-- serverless instances), an append-only operational event log, backup run
-- history, alert rules that an external poller turns into notifications, and
-- integrity checks to run after any restore.
--
-- Nothing here stores secrets: ops events reject any detail key that looks
-- like a PIN, token, password, API key, cookie or card field.

-- ---------- rate limiting ----------
create table public.rate_limits (
  key text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (key, window_start)
);
alter table public.rate_limits enable row level security;
-- No policies: only consume_rate_limit (security definer) touches it.

-- Fixed-window counter per (user, scope). Atomic upsert, so concurrent
-- requests from several instances cannot slip past the limit.
create or replace function public.consume_rate_limit(p_scope text, p_limit integer, p_window_seconds integer)
returns table (allowed boolean, remaining integer, retry_after_seconds integer)
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_bucket timestamptz;
  v_count integer;
begin
  if v_user is null then raise exception 'rate limit: not authenticated'; end if;
  if p_scope is null or length(btrim(p_scope)) = 0 or length(p_scope) > 40
     or p_limit is null or p_limit < 1 or p_limit > 100000
     or p_window_seconds is null or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'rate limit: invalid arguments';
  end if;
  v_bucket := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into public.rate_limits as r (key, window_start, count)
  values (v_user::text || ':' || p_scope, v_bucket, 1)
  on conflict (key, window_start) do update set count = r.count + 1
  returning r.count into v_count;
  if random() < 0.01 then
    delete from public.rate_limits where window_start < now() - interval '2 days';
  end if;
  return query select v_count <= p_limit, greatest(p_limit - v_count, 0),
                      ceil(extract(epoch from (v_bucket + p_window_seconds * interval '1 second' - now())))::integer;
end;
$$;

-- ---------- operational events ----------
create or replace function public.jsonb_has_sensitive_key(p jsonb)
returns boolean
language plpgsql immutable set search_path = ''
as $$
declare k text; v jsonb;
begin
  if p is null then return false; end if;
  if jsonb_typeof(p) = 'object' then
    for k, v in select key, value from jsonb_each(p) loop
      if k ~* '(pin|token|secret|passw|authoriz|api.?key|cookie|card|pan$|cvv|credential)' then return true; end if;
      if public.jsonb_has_sensitive_key(v) then return true; end if;
    end loop;
  elsif jsonb_typeof(p) = 'array' then
    for v in select value from jsonb_array_elements(p) loop
      if public.jsonb_has_sensitive_key(v) then return true; end if;
    end loop;
  end if;
  return false;
end;
$$;

create table public.ops_events (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('checkout_failed', 'rpc_failed', 'sync_backlog', 'ai_provider_down', 'alert_sent')),
  severity text not null default 'warning' check (severity in ('info', 'warning', 'critical')),
  actor_id uuid,
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  created_at timestamptz not null default now()
);
create index ops_events_kind_idx on public.ops_events (kind, created_at desc);
alter table public.ops_events enable row level security;
create policy "ops events: admins read" on public.ops_events for select to authenticated using (public.is_admin());
create trigger ops_events_immutable before update or delete on public.ops_events
  for each row execute function public.reject_ledger_change();
create trigger ops_events_no_truncate before truncate on public.ops_events
  for each statement execute function public.reject_ledger_change();

-- Server-side recording (service role only).
create or replace function public.record_ops_event(p_kind text, p_severity text, p_detail jsonb default '{}'::jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if p_kind not in ('checkout_failed', 'rpc_failed', 'sync_backlog', 'ai_provider_down', 'alert_sent')
     or p_severity not in ('info', 'warning', 'critical') then
    raise exception 'ops: invalid event';
  end if;
  if public.jsonb_has_sensitive_key(p_detail) then raise exception 'ops: detail contains a sensitive key'; end if;
  insert into public.ops_events (kind, severity, detail) values (p_kind, p_severity, coalesce(p_detail, '{}'::jsonb));
end;
$$;

-- A till reports its offline-queue state (any signed-in user, own data only).
create or replace function public.report_client_health(p_queued integer, p_rejected integer, p_oldest_age_seconds integer)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'ops: not authenticated'; end if;
  if p_queued is null or p_queued < 0 or p_queued > 100000
     or p_rejected is null or p_rejected < 0 or p_rejected > 100000
     or p_oldest_age_seconds is null or p_oldest_age_seconds < 0 or p_oldest_age_seconds > 31536000 then
    raise exception 'ops: invalid health report';
  end if;
  insert into public.ops_events (kind, severity, actor_id, detail)
  values ('sync_backlog', case when p_rejected > 0 then 'warning' else 'info' end, auth.uid(),
          jsonb_build_object('queued', p_queued, 'rejected', p_rejected, 'oldest_age_seconds', p_oldest_age_seconds));
end;
$$;

-- ---------- backups ----------
create table public.backup_runs (
  id uuid primary key default gen_random_uuid(),
  status text not null check (status in ('ok', 'failed')),
  started_at timestamptz,
  finished_at timestamptz not null default now(),
  size_bytes bigint check (size_bytes >= 0),
  location text,
  detail text,
  created_at timestamptz not null default now()
);
create index backup_runs_finished_idx on public.backup_runs (finished_at desc);
alter table public.backup_runs enable row level security;
create policy "backup runs: admins read" on public.backup_runs for select to authenticated using (public.is_admin());
create trigger backup_runs_immutable before update or delete on public.backup_runs
  for each row execute function public.reject_ledger_change();
create trigger backup_runs_no_truncate before truncate on public.backup_runs
  for each statement execute function public.reject_ledger_change();

create or replace function public.record_backup_run(p_status text, p_size_bytes bigint, p_location text, p_detail text, p_started_at timestamptz)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if p_status not in ('ok', 'failed') then raise exception 'backup: invalid status'; end if;
  insert into public.backup_runs (status, started_at, size_bytes, location, detail)
  values (p_status, p_started_at, p_size_bytes, left(p_location, 120), left(p_detail, 500));
end;
$$;

-- ---------- alert rules ----------
-- Evaluated by the poller (/api/ops/check) with the service role.
create or replace function public.ops_alerts()
returns table (alert text, severity text, detail text, since timestamptz)
language plpgsql security definer set search_path = '' stable
as $$
#variable_conflict use_column
declare v_last_ok timestamptz; v_last record; v_count integer; v_first timestamptz;
begin
  -- checkout failures (system errors, not business rejections such as insufficient stock)
  select count(*), min(created_at) into v_count, v_first from public.ops_events
  where kind = 'checkout_failed' and created_at > now() - interval '15 minutes';
  if v_count >= 3 then
    return query select 'checkout_failures'::text, 'critical'::text, v_count || ' checkout failures in the last 15 minutes', v_first;
  end if;

  select count(*), min(created_at) into v_count, v_first from public.ops_events
  where kind = 'rpc_failed' and created_at > now() - interval '15 minutes';
  if v_count >= 5 then
    return query select 'rpc_failures'::text, 'warning'::text, v_count || ' database call failures in the last 15 minutes', v_first;
  end if;

  -- offline-queue backlog: the latest report of each till in the last 30 minutes
  select count(*), min(e.created_at) into v_count, v_first from (
    select distinct on (actor_id) actor_id, created_at, detail
    from public.ops_events
    where kind = 'sync_backlog' and created_at > now() - interval '30 minutes'
    order by actor_id, created_at desc
  ) e
  where (e.detail->>'queued')::integer >= 20
     or (e.detail->>'rejected')::integer > 0
     or (e.detail->>'oldest_age_seconds')::integer >= 900;
  if v_count > 0 then
    return query select 'sync_backlog'::text, 'warning'::text, v_count || ' till(s) report unsynced or rejected sales', v_first;
  end if;

  -- backups
  select finished_at into v_last_ok from public.backup_runs where status = 'ok' order by finished_at desc limit 1;
  select status, finished_at into v_last from public.backup_runs order by finished_at desc limit 1;
  if v_last.status = 'failed' then
    return query select 'backup_failed'::text, 'critical'::text, 'the most recent backup failed', v_last.finished_at;
  end if;
  if v_last_ok is null or v_last_ok < now() - interval '26 hours' then
    return query select 'backup_overdue'::text, 'critical'::text,
      case when v_last_ok is null then 'no successful backup has been recorded' else 'no successful backup in the last 26 hours' end, v_last_ok;
  end if;

  -- payments that need a human
  select count(*), min(created_at) into v_count, v_first from public.payments
  where resolved_at is null and created_at < now() - interval '15 minutes'
    and ((direction = 'charge' and status in ('pending', 'authorized'))
      or (direction = 'charge' and status = 'captured' and sale_id is null));
  if v_count > 0 then
    return query select 'payments_stuck'::text, 'warning'::text, v_count || ' payment(s) pending or without a sale for over 15 minutes', v_first;
  end if;
end;
$$;

-- ---------- integrity checks (run after any restore) ----------
create or replace function public.verify_database_integrity()
returns table (check_name text, ok boolean, detail text)
language plpgsql security definer set search_path = '' stable
as $$
#variable_conflict use_column
declare v_bad bigint;
begin
  select count(*) into v_bad from public.sales s
  where s.total <> coalesce((select sum(si.line_total) from public.sale_items si where si.sale_id = s.id), 0);
  return query select 'sale_totals_match_lines'::text, v_bad = 0, v_bad || ' sale(s) differ from the sum of their lines';

  select count(*) into v_bad from public.sales s
  where s.total <> coalesce((select sum(p.amount) from public.payments p
                             where p.sale_id = s.id and p.direction = 'charge' and p.status = 'captured'), 0);
  return query select 'sale_totals_match_payments'::text, v_bad = 0, v_bad || ' sale(s) differ from their captured payments';

  select count(*) into v_bad from public.returns r
  where r.refund_total <> coalesce((select sum(ri.line_refund_total) from public.return_items ri where ri.return_id = r.id), 0);
  return query select 'return_totals_match_lines'::text, v_bad = 0, v_bad || ' return(s) differ from their lines';

  select count(*) into v_bad from public.products where stock_qty < 0;
  return query select 'no_negative_stock'::text, v_bad = 0, v_bad || ' product(s) have negative stock';

  select count(*) into v_bad from public.payments
  where direction = 'charge' and status = 'captured' and sale_id is null and resolved_at is null and created_at < now() - interval '1 hour';
  return query select 'no_unlinked_captured_payments'::text, v_bad = 0, v_bad || ' captured payment(s) without a sale';

  select count(*) into v_bad from public.business_days b
  where b.sale_count <> (select count(*) from public.sales s where public.business_day(s.created_at) = b.day)
     or b.gross_sales <> coalesce((select sum(s.total) from public.sales s where public.business_day(s.created_at) = b.day), 0);
  return query select 'closed_days_match_sales'::text, v_bad = 0, v_bad || ' closed business day(s) no longer match their sales';
end;
$$;

revoke execute on function
  public.consume_rate_limit(text, integer, integer),
  public.jsonb_has_sensitive_key(jsonb),
  public.record_ops_event(text, text, jsonb),
  public.report_client_health(integer, integer, integer),
  public.record_backup_run(text, bigint, text, text, timestamptz),
  public.ops_alerts(),
  public.verify_database_integrity()
from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer) to authenticated, service_role;
grant execute on function public.report_client_health(integer, integer, integer) to authenticated, service_role;
grant execute on function
  public.jsonb_has_sensitive_key(jsonb),
  public.record_ops_event(text, text, jsonb),
  public.record_backup_run(text, bigint, text, text, timestamptz),
  public.ops_alerts(),
  public.verify_database_integrity()
to service_role;
