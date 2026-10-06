-- Phase 1.1: tax-authority e-receipt QUEUE (infrastructure only).
--
-- Every sale and return is queued for submission AFTER it commits, so a
-- tax-portal outage can never stop the till. This migration deliberately knows
-- nothing about the authority's document format, signing or credentials: a
-- provider (lib/eta/) turns a queued row into a submission. Off by default
-- (store_settings.eta_enabled); see docs/eta.md for what is still missing.

alter table public.store_settings add column eta_enabled boolean not null default false;

create table public.eta_submissions (
  id uuid primary key default gen_random_uuid(),
  document_kind text not null check (document_kind in ('sale', 'return')),
  sale_id uuid references public.sales(id) on delete restrict,
  return_id uuid references public.returns(id) on delete restrict,
  -- queued -> submitting -> accepted | rejected (the authority refused it) | failed (retries exhausted)
  status text not null default 'queued' check (status in ('queued', 'submitting', 'accepted', 'rejected', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  claimed_at timestamptz,
  eta_uuid text check (eta_uuid is null or length(eta_uuid) <= 100),
  submission_id text check (submission_id is null or length(submission_id) <= 100),
  last_error text check (last_error is null or length(last_error) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((document_kind = 'sale' and sale_id is not null and return_id is null)
      or (document_kind = 'return' and return_id is not null and sale_id is null))
);
create unique index eta_submissions_sale_key on public.eta_submissions (sale_id) where sale_id is not null;
create unique index eta_submissions_return_key on public.eta_submissions (return_id) where return_id is not null;
create index eta_submissions_due_idx on public.eta_submissions (status, next_attempt_at);

alter table public.eta_submissions enable row level security;
create policy "eta submissions: admin read" on public.eta_submissions for select to authenticated using (public.is_admin());
-- no write policies: only the service-role worker changes rows (functions below)

-- Enqueue inside the sale/return transaction: one cheap insert, no network.
create or replace function public.eta_enqueue_document()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not coalesce((select eta_enabled from public.store_settings where id), false) then return new; end if;
  if tg_table_name = 'sales' then
    insert into public.eta_submissions (document_kind, sale_id) values ('sale', new.id) on conflict do nothing;
  else
    insert into public.eta_submissions (document_kind, return_id) values ('return', new.id) on conflict do nothing;
  end if;
  return new;
end;
$$;
create trigger sales_eta_enqueue after insert on public.sales for each row execute function public.eta_enqueue_document();
create trigger returns_eta_enqueue after insert on public.returns for each row execute function public.eta_enqueue_document();

-- Worker API (service role only).
-- Claims due rows; rows stuck in "submitting" for 10 minutes (a crashed worker) go back in the queue first.
create or replace function public.eta_claim_batch(p_limit integer default 20)
returns setof public.eta_submissions
language plpgsql security definer set search_path = ''
as $$
begin
  update public.eta_submissions set status = 'queued', updated_at = now()
   where status = 'submitting' and claimed_at < now() - interval '10 minutes';
  return query
    with picked as (
      select id from public.eta_submissions
       where status = 'queued' and next_attempt_at <= now()
       order by created_at
       limit greatest(1, least(coalesce(p_limit, 20), 100))
         for update skip locked
    )
    update public.eta_submissions e
       set status = 'submitting', claimed_at = now(), attempts = e.attempts + 1, updated_at = now()
      from picked
     where e.id = picked.id
    returning e.*;
end;
$$;

-- outcome: accepted | rejected (permanent, needs a human) | retry (temporary; backs off, gives up after 8 attempts)
create or replace function public.eta_record_result(
  p_id uuid, p_outcome text, p_eta_uuid text default null, p_submission_id text default null, p_error text default null
)
returns public.eta_submissions
language plpgsql security definer set search_path = ''
as $$
declare v_row public.eta_submissions%rowtype;
begin
  if p_outcome not in ('accepted', 'rejected', 'retry') then raise exception 'eta: unknown outcome'; end if;
  select * into v_row from public.eta_submissions where id = p_id for update;
  if not found then raise exception 'eta: submission not found'; end if;
  if v_row.status <> 'submitting' then raise exception 'eta: submission is not in progress'; end if;
  update public.eta_submissions set
    status = case p_outcome when 'accepted' then 'accepted' when 'rejected' then 'rejected'
                            else case when v_row.attempts >= 8 then 'failed' else 'queued' end end,
    -- 2, 4, 8 ... minutes, at most 6 hours
    next_attempt_at = case when p_outcome = 'retry' then now() + least(power(2, v_row.attempts), 360) * interval '1 minute' else next_attempt_at end,
    eta_uuid = coalesce(p_eta_uuid, eta_uuid),
    submission_id = coalesce(p_submission_id, submission_id),
    last_error = case when p_outcome = 'accepted' then null else left(p_error, 500) end,
    updated_at = now()
  where id = p_id returning * into v_row;
  return v_row;
end;
$$;

revoke execute on function public.eta_enqueue_document() from public, anon, authenticated;
revoke execute on function public.eta_claim_batch(integer), public.eta_record_result(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.eta_claim_batch(integer), public.eta_record_result(uuid, text, text, text, text) to service_role;

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
    default_lead_time_days = coalesce((p->>'default_lead_time_days')::integer, default_lead_time_days),
    store_name_ar = coalesce(btrim(p->>'store_name_ar'), store_name_ar),
    store_name_en = coalesce(btrim(p->>'store_name_en'), store_name_en),
    address_ar = coalesce(btrim(p->>'address_ar'), address_ar),
    address_en = coalesce(btrim(p->>'address_en'), address_en),
    phone = coalesce(btrim(p->>'phone'), phone),
    tax_registration_number = coalesce(btrim(p->>'tax_registration_number'), tax_registration_number),
    receipt_footer_ar = coalesce(btrim(p->>'receipt_footer_ar'), receipt_footer_ar),
    receipt_footer_en = coalesce(btrim(p->>'receipt_footer_en'), receipt_footer_en),
    weighed_barcode_enabled = coalesce((p->>'weighed_barcode_enabled')::boolean, weighed_barcode_enabled),
    weighed_prefix_min = coalesce((p->>'weighed_prefix_min')::integer, weighed_prefix_min),
    weighed_prefix_max = coalesce((p->>'weighed_prefix_max')::integer, weighed_prefix_max),
    weighed_item_code_length = coalesce((p->>'weighed_item_code_length')::integer, weighed_item_code_length),
    weighed_value_kind = coalesce(p->>'weighed_value_kind', weighed_value_kind),
    eta_enabled = coalesce((p->>'eta_enabled')::boolean, eta_enabled)
  where id;
  select count(*) into v_keys from jsonb_object_keys(p);
  perform public.write_audit_event(v_actor, null, 'store_settings_changed', 'settings', null,
    jsonb_build_object('item_count', v_keys), null);
end;
$$;

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
