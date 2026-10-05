-- Cash checkout is an immutable drawer movement in the same transaction as
-- the sale row. Existing close_shift derives expected cash from this ledger.
alter table public.cash_drawer_events
  add column sale_id uuid references public.sales(id) on delete restrict;
create unique index cash_drawer_events_cash_sale_unique
  on public.cash_drawer_events (sale_id) where event_type = 'cash_sale';

-- This public RPC is only for cashier-entered movements. System events are
-- created by transaction-bound triggers below, not by a caller-supplied type.
create or replace function public.record_cash_drawer_event(
  p_shift_id uuid,
  p_type public.cash_drawer_event_type,
  p_amount numeric,
  p_reason text
)
returns public.cash_drawer_events
language plpgsql security definer set search_path = ''
as $$
declare v_shift public.shifts%rowtype; v_event public.cash_drawer_events%rowtype; v_amount numeric;
begin
  if p_type not in ('paid_in', 'paid_out', 'safe_drop') then raise exception 'cash drawer: invalid manual event type'; end if;
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

create or replace function public.record_cash_sale_drawer_event()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.payment_method = 'cash' then
    insert into public.cash_drawer_events (shift_id, event_type, amount, reason, actor_id, sale_id)
    values (new.shift_id, 'cash_sale', new.total, 'Cash sale #' || new.sale_number, new.cashier_id, new.id);
  end if;
  return new;
end;
$$;

create trigger sales_record_cash_drawer_event
  after insert on public.sales
  for each row execute function public.record_cash_sale_drawer_event();

-- New sales have a cash_sale event, so a closed shift's expected cash is the
-- opening float plus every signed drawer event (cash refunds included).
drop function public.close_shift(uuid, numeric, text);
create or replace function public.close_shift(p_shift_id uuid, p_counted numeric, p_approval_id uuid default null)
returns public.shifts
language plpgsql security definer set search_path = ''
as $$
declare v_shift public.shifts%rowtype; v_events numeric; v_expected numeric; v_threshold numeric; v_manager uuid; v_actor_id uuid := auth.uid(); v_hash text;
begin
  if p_counted is null or p_counted < 0 then raise exception 'close_shift: counted cash must be >= 0'; end if;
  select * into v_shift from public.shifts where id = p_shift_id for update;
  if not found then raise exception 'close_shift: shift not found'; end if;
  if v_shift.closed_at is not null then raise exception 'close_shift: shift already closed'; end if;
  if v_shift.cashier_id <> v_actor_id and not public.is_admin() then raise exception 'close_shift: not your shift'; end if;
  select coalesce(sum(amount), 0) into v_events from public.cash_drawer_events where shift_id = p_shift_id;
  v_expected := v_shift.opening_float + v_events;
  select variance_approval_threshold into v_threshold from public.cash_drawer_settings where id = true;
  if not public.is_admin() and v_threshold is not null and abs(p_counted - v_expected) >= v_threshold then
    if p_approval_id is null then raise exception 'close_shift: manager approval is required'; end if;
    v_hash := encode(extensions.digest('shift_close|' || p_shift_id::text || '|' || p_counted::text || '|' || v_expected::text, 'sha256'), 'hex');
    v_manager := public.consume_manager_approval(p_approval_id, 'shift_close', v_hash);
  end if;
  update public.shifts set closed_at = now(), closing_counted = p_counted, expected_cash = v_expected where id = p_shift_id returning * into v_shift;
  perform public.write_audit_event(v_actor_id, v_manager, 'shift_close', 'shift', p_shift_id,
    jsonb_build_object('expected_cash', v_expected, 'amount', p_counted, 'variance', p_counted - v_expected), null);
  return v_shift;
end;
$$;
