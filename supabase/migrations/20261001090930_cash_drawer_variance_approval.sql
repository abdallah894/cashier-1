create table public.cash_drawer_settings (
  id boolean primary key default true check (id),
  variance_approval_threshold numeric(12,0) check (variance_approval_threshold >= 0),
  updated_at timestamptz not null default now()
);
insert into public.cash_drawer_settings (id) values (true);
alter table public.cash_drawer_settings enable row level security;
create policy "cash drawer settings: admin manages" on public.cash_drawer_settings for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop function public.close_shift(uuid, numeric);
create function public.close_shift(p_shift_id uuid, p_counted numeric, p_manager_pin text default null)
returns public.shifts
language plpgsql security definer set search_path = ''
as $$
declare v_shift public.shifts%rowtype; v_events numeric; v_expected numeric; v_threshold numeric; v_manager uuid;
begin
  if p_counted is null or p_counted < 0 then raise exception 'close_shift: counted cash must be >= 0'; end if;
  select * into v_shift from public.shifts where id = p_shift_id for update;
  if not found then raise exception 'close_shift: shift not found'; end if;
  if v_shift.closed_at is not null then raise exception 'close_shift: shift already closed'; end if;
  if v_shift.cashier_id <> auth.uid() and not public.is_admin() then raise exception 'close_shift: not your shift'; end if;
  select coalesce(sum(total), 0) into v_events from public.sales where shift_id = p_shift_id and payment_method = 'cash';
  select v_events + coalesce(sum(amount), 0) into v_events from public.cash_drawer_events where shift_id = p_shift_id;
  v_expected := v_shift.opening_float + v_events;
  select variance_approval_threshold into v_threshold from public.cash_drawer_settings where id = true;
  if not public.is_admin() and v_threshold is not null and abs(p_counted - v_expected) >= v_threshold then
    select id into v_manager from public.profiles where role = 'admin' and active and pin_hash = extensions.crypt(p_manager_pin, pin_hash) limit 1;
    if p_manager_pin is null or v_manager is null then raise exception 'close_shift: manager approval is required'; end if;
  end if;
  update public.shifts set closed_at = now(), closing_counted = p_counted, expected_cash = v_expected where id = p_shift_id returning * into v_shift;
  return v_shift;
end;
$$;
revoke execute on function public.close_shift(uuid, numeric, text) from public, anon;
grant execute on function public.close_shift(uuid, numeric, text) to authenticated, service_role;
