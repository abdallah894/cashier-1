-- Phase 0 hardening (review P0-1, P0-2).
--
-- P0-1: since phase 1 any signed-in cashier could INSERT into sales and
-- sale_items directly through the REST API, skipping create_sale (no stock
-- movement, no payment row, invented totals; the cash-sale trigger then added
-- the fake amount to the drawer). Checkout is the SECURITY DEFINER RPC only.
drop policy "sales: record own sale" on public.sales;
drop policy "sale_items: insert via own sale or admin" on public.sale_items;

-- P0-2: cashiers could UPDATE their own shift row (closing_counted,
-- opening_float, closed_at = null to reopen) and bypass the variance approval
-- in close_shift. Closing goes through close_shift (SECURITY DEFINER); only an
-- admin may edit a shift row directly.
drop policy "shifts: close own shift or admin" on public.shifts;
create policy "shifts: admin updates"
  on public.shifts for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- A signed-in user may open a shift for themselves, but never one that is
-- already closed or carries closing figures.
create or replace function public.guard_shift_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null
     and (new.closed_at is not null or new.closing_counted is not null or new.expected_cash is not null) then
    raise exception 'shifts: a new shift must be open with no closing figures';
  end if;
  return new;
end;
$$;

create trigger shifts_guard_insert
  before insert on public.shifts
  for each row execute function public.guard_shift_insert();

-- A trigger function never needs to be callable through the API.
revoke execute on function public.guard_shift_insert() from public, anon, authenticated;
