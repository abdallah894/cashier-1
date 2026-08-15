-- ============================================================
-- Phase 5 — PIN verification, shift lifecycle, sale-shift enforcement
--
-- verify_pin / set_pin are SERVICE-ROLE ONLY: clients can never call
-- them, so there is no client-side brute-force surface. Lockout: 5
-- consecutive failures → locked for 15 minutes.
--
-- Every NEW sale must reference an open shift owned by its cashier —
-- enforced by a BEFORE INSERT trigger so it covers every insert path
-- (create_sale RPC and any direct RLS-allowed insert alike).
-- ============================================================

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

alter table public.profiles
  add column pin_attempts int not null default 0,
  add column pin_locked_until timestamptz;

-- ---------- PIN ----------

create or replace function public.verify_pin(p_user_id uuid, p_pin text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles%rowtype;
begin
  -- lock the row: concurrent attempts serialize, the counter can't race
  select * into v_profile
  from public.profiles
  where id = p_user_id and active
  for update;

  if not found then
    return 'no_pin'; -- unknown/inactive: same opaque answer as "no PIN set"
  end if;
  if v_profile.pin_hash is null then
    return 'no_pin';
  end if;
  if v_profile.pin_locked_until is not null and v_profile.pin_locked_until > now() then
    return 'locked';
  end if;

  if extensions.crypt(p_pin, v_profile.pin_hash) = v_profile.pin_hash then
    update public.profiles
    set pin_attempts = 0, pin_locked_until = null
    where id = p_user_id;
    return 'ok';
  end if;

  if v_profile.pin_attempts + 1 >= 5 then
    update public.profiles
    set pin_attempts = 0, pin_locked_until = now() + interval '15 minutes'
    where id = p_user_id;
    return 'locked';
  end if;

  update public.profiles
  set pin_attempts = pin_attempts + 1
  where id = p_user_id;
  return 'bad_pin';
end;
$$;

create or replace function public.set_pin(p_user_id uuid, p_pin text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_pin !~ '^\d{4}$' then
    raise exception 'set_pin: PIN must be exactly 4 digits';
  end if;
  update public.profiles
  set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf')),
      pin_attempts = 0,
      pin_locked_until = null
  where id = p_user_id;
  if not found then
    raise exception 'set_pin: profile % not found', p_user_id;
  end if;
end;
$$;

revoke execute on function public.verify_pin from public, anon, authenticated;
grant execute on function public.verify_pin to service_role;
revoke execute on function public.set_pin from public, anon, authenticated;
grant execute on function public.set_pin to service_role;

-- ---------- shifts ----------

-- one open shift per cashier
create unique index shifts_one_open_per_cashier
  on public.shifts (cashier_id)
  where closed_at is null;

create or replace function public.close_shift(p_shift_id uuid, p_counted numeric)
returns public.shifts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shift public.shifts%rowtype;
  v_cash numeric;
begin
  if p_counted is null or p_counted < 0 then
    raise exception 'close_shift: counted cash must be >= 0';
  end if;

  select * into v_shift from public.shifts where id = p_shift_id for update;
  if not found then
    raise exception 'close_shift: shift % not found', p_shift_id;
  end if;
  if v_shift.closed_at is not null then
    raise exception 'close_shift: shift already closed';
  end if;
  if v_shift.cashier_id <> auth.uid() and not public.is_admin() then
    raise exception 'close_shift: not your shift';
  end if;

  select coalesce(sum(total), 0) into v_cash
  from public.sales
  where shift_id = p_shift_id and payment_method = 'cash';

  update public.shifts
  set closed_at = now(),
      closing_counted = p_counted,
      expected_cash = v_shift.opening_float + v_cash
  where id = p_shift_id
  returning * into v_shift;

  return v_shift;
end;
$$;

revoke execute on function public.close_shift from public, anon;
grant execute on function public.close_shift to authenticated, service_role;

-- ---------- every sale needs an open shift of its cashier ----------

create or replace function public.validate_sale_shift()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.shift_id is null then
    raise exception 'sales: no open shift — open a shift before selling';
  end if;
  perform 1 from public.shifts s
  where s.id = new.shift_id
    and s.cashier_id = new.cashier_id
    and s.closed_at is null;
  if not found then
    raise exception 'sales: no open shift — % is not an open shift of this cashier', new.shift_id;
  end if;
  return new;
end;
$$;

create trigger sales_validate_shift
  before insert on public.sales
  for each row execute function public.validate_sale_shift();
