create type public.cash_drawer_event_type as enum ('paid_in', 'paid_out', 'safe_drop');

create table public.cash_drawer_events (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.shifts(id) on delete restrict,
  event_type public.cash_drawer_event_type not null,
  amount numeric(12,0) not null check (amount <> 0),
  reason text not null check (length(btrim(reason)) > 0),
  actor_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index cash_drawer_events_shift_id_idx on public.cash_drawer_events (shift_id);
alter table public.cash_drawer_events enable row level security;

create policy "cash drawer events: read own shift or admin"
  on public.cash_drawer_events for select to authenticated
  using (public.is_admin() or exists (
    select 1 from public.shifts s where s.id = shift_id and s.cashier_id = (select auth.uid())
  ));

create or replace function public.record_cash_drawer_event(
  p_shift_id uuid,
  p_type public.cash_drawer_event_type,
  p_amount numeric,
  p_reason text
)
returns public.cash_drawer_events
language plpgsql security definer set search_path = ''
as $$
declare
  v_shift public.shifts%rowtype;
  v_event public.cash_drawer_events%rowtype;
  v_amount numeric;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'cash drawer: amount must be positive'; end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then raise exception 'cash drawer: reason is required'; end if;
  select * into v_shift from public.shifts where id = p_shift_id for update;
  if not found then raise exception 'cash drawer: shift not found'; end if;
  if v_shift.closed_at is not null then raise exception 'cash drawer: shift is closed'; end if;
  if v_shift.cashier_id <> auth.uid() and not public.is_admin() then raise exception 'cash drawer: not your shift'; end if;
  v_amount := case when p_type in ('paid_out', 'safe_drop') then -p_amount else p_amount end;
  insert into public.cash_drawer_events (shift_id, event_type, amount, reason, actor_id)
  values (p_shift_id, p_type, v_amount, btrim(p_reason), auth.uid()) returning * into v_event;
  return v_event;
end;
$$;

create or replace function public.close_shift(p_shift_id uuid, p_counted numeric)
returns public.shifts
language plpgsql security definer set search_path = ''
as $$
declare v_shift public.shifts%rowtype; v_events numeric;
begin
  if p_counted is null or p_counted < 0 then raise exception 'close_shift: counted cash must be >= 0'; end if;
  select * into v_shift from public.shifts where id = p_shift_id for update;
  if not found then raise exception 'close_shift: shift not found'; end if;
  if v_shift.closed_at is not null then raise exception 'close_shift: shift already closed'; end if;
  if v_shift.cashier_id <> auth.uid() and not public.is_admin() then raise exception 'close_shift: not your shift'; end if;
  select coalesce(sum(total), 0) into v_events from public.sales where shift_id = p_shift_id and payment_method = 'cash';
  select v_events + coalesce(sum(amount), 0) into v_events from public.cash_drawer_events where shift_id = p_shift_id;
  update public.shifts set closed_at = now(), closing_counted = p_counted, expected_cash = v_shift.opening_float + v_events
  where id = p_shift_id returning * into v_shift;
  return v_shift;
end;
$$;

revoke execute on function public.record_cash_drawer_event(uuid, public.cash_drawer_event_type, numeric, text) from public, anon;
grant execute on function public.record_cash_drawer_event(uuid, public.cash_drawer_event_type, numeric, text) to authenticated, service_role;
