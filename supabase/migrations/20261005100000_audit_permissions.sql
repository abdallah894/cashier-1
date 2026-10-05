create type public.capability as enum (
  'return.approve',
  'cart.void',
  'discount.override',
  'stock.correct',
  'cash.drawer.adjust',
  'shift.close.override'
);

create table public.staff_capabilities (
  staff_id uuid not null references public.profiles(id) on delete restrict,
  capability public.capability not null,
  granted_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (staff_id, capability)
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.profiles(id) on delete restrict,
  approved_by uuid references public.profiles(id) on delete restrict,
  action text not null check (action in (
    'approval_created', 'stock_correction', 'cash_drawer_event',
    'return_created', 'sale_discount_override', 'shift_close'
  )),
  target_type text not null check (target_type in ('approval', 'product', 'shift', 'return', 'sale')),
  target_id uuid,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  request_id uuid,
  created_at timestamptz not null default now()
);

create index audit_events_created_at_idx on public.audit_events (created_at desc);
create index audit_events_actor_id_idx on public.audit_events (actor_id, created_at desc);
create index audit_events_target_idx on public.audit_events (target_type, target_id, created_at desc);

alter table public.staff_capabilities enable row level security;
alter table public.audit_events enable row level security;

create policy "staff capabilities: admins manage"
  on public.staff_capabilities for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "audit events: admins read"
  on public.audit_events for select to authenticated
  using (public.is_admin());

create or replace function public.has_capability(p_capability public.capability)
returns boolean
language sql security definer set search_path = '' stable
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.active and p.role = 'admin'
  ) or exists (
    select 1 from public.staff_capabilities sc
    join public.profiles p on p.id = sc.staff_id
    where sc.staff_id = auth.uid() and sc.capability = p_capability and p.active
  );
$$;

create or replace function public.write_audit_event(
  p_actor_id uuid,
  p_approved_by uuid,
  p_action text,
  p_target_type text,
  p_target_id uuid,
  p_metadata jsonb,
  p_request_id uuid default null
)
returns public.audit_events
language plpgsql security definer set search_path = ''
as $$
declare v_event public.audit_events%rowtype; v_key text;
begin
  if p_actor_id is null or p_action not in (
    'approval_created', 'stock_correction', 'cash_drawer_event',
    'return_created', 'sale_discount_override', 'shift_close'
  ) or p_target_type not in ('approval', 'product', 'shift', 'return', 'sale') then
    raise exception 'audit: invalid event';
  end if;
  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'audit: metadata must be an object';
  end if;
  for v_key in select jsonb_object_keys(p_metadata) loop
    if v_key not in (
      'amount', 'capability', 'discount_total', 'event_type', 'expected_cash',
      'hash_prefix', 'payment_method', 'reason_length', 'refund_total', 'restock',
      'shift_id', 'signed_qty_change', 'variance'
    ) then
      raise exception 'audit: unsafe metadata key';
    end if;
  end loop;
  insert into public.audit_events
    (actor_id, approved_by, action, target_type, target_id, metadata, request_id)
  values
    (p_actor_id, p_approved_by, p_action, p_target_type, p_target_id, p_metadata, p_request_id)
  returning * into v_event;
  return v_event;
end;
$$;

revoke all on function public.write_audit_event(uuid, uuid, text, text, uuid, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.has_capability(public.capability) to authenticated, service_role;
