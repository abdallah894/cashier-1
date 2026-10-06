-- Phase 2 deployment: the alert check now runs every 30 minutes (GitHub Actions on the free
-- plan, see .github/workflows/ops-cron.yml) instead of every 15 on Vercel Cron. The two
-- "recent failures" rules looked back only 15 minutes, so a burst between two runs could
-- have gone unseen: they now look back 30 minutes, the polling interval. Thresholds unchanged.
create or replace function public.ops_alerts()
returns table (alert text, severity text, detail text, since timestamptz)
language plpgsql security definer set search_path = '' stable
as $$
#variable_conflict use_column
declare v_last_ok timestamptz; v_last record; v_count integer; v_first timestamptz;
begin
  -- checkout failures (system errors, not business rejections such as insufficient stock)
  select count(*), min(created_at) into v_count, v_first from public.ops_events
  where kind = 'checkout_failed' and created_at > now() - interval '30 minutes';
  if v_count >= 3 then
    return query select 'checkout_failures'::text, 'critical'::text, v_count || ' checkout failures in the last 30 minutes', v_first;
  end if;

  select count(*), min(created_at) into v_count, v_first from public.ops_events
  where kind = 'rpc_failed' and created_at > now() - interval '30 minutes';
  if v_count >= 5 then
    return query select 'rpc_failures'::text, 'warning'::text, v_count || ' database call failures in the last 30 minutes', v_first;
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

  -- tax-authority e-receipts (only when the feature is switched on)
  if (select eta_enabled from public.store_settings where id) then
    select count(*), min(created_at) into v_count, v_first from public.eta_submissions
    where status in ('queued', 'submitting') and created_at < now() - interval '30 minutes';
    if v_count > 0 then
      return query select 'eta_backlog'::text, 'warning'::text, v_count || ' receipt(s) waiting over 30 minutes to be sent to the tax authority', v_first;
    end if;
    select count(*), min(updated_at) into v_count, v_first from public.eta_submissions where status in ('rejected', 'failed');
    if v_count > 0 then
      return query select 'eta_rejected'::text, 'critical'::text, v_count || ' receipt(s) were rejected by or could not be sent to the tax authority', v_first;
    end if;
  end if;
end;
$$;
