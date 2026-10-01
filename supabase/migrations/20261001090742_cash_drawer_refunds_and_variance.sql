alter type public.cash_drawer_event_type add value if not exists 'cash_refund';
alter table public.cash_drawer_events add column return_id uuid references public.returns(id) on delete restrict;

create or replace function public.record_cash_refund_drawer_event()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_shift_id uuid;
begin
  if new.refund_tender <> 'cash' then return new; end if;
  select shift_id into v_shift_id from public.sales where id = new.sale_id;
  if v_shift_id is not null then
    insert into public.cash_drawer_events (shift_id, event_type, amount, reason, actor_id, return_id)
    values (v_shift_id, 'cash_refund', -new.refund_total, 'Cash return #' || new.return_number, new.actor_id, new.id);
  end if;
  return new;
end;
$$;

create trigger returns_record_cash_refund_drawer_event
  after insert on public.returns
  for each row execute function public.record_cash_refund_drawer_event();
