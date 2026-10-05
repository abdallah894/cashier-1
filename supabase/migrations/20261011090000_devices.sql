-- Supported POS hardware: tills, device profiles, health, audited print jobs
-- and an authorisation record for every cash-drawer opening.
--
-- NOTE ON ENFORCEMENT: the cash-drawer pulse and the printer are driven from
-- the browser (WebUSB), so the database cannot physically stop a pulse. What
-- it does guarantee is that the UI only opens the drawer with a server-side
-- authorisation tied to an approved event, and that every opening (and every
-- attempt) is attributed to an actor and a till. Printing is a side effect
-- that never touches sales: a failed print is a failed job, reprintable.

insert into public.audit_actions (action, target_type) values
  ('device_changed', 'device'),
  ('receipt_reprinted', 'print_job'),
  ('drawer_open_authorized', 'shift');

-- ---------- tills ----------
create table public.tills (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index tills_name_key on public.tills (lower(btrim(name)));
insert into public.tills (name) values ('Main Register');

create or replace function public.default_till_id()
returns uuid
language sql stable set search_path = ''
as $$ select id from public.tills order by created_at, id limit 1; $$;

alter table public.shifts add column till_id uuid references public.tills(id) on delete restrict;
update public.shifts set till_id = public.default_till_id() where till_id is null;
alter table public.shifts alter column till_id set default public.default_till_id();
alter table public.shifts alter column till_id set not null;

alter table public.tills enable row level security;
create policy "tills: authenticated read" on public.tills for select to authenticated using (true);
create policy "tills: admins write" on public.tills for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------- declared hardware profiles ----------
create type public.device_kind as enum ('printer', 'scanner', 'cash_drawer');

create table public.device_profiles (
  key text primary key,
  kind public.device_kind not null,
  label text not null,
  -- true = a tested code path exists in this release; false = declared as
  -- not supported yet (kept so the matrix in docs/hardware.md stays honest)
  supported boolean not null,
  notes text
);
insert into public.device_profiles (key, kind, label, supported, notes) values
  ('usb_hid_keyboard', 'scanner', 'USB barcode scanner in keyboard-wedge mode', true, 'Burst detection ending in Enter; works regardless of focus.'),
  ('camera_browser', 'scanner', 'Device camera (EAN-13/8, Code 128, QR)', true, 'html5-qrcode in a modal.'),
  ('bluetooth_hid', 'scanner', 'Bluetooth HID scanner', false, 'Expected to behave as a keyboard wedge; not verified.'),
  ('browser_print_80mm', 'printer', 'Browser / PDF print (80 mm)', true, 'Fallback path; no hardware status.'),
  ('escpos_usb_80mm', 'printer', 'ESC/POS thermal printer over USB (WebUSB, 80 mm)', true, 'Chromium-based browsers over HTTPS or localhost.'),
  ('escpos_network_80mm', 'printer', 'ESC/POS thermal printer over the network', false, 'Needs a local print bridge; not built.'),
  ('printer_kick', 'cash_drawer', 'Cash drawer wired to the receipt printer (RJ11 kick)', true, 'ESC p pulse sent through the printer.'),
  ('usb_direct', 'cash_drawer', 'USB-driven cash drawer', false, 'Not built.');
alter table public.device_profiles enable row level security;
create policy "device profiles: authenticated read" on public.device_profiles for select to authenticated using (true);

-- ---------- devices ----------
create table public.devices (
  id uuid primary key default gen_random_uuid(),
  till_id uuid not null references public.tills(id) on delete restrict,
  kind public.device_kind not null,
  name text not null check (length(btrim(name)) > 0),
  profile text not null references public.device_profiles(key),
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  active boolean not null default true,
  health text not null default 'unknown' check (health in ('unknown', 'ok', 'degraded', 'offline')),
  health_detail text,
  last_seen_at timestamptz,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (till_id, kind, name)
);
alter table public.devices enable row level security;
create policy "devices: active devices readable" on public.devices for select to authenticated
  using (active or public.is_admin());
-- No write policies: devices change only through upsert_device / report_device_health.

create or replace function public.guard_device()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'devices is immutable (DELETE rejected; deactivate instead)' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger devices_guard before update or delete on public.devices
  for each row execute function public.guard_device();

-- ---------- append-only device event log ----------
create table public.device_events (
  id uuid primary key default gen_random_uuid(),
  till_id uuid not null references public.tills(id) on delete restrict,
  device_id uuid references public.devices(id) on delete restrict,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  event_type text not null check (event_type in ('print', 'reprint', 'print_failed', 'drawer_open', 'drawer_failed', 'health_change')),
  document_type text,
  document_id uuid,
  detail text,
  created_at timestamptz not null default now()
);
create index device_events_device_idx on public.device_events (device_id, created_at desc);
alter table public.device_events enable row level security;
create policy "device events: admins and actors read" on public.device_events for select to authenticated
  using (public.is_admin() or actor_id = auth.uid());
create trigger device_events_immutable before update or delete on public.device_events
  for each row execute function public.reject_ledger_change();
create trigger device_events_no_truncate before truncate on public.device_events
  for each statement execute function public.reject_ledger_change();

-- ---------- print jobs ----------
create table public.print_jobs (
  id uuid primary key default gen_random_uuid(),
  till_id uuid not null references public.tills(id) on delete restrict,
  document_type text not null check (document_type in ('sale_receipt', 'return_receipt', 'z_report')),
  document_id uuid not null,
  kind text not null check (kind in ('original', 'reprint', 'gift')),
  copy_number integer not null check (copy_number >= 1),
  reason text,
  status text not null default 'queued' check (status in ('queued', 'printed', 'failed')),
  error text,
  device_id uuid references public.devices(id) on delete restrict,
  requested_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index print_jobs_document_idx on public.print_jobs (document_type, document_id);
create index print_jobs_status_idx on public.print_jobs (status, created_at desc);
alter table public.print_jobs enable row level security;
create policy "print jobs: admins and requesters read" on public.print_jobs for select to authenticated
  using (public.is_admin() or requested_by = auth.uid());

create or replace function public.guard_print_job()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'print_jobs is immutable (DELETE rejected)' using errcode = 'P0001';
  end if;
  if old.status <> 'queued'
     or (new.id, new.till_id, new.document_type, new.document_id, new.kind, new.copy_number, new.reason, new.requested_by, new.created_at)
        is distinct from
        (old.id, old.till_id, old.document_type, old.document_id, old.kind, old.copy_number, old.reason, old.requested_by, old.created_at) then
    raise exception 'print_jobs is immutable (a job is completed once)' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger print_jobs_guard before update or delete on public.print_jobs
  for each row execute function public.guard_print_job();
create trigger print_jobs_no_truncate before truncate on public.print_jobs
  for each statement execute function public.reject_ledger_change();

-- ---------- drawer openings ----------
create type public.drawer_reason as enum ('cash_sale', 'cash_refund', 'cash_drawer_event', 'no_sale');

create table public.drawer_openings (
  id uuid primary key default gen_random_uuid(),
  till_id uuid not null references public.tills(id) on delete restrict,
  shift_id uuid not null references public.shifts(id) on delete restrict,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  reason public.drawer_reason not null,
  reference_id uuid,
  note text,
  approved_by uuid references public.profiles(id) on delete restrict,
  status text not null default 'authorized' check (status in ('authorized', 'opened', 'failed')),
  error text,
  device_id uuid references public.devices(id) on delete restrict,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index drawer_openings_reference_idx on public.drawer_openings (reason, reference_id) where reference_id is not null;
alter table public.drawer_openings enable row level security;
create policy "drawer openings: admins and actors read" on public.drawer_openings for select to authenticated
  using (public.is_admin() or actor_id = auth.uid());

create or replace function public.guard_drawer_opening()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'drawer_openings is immutable (DELETE rejected)' using errcode = 'P0001';
  end if;
  if old.status <> 'authorized'
     or (new.id, new.till_id, new.shift_id, new.actor_id, new.reason, new.reference_id, new.note, new.approved_by, new.created_at)
        is distinct from
        (old.id, old.till_id, old.shift_id, old.actor_id, old.reason, old.reference_id, old.note, old.approved_by, old.created_at) then
    raise exception 'drawer_openings is immutable (the authorisation cannot change)' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger drawer_openings_guard before update or delete on public.drawer_openings
  for each row execute function public.guard_drawer_opening();
create trigger drawer_openings_no_truncate before truncate on public.drawer_openings
  for each statement execute function public.reject_ledger_change();

-- ---------- RPCs ----------
create or replace function public.upsert_device(p jsonb)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_profile public.device_profiles%rowtype;
  v_kind public.device_kind := (p->>'kind')::public.device_kind;
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_created boolean := false;
begin
  if v_actor is null or not public.is_admin() then raise exception 'device: admin only'; end if;
  select * into v_profile from public.device_profiles where key = p->>'profile';
  if not found then raise exception 'device: unknown profile'; end if;
  if v_profile.kind <> v_kind then raise exception 'device: profile does not match the device kind'; end if;
  if not v_profile.supported then raise exception 'device: profile is not supported in this release'; end if;
  if not exists (select 1 from public.tills where id = (p->>'till_id')::uuid) then raise exception 'device: till not found'; end if;

  if v_id is null then
    insert into public.devices (till_id, kind, name, profile, settings, active, created_by)
    values ((p->>'till_id')::uuid, v_kind, btrim(p->>'name'), v_profile.key,
            coalesce(p->'settings', '{}'::jsonb), coalesce((p->>'active')::boolean, true), v_actor)
    returning id into v_id;
    v_created := true;
  else
    update public.devices
    set name = btrim(p->>'name'), profile = v_profile.key, settings = coalesce(p->'settings', settings),
        active = coalesce((p->>'active')::boolean, active)
    where id = v_id;
    if not found then raise exception 'device: not found'; end if;
  end if;
  perform public.write_audit_event(v_actor, null, 'device_changed', 'device', v_id,
    jsonb_build_object('event_type', case when v_created then 'created' else 'updated' end), null);
  return v_id;
end;
$$;

create or replace function public.report_device_health(p_device_id uuid, p_health text, p_detail text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := auth.uid(); v_device public.devices%rowtype;
begin
  if v_actor is null or not exists (select 1 from public.profiles where id = v_actor and active) then
    raise exception 'device: not authenticated';
  end if;
  if p_health not in ('ok', 'degraded', 'offline') then raise exception 'device: invalid health value'; end if;
  select * into v_device from public.devices where id = p_device_id for update;
  if not found then raise exception 'device: not found'; end if;
  update public.devices
  set health = p_health, health_detail = nullif(btrim(coalesce(p_detail, '')), ''), last_seen_at = now()
  where id = p_device_id;
  if v_device.health is distinct from p_health then
    insert into public.device_events (till_id, device_id, actor_id, event_type, detail)
    values (v_device.till_id, p_device_id, v_actor, 'health_change',
            v_device.health || ' -> ' || p_health || coalesce(': ' || nullif(btrim(coalesce(p_detail, '')), ''), ''));
  end if;
end;
$$;

create or replace function public.request_print(
  p_document_type text,
  p_document_id uuid,
  p_kind text,
  p_reason text default null
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_till uuid;
  v_owner uuid;
  v_printed integer;
  v_id uuid;
begin
  if v_actor is null or not exists (select 1 from public.profiles where id = v_actor and active) then
    raise exception 'print: not authenticated';
  end if;
  if p_kind not in ('original', 'reprint', 'gift') then raise exception 'print: invalid kind'; end if;
  if p_kind = 'gift' and p_document_type <> 'sale_receipt' then raise exception 'print: gift receipts only exist for sales'; end if;
  if p_kind = 'reprint' and (p_reason is null or length(btrim(p_reason)) = 0) then
    raise exception 'print: a reason is required for a reprint';
  end if;

  if p_document_type = 'sale_receipt' then
    select cashier_id into v_owner from public.sales where id = p_document_id;
  elsif p_document_type = 'return_receipt' then
    select actor_id into v_owner from public.returns where id = p_document_id;
  elsif p_document_type = 'z_report' then
    select cashier_id into v_owner from public.shifts where id = p_document_id;
  else
    raise exception 'print: unknown document type';
  end if;
  if v_owner is null then raise exception 'print: document not found'; end if;
  if v_owner <> v_actor and not public.is_admin() then raise exception 'print: not yours'; end if;

  select count(*) into v_printed from public.print_jobs
  where document_type = p_document_type and document_id = p_document_id and status = 'printed' and kind <> 'gift';
  if p_kind = 'original' and v_printed > 0 then
    raise exception 'print: already printed; request a reprint with a reason';
  end if;

  select coalesce((select till_id from public.shifts where cashier_id = v_actor and closed_at is null), public.default_till_id())
  into v_till;

  insert into public.print_jobs (till_id, document_type, document_id, kind, copy_number, reason, requested_by)
  values (v_till, p_document_type, p_document_id, p_kind,
          case when p_kind = 'gift' then 1 else v_printed + 1 end,
          nullif(btrim(coalesce(p_reason, '')), ''), v_actor)
  returning id into v_id;

  if p_kind = 'reprint' then
    perform public.write_audit_event(v_actor, null, 'receipt_reprinted', 'print_job', v_id,
      jsonb_build_object('reason_length', length(btrim(p_reason))), null);
  end if;
  return v_id;
end;
$$;

create or replace function public.complete_print_job(p_job_id uuid, p_ok boolean, p_error text default null, p_device_id uuid default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := auth.uid(); v_job public.print_jobs%rowtype;
begin
  if v_actor is null then raise exception 'print: not authenticated'; end if;
  select * into v_job from public.print_jobs where id = p_job_id for update;
  if not found then raise exception 'print: job not found'; end if;
  if v_job.requested_by <> v_actor and not public.is_admin() then raise exception 'print: not yours'; end if;
  if v_job.status <> 'queued' then raise exception 'print: job already completed'; end if;
  update public.print_jobs
  set status = case when p_ok then 'printed' else 'failed' end,
      error = case when p_ok then null else coalesce(nullif(btrim(coalesce(p_error, '')), ''), 'print failed') end,
      device_id = p_device_id, completed_at = now()
  where id = p_job_id;
  insert into public.device_events (till_id, device_id, actor_id, event_type, document_type, document_id, detail)
  values (v_job.till_id, p_device_id, v_actor,
          case when not p_ok then 'print_failed' when v_job.kind = 'reprint' then 'reprint' else 'print' end,
          v_job.document_type, v_job.document_id, case when p_ok then null else nullif(btrim(coalesce(p_error, '')), '') end);
end;
$$;

create or replace function public.authorize_drawer_open(
  p_reason public.drawer_reason,
  p_reference_id uuid default null,
  p_note text default null,
  p_approval_id uuid default null
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_shift public.shifts%rowtype;
  v_sale public.sales%rowtype;
  v_return public.returns%rowtype;
  v_event public.cash_drawer_events%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_approved_by uuid;
  v_hash text;
  v_id uuid;
begin
  if v_actor is null then raise exception 'drawer: not authenticated'; end if;
  select * into v_shift from public.shifts where cashier_id = v_actor and closed_at is null;
  if not found then raise exception 'drawer: no open shift'; end if;

  if p_reason = 'cash_sale' then
    select * into v_sale from public.sales where id = p_reference_id;
    if not found then raise exception 'drawer: sale not found'; end if;
    if v_sale.cashier_id <> v_actor then raise exception 'drawer: sale is not yours'; end if;
    if not exists (select 1 from public.payments where sale_id = v_sale.id and direction = 'charge' and tender = 'cash' and status = 'captured') then
      raise exception 'drawer: not a cash sale';
    end if;
    if v_sale.created_at < now() - interval '10 minutes' then raise exception 'drawer: sale is too old to open the drawer'; end if;
  elsif p_reason = 'cash_refund' then
    select * into v_return from public.returns where id = p_reference_id;
    if not found then raise exception 'drawer: return not found'; end if;
    if v_return.actor_id <> v_actor then raise exception 'drawer: return is not yours'; end if;
    if v_return.refund_tender <> 'cash' then raise exception 'drawer: not a cash refund'; end if;
    if v_return.created_at < now() - interval '10 minutes' then raise exception 'drawer: return is too old to open the drawer'; end if;
  elsif p_reason = 'cash_drawer_event' then
    select * into v_event from public.cash_drawer_events where id = p_reference_id;
    if not found then raise exception 'drawer: drawer event not found'; end if;
    if v_event.actor_id <> v_actor or v_event.event_type not in ('paid_in', 'paid_out', 'safe_drop') then
      raise exception 'drawer: drawer event is not yours';
    end if;
    if v_event.created_at < now() - interval '10 minutes' then raise exception 'drawer: drawer event is too old to open the drawer'; end if;
  else
    -- no_sale: a manual opening needs a stated reason and either the capability or a bound manager approval
    if v_note is null then raise exception 'drawer: a reason is required'; end if;
    if not public.has_capability('cash.drawer.adjust') then
      if p_approval_id is null then raise exception 'drawer: manager approval is required'; end if;
      v_hash := encode(extensions.digest('drawer_open|' || v_shift.id::text || '|' || v_note, 'sha256'), 'hex');
      v_approved_by := public.consume_manager_approval(p_approval_id, 'cash_drawer_event', v_hash);
    end if;
  end if;

  if p_reason <> 'no_sale' and exists (
    select 1 from public.drawer_openings where reason = p_reason and reference_id = p_reference_id and status in ('authorized', 'opened')
  ) then
    raise exception 'drawer: opening already authorized for this event';
  end if;

  insert into public.drawer_openings (till_id, shift_id, actor_id, reason, reference_id, note, approved_by)
  values (v_shift.till_id, v_shift.id, v_actor, p_reason, case when p_reason = 'no_sale' then null else p_reference_id end, v_note, v_approved_by)
  returning id into v_id;
  perform public.write_audit_event(v_actor, v_approved_by, 'drawer_open_authorized', 'shift', v_shift.id,
    jsonb_build_object('event_type', p_reason::text, 'reason_length', coalesce(length(v_note), 0)), null);
  return v_id;
end;
$$;

create or replace function public.complete_drawer_opening(p_id uuid, p_ok boolean, p_error text default null, p_device_id uuid default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := auth.uid(); v_row public.drawer_openings%rowtype;
begin
  if v_actor is null then raise exception 'drawer: not authenticated'; end if;
  select * into v_row from public.drawer_openings where id = p_id for update;
  if not found then raise exception 'drawer: opening not found'; end if;
  if v_row.actor_id <> v_actor then raise exception 'drawer: opening is not yours'; end if;
  if v_row.status <> 'authorized' then raise exception 'drawer: opening already completed'; end if;
  update public.drawer_openings
  set status = case when p_ok then 'opened' else 'failed' end,
      error = case when p_ok then null else coalesce(nullif(btrim(coalesce(p_error, '')), ''), 'drawer did not open') end,
      device_id = p_device_id, completed_at = now()
  where id = p_id;
  insert into public.device_events (till_id, device_id, actor_id, event_type, document_type, document_id, detail)
  values (v_row.till_id, p_device_id, v_actor, case when p_ok then 'drawer_open' else 'drawer_failed' end,
          'drawer_opening', p_id, v_row.reason::text || coalesce(': ' || nullif(btrim(coalesce(p_error, '')), ''), ''));
end;
$$;

revoke execute on function
  public.default_till_id(),
  public.upsert_device(jsonb),
  public.report_device_health(uuid, text, text),
  public.request_print(text, uuid, text, text),
  public.complete_print_job(uuid, boolean, text, uuid),
  public.authorize_drawer_open(public.drawer_reason, uuid, text, uuid),
  public.complete_drawer_opening(uuid, boolean, text, uuid)
from public, anon;
grant execute on function
  public.default_till_id(),
  public.upsert_device(jsonb),
  public.report_device_health(uuid, text, text),
  public.request_print(text, uuid, text, text),
  public.complete_print_job(uuid, boolean, text, uuid),
  public.authorize_drawer_open(public.drawer_reason, uuid, text, uuid),
  public.complete_drawer_opening(uuid, boolean, text, uuid)
to authenticated, service_role;
