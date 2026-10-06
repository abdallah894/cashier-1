-- Phase 0 (review P1-4): staff may record the outcome of a manual card-terminal
-- payment, but may not mark a gateway ("sandbox"/live) payment captured.
create or replace function public.record_payment_result(
  p_payment_id uuid,
  p_status public.payment_status,
  p_reference text default null,
  p_note text default null
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := auth.uid(); v_pay public.payments%rowtype; v_reference text;
begin
  if v_actor is null then raise exception 'payment: not authenticated'; end if;
  select * into v_pay from public.payments where id = p_payment_id for update;
  if not found then raise exception 'payment: not found'; end if;
  if v_pay.created_by <> v_actor and not public.is_admin() then raise exception 'payment: not yours'; end if;
  if p_status = 'pending' then raise exception 'payment: illegal status change % -> %', v_pay.status, p_status; end if;
  if v_pay.provider = 'cash' then raise exception 'payment: cash payments are recorded by the sale'; end if;
  -- Money taken through a gateway is confirmed only by the provider's signed
  -- callback (apply_provider_event, service role). Without this a cashier could
  -- mark a sandbox card payment "captured" themselves and the sale would go
  -- through without the provider ever confirming it.
  if p_status = 'captured' and v_pay.provider = 'sandbox' then
    raise exception 'payment: a gateway payment is confirmed by the provider, not by staff';
  end if;

  v_reference := coalesce(v_pay.provider_reference, nullif(btrim(coalesce(p_reference, '')), ''));
  if p_status = 'captured' then
    if v_reference is null then raise exception 'payment: reference is required to capture'; end if;
    if not public.valid_payment_reference(v_reference) then raise exception 'payment: invalid reference'; end if;
    if v_pay.provider_reference is null and exists (
      select 1 from public.payments where provider = v_pay.provider and provider_reference = v_reference and direction = v_pay.direction
    ) then
      raise exception 'payment: reference already used';
    end if;
  end if;

  update public.payments
  set status = p_status,
      provider_reference = v_reference,
      failure_reason = case when p_status in ('declined', 'failed', 'voided') then nullif(btrim(coalesce(p_note, '')), '') end
  where id = p_payment_id;

  perform public.record_payment_event(p_payment_id, v_pay.status, p_status, 'staff', v_actor, v_pay.provider, null, v_pay.amount,
    nullif(btrim(coalesce(p_note, '')), ''));
  perform public.write_audit_event(v_actor, null, 'payment_status_changed', 'payment', p_payment_id,
    jsonb_build_object('event_type', p_status::text, 'amount', v_pay.amount), null);
end;
$$;
