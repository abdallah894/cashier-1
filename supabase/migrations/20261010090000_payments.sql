-- Payment lifecycle: tenders become auditable payment records.
--
-- MODEL
--   payments        one row per tender movement (charge or refund) with a
--                   state machine: pending -> authorized -> captured, or
--                   declined / failed / voided. Amount and tender never change.
--   payment_events  append-only log of every transition (staff, provider or
--                   system). (provider, provider_event_id) is unique, so a
--                   duplicate provider callback is recognised and ignored.
--   A sale is paid by captured charges whose amounts add up to its total
--   EXACTLY; a split sale (card + cash) is stored as several payments.
--   Refunds are separate payments: cash refunds are captured at once, card
--   refunds stay pending until staff confirm the terminal refund.
--
-- PROVIDERS: 'cash', 'manual_terminal' (cashier charges a bank terminal and
-- records its approval code) and 'sandbox' (test double for the callback
-- path). No provider callback can create a sale or a refund, only move the
-- status of an existing payment.
--
-- CARD DATA: raw card data is never accepted. provider_reference is an
-- approval code / RRN, and 13-19 digit values (card-number shaped) are
-- rejected. See docs/payments.md for the PCI scope note.

insert into public.audit_actions (action, target_type) values
  ('payment_status_changed', 'payment'),
  ('payment_resolved', 'payment');

create type public.payment_direction as enum ('charge', 'refund');
create type public.payment_status as enum ('pending', 'authorized', 'captured', 'declined', 'failed', 'voided');

create or replace function public.valid_payment_reference(p_reference text)
returns boolean
language sql immutable set search_path = ''
as $$
  select p_reference ~ '^[A-Za-z0-9._-]{4,40}$' and p_reference !~ '^[0-9]{13,19}$';
$$;

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  direction public.payment_direction not null,
  tender public.payment_method not null check (tender <> 'split'),
  provider text not null check (provider in ('cash', 'manual_terminal', 'sandbox')),
  provider_reference text check (provider_reference is null or public.valid_payment_reference(provider_reference)),
  amount numeric(12,0) not null check (amount > 0),
  status public.payment_status not null,
  failure_reason text,
  idempotency_key uuid not null unique,
  sale_id uuid references public.sales(id) on delete restrict,
  return_id uuid references public.returns(id) on delete restrict,
  original_payment_id uuid references public.payments(id) on delete restrict,
  legacy boolean not null default false,
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete restrict,
  resolution_note text,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((direction = 'charge' and return_id is null) or (direction = 'refund' and return_id is not null and sale_id is null))
);
create index payments_sale_idx on public.payments (sale_id) where sale_id is not null;
create index payments_return_idx on public.payments (return_id) where return_id is not null;
create index payments_status_idx on public.payments (status, created_at);
create unique index payments_charge_reference_key on public.payments (provider, provider_reference)
  where provider_reference is not null and direction = 'charge';
create unique index payments_refund_reference_key on public.payments (provider, provider_reference)
  where provider_reference is not null and direction = 'refund';

create table public.payment_events (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete restrict,
  provider text not null,
  provider_event_id text,
  from_status public.payment_status,
  to_status public.payment_status not null,
  source text not null check (source in ('staff', 'provider', 'system')),
  actor_id uuid references public.profiles(id) on delete restrict,
  amount numeric(12,0),
  note text,
  created_at timestamptz not null default now()
);
create index payment_events_payment_idx on public.payment_events (payment_id, created_at);
create unique index payment_events_provider_event_key on public.payment_events (provider, provider_event_id)
  where provider_event_id is not null;

alter table public.payments enable row level security;
alter table public.payment_events enable row level security;
create policy "payments: admins and creators read" on public.payments for select to authenticated
  using (public.is_admin() or created_by = auth.uid());
create policy "payment events: readable with the payment" on public.payment_events for select to authenticated
  using (exists (select 1 from public.payments p where p.id = payment_id));
-- No write policies: payments change only through the functions below.

create or replace function public.payment_transition_allowed(p_from public.payment_status, p_to public.payment_status)
returns boolean
language sql immutable set search_path = ''
as $$
  select case p_from
    when 'pending' then p_to in ('authorized', 'captured', 'declined', 'failed', 'voided')
    when 'authorized' then p_to in ('captured', 'voided', 'failed')
    else false
  end;
$$;

create or replace function public.guard_payment()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'payments is immutable (DELETE rejected)' using errcode = 'P0001';
  end if;
  if new.status <> old.status and not public.payment_transition_allowed(old.status, new.status) then
    raise exception 'payment: illegal status change % -> %', old.status, new.status using errcode = 'P0001';
  end if;
  if (new.id, new.direction, new.tender, new.provider, new.amount, new.idempotency_key, new.created_by,
      new.created_at, new.original_payment_id, new.return_id, new.legacy)
     is distinct from
     (old.id, old.direction, old.tender, old.provider, old.amount, old.idempotency_key, old.created_by,
      old.created_at, old.original_payment_id, old.return_id, old.legacy) then
    raise exception 'payments is immutable (identity fields)' using errcode = 'P0001';
  end if;
  if old.provider_reference is not null and new.provider_reference is distinct from old.provider_reference then
    raise exception 'payments is immutable (reference is set once)' using errcode = 'P0001';
  end if;
  if old.sale_id is not null and new.sale_id is distinct from old.sale_id then
    raise exception 'payments is immutable (already linked to a sale)' using errcode = 'P0001';
  end if;
  if new.sale_id is not null and old.sale_id is null and (old.status <> 'captured' or old.direction <> 'charge') then
    raise exception 'payment: only a captured charge can be linked to a sale' using errcode = 'P0001';
  end if;
  if old.resolved_at is not null
     and (new.resolved_at, new.resolved_by, new.resolution_note) is distinct from (old.resolved_at, old.resolved_by, old.resolution_note) then
    raise exception 'payments is immutable (already resolved)' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger payments_guard before update or delete on public.payments
  for each row execute function public.guard_payment();
create trigger payments_no_truncate before truncate on public.payments
  for each statement execute function public.reject_ledger_change();
create trigger payment_events_immutable before update or delete on public.payment_events
  for each row execute function public.reject_ledger_change();
create trigger payment_events_no_truncate before truncate on public.payment_events
  for each statement execute function public.reject_ledger_change();

create or replace function public.record_payment_event(
  p_payment_id uuid, p_from public.payment_status, p_to public.payment_status, p_source text,
  p_actor uuid, p_provider text, p_event_id text, p_amount numeric, p_note text
)
returns void
language sql security definer set search_path = ''
as $$
  insert into public.payment_events (payment_id, provider, provider_event_id, from_status, to_status, source, actor_id, amount, note)
  values (p_payment_id, p_provider, p_event_id, p_from, p_to, p_source, p_actor, p_amount, p_note);
$$;
revoke execute on function public.record_payment_event(uuid, public.payment_status, public.payment_status, text, uuid, text, text, numeric, text)
  from public, anon, authenticated;

-- ---------- backfill: every historic tender becomes a payment ----------
insert into public.payments (direction, tender, provider, amount, status, idempotency_key, sale_id, legacy, created_by, created_at)
select 'charge', s.payment_method,
       case when s.payment_method = 'cash' then 'cash' else 'manual_terminal' end,
       s.total, 'captured', gen_random_uuid(), s.id, true, s.cashier_id, s.created_at
from public.sales s
where s.total > 0;

insert into public.payments (direction, tender, provider, amount, status, idempotency_key, return_id, legacy, created_by, created_at)
select 'refund', r.refund_tender,
       case when r.refund_tender = 'cash' then 'cash' else 'manual_terminal' end,
       r.refund_total, 'captured', gen_random_uuid(), r.id, true, r.actor_id, r.created_at
from public.returns r;

insert into public.payment_events (payment_id, provider, from_status, to_status, source, note)
select p.id, p.provider, null, 'captured', 'system', 'backfilled from the pre-payment-lifecycle record'
from public.payments p where p.legacy;

-- ---------- refunds become payments automatically ----------
create or replace function public.record_refund_payment()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_id uuid; v_status public.payment_status; v_original uuid;
begin
  v_status := case when new.refund_tender = 'cash' then 'captured' else 'pending' end;
  select id into v_original from public.payments
  where sale_id = new.sale_id and direction = 'charge' and status = 'captured' and tender = new.refund_tender
  order by created_at limit 1;
  insert into public.payments (direction, tender, provider, amount, status, idempotency_key, return_id, original_payment_id, created_by)
  values ('refund', new.refund_tender, case when new.refund_tender = 'cash' then 'cash' else 'manual_terminal' end,
          new.refund_total, v_status, gen_random_uuid(), new.id, v_original, new.actor_id)
  returning id into v_id;
  perform public.record_payment_event(v_id, null, v_status, 'system', new.actor_id,
    case when new.refund_tender = 'cash' then 'cash' else 'manual_terminal' end, null, new.refund_total,
    case when v_status = 'pending' then 'confirm the refund on the terminal' else null end);
  return new;
end;
$$;
create trigger returns_record_refund_payment after insert on public.returns
  for each row execute function public.record_refund_payment();

-- ---------- RPCs ----------
create or replace function public.begin_payment(
  p_amount numeric,
  p_tender public.payment_method,
  p_provider text,
  p_idempotency_key uuid,
  p_provider_reference text default null
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := auth.uid(); v_existing public.payments%rowtype; v_id uuid;
begin
  if v_actor is null or not exists (select 1 from public.profiles where id = v_actor and active) then
    raise exception 'payment: not authenticated';
  end if;
  if p_idempotency_key is null then raise exception 'payment: idempotency key is required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 2));
  select * into v_existing from public.payments where idempotency_key = p_idempotency_key;
  if found then
    if v_existing.created_by <> v_actor then raise exception 'payment: idempotency key belongs to another user'; end if;
    return v_existing.id;
  end if;
  if p_amount is null or p_amount <= 0 or p_amount <> trunc(p_amount) then
    raise exception 'payment: amount must be positive whole piasters';
  end if;
  if p_tender <> 'card' then raise exception 'payment: only card payments are started explicitly'; end if;
  if p_provider not in ('manual_terminal', 'sandbox') then raise exception 'payment: unknown provider'; end if;
  if p_provider_reference is not null then
    if not public.valid_payment_reference(p_provider_reference) then raise exception 'payment: invalid reference'; end if;
    if exists (select 1 from public.payments where provider = p_provider and provider_reference = p_provider_reference and direction = 'charge') then
      raise exception 'payment: reference already used';
    end if;
  end if;
  insert into public.payments (direction, tender, provider, provider_reference, amount, status, idempotency_key, created_by)
  values ('charge', p_tender, p_provider, p_provider_reference, p_amount, 'pending', p_idempotency_key, v_actor)
  returning id into v_id;
  perform public.record_payment_event(v_id, null, 'pending', 'staff', v_actor, p_provider, null, p_amount, null);
  return v_id;
end;
$$;

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

-- Called by the webhook route with the service role only.
create or replace function public.apply_provider_event(
  p_provider text,
  p_event_id text,
  p_provider_reference text,
  p_status public.payment_status,
  p_amount numeric
)
returns text
language plpgsql security definer set search_path = ''
as $$
declare v_pay public.payments%rowtype; v_allowed boolean; v_event uuid;
begin
  if p_event_id is null or length(btrim(p_event_id)) = 0 then raise exception 'payment: event id is required'; end if;
  if p_status = 'pending' then raise exception 'payment: invalid provider status'; end if;
  select * into v_pay from public.payments
  where provider = p_provider and provider_reference = p_provider_reference and direction = 'charge' for update;
  if not found then raise exception 'payment: unknown payment'; end if;
  if p_amount is distinct from v_pay.amount then raise exception 'payment: amount mismatch'; end if;

  v_allowed := public.payment_transition_allowed(v_pay.status, p_status);
  insert into public.payment_events (payment_id, provider, provider_event_id, from_status, to_status, source, amount, note)
  values (v_pay.id, p_provider, p_event_id, v_pay.status, case when v_allowed then p_status else v_pay.status end,
          'provider', p_amount, case when v_allowed then null else 'ignored: out-of-order callback' end)
  on conflict (provider, provider_event_id) where provider_event_id is not null do nothing
  returning id into v_event;
  if v_event is null then return 'duplicate'; end if;
  if not v_allowed then return 'ignored'; end if;
  update public.payments set status = p_status where id = v_pay.id;
  return 'applied';
end;
$$;

create or replace function public.resolve_payment(p_payment_id uuid, p_note text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := auth.uid(); v_pay public.payments%rowtype;
begin
  if v_actor is null or not public.is_admin() then raise exception 'payment: admin only'; end if;
  if p_note is null or length(btrim(p_note)) = 0 then raise exception 'payment: a resolution note is required'; end if;
  select * into v_pay from public.payments where id = p_payment_id for update;
  if not found then raise exception 'payment: not found'; end if;
  if v_pay.resolved_at is not null then raise exception 'payment: already resolved'; end if;
  update public.payments set resolved_at = now(), resolved_by = v_actor, resolution_note = btrim(p_note) where id = p_payment_id;
  perform public.write_audit_event(v_actor, null, 'payment_resolved', 'payment', p_payment_id,
    jsonb_build_object('amount', v_pay.amount, 'event_type', v_pay.status::text), null);
end;
$$;

-- ---------- reports ----------
create or replace function public.report_payment_reconciliation(p_from timestamptz, p_to timestamptz)
returns table (issue text, payment_id uuid, sale_id uuid, amount numeric, detail text, created_at timestamptz)
language plpgsql security definer set search_path = '' stable
as $$
#variable_conflict use_column
begin
  perform public.reports_guard();
  return query
    select 'sale_mismatch'::text, null::uuid, s.id,
           s.total - coalesce((select sum(p.amount) from public.payments p
                               where p.sale_id = s.id and p.direction = 'charge' and p.status = 'captured'), 0),
           'sale total differs from the captured payments'::text, s.created_at
    from public.sales s
    where s.created_at >= p_from and s.created_at <= p_to
      and s.total <> coalesce((select sum(p.amount) from public.payments p
                               where p.sale_id = s.id and p.direction = 'charge' and p.status = 'captured'), 0)
    union all
    select 'orphan_payment', p.id, null::uuid, p.amount, 'captured but not linked to any sale', p.created_at
    from public.payments p
    where p.direction = 'charge' and p.status = 'captured' and p.sale_id is null and p.resolved_at is null
      and p.created_at >= p_from and p.created_at <= p_to
    union all
    select 'stale_pending', p.id, null::uuid, p.amount, 'still ' || p.status::text || ' after 15 minutes', p.created_at
    from public.payments p
    where p.direction = 'charge' and p.status in ('pending', 'authorized') and p.resolved_at is null
      and p.created_at < now() - interval '15 minutes'
      and p.created_at >= p_from and p.created_at <= p_to
    union all
    select 'refund_unconfirmed', p.id, null::uuid, p.amount, 'confirm the refund on the terminal', p.created_at
    from public.payments p
    where p.direction = 'refund' and p.status in ('pending', 'authorized') and p.resolved_at is null
      and p.created_at >= p_from and p.created_at <= p_to
    union all
    select 'refund_failed', p.id, null::uuid, p.amount, coalesce(p.failure_reason, p.status::text), p.created_at
    from public.payments p
    where p.direction = 'refund' and p.status in ('declined', 'failed', 'voided') and p.resolved_at is null
      and p.created_at >= p_from and p.created_at <= p_to
    order by 6, 1;
end;
$$;

create or replace function public.report_tender_summary(p_from timestamptz, p_to timestamptz)
returns table (tender public.payment_method, provider text, charges numeric, refunds numeric, net numeric, payment_count bigint)
language plpgsql security definer set search_path = '' stable
as $$
#variable_conflict use_column
begin
  perform public.reports_guard();
  return query
    select p.tender, p.provider,
           coalesce(sum(p.amount) filter (where p.direction = 'charge'), 0),
           coalesce(sum(p.amount) filter (where p.direction = 'refund'), 0),
           coalesce(sum(p.amount) filter (where p.direction = 'charge'), 0)
             - coalesce(sum(p.amount) filter (where p.direction = 'refund'), 0),
           count(*)
    from public.payments p
    where p.status = 'captured' and p.created_at >= p_from and p.created_at <= p_to
    group by p.tender, p.provider
    order by p.tender, p.provider;
end;
$$;

-- Tender totals of one shift (security invoker: RLS decides what the caller may see).
create or replace function public.shift_tender_totals(p_shift_id uuid)
returns table (tender public.payment_method, amount numeric)
language sql stable security invoker set search_path = ''
as $$
  select p.tender, sum(p.amount)
  from public.payments p
  join public.sales s on s.id = p.sale_id
  where s.shift_id = p_shift_id and p.direction = 'charge' and p.status = 'captured'
  group by p.tender;
$$;
grant execute on function public.shift_tender_totals(uuid) to authenticated, service_role;

-- ---------- create_return: refunds follow the tender actually paid ----------

create or replace function public.create_return(
  p_sale_id uuid,
  p_items jsonb,
  p_refund_tender public.payment_method,
  p_reason text,
  p_restock boolean,
  p_approval_id uuid default null
)
returns table (
  return_id uuid,
  return_number bigint,
  refund_total numeric,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_sale public.sales%rowtype;
  v_sale_item public.sale_items%rowtype;
  v_item record;
  v_return_id uuid;
  v_return_number bigint;
  v_created_at timestamptz;
  v_total numeric := 0;
  v_returned_qty numeric;
  v_returned_total numeric;
  v_remaining_qty numeric;
  v_line_total numeric;
  v_threshold numeric;
  v_manager_id uuid;
  v_request_hash text;
  v_paid numeric;
  v_refunded numeric;
begin
  if v_actor_id is null then
    raise exception 'create_return: not authenticated';
  end if;
  if p_sale_id is null then
    raise exception 'create_return: sale_id is required';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'create_return: p_items must be a non-empty json array';
  end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'create_return: reason is required';
  end if;
  if p_restock is null then
    raise exception 'create_return: restock disposition is required';
  end if;

  select * into v_sale from public.sales where id = p_sale_id for share;
  if not found then
    raise exception 'create_return: sale not found';
  end if;
  if v_sale.cashier_id <> v_actor_id and not public.is_admin() then
    raise exception 'create_return: not your sale';
  end if;
  -- A refund must go back through a tender the customer actually paid with.
  if not exists (
    select 1 from public.payments pm
    where pm.sale_id = p_sale_id and pm.direction = 'charge' and pm.status = 'captured' and pm.tender = p_refund_tender
  ) then
    raise exception 'create_return: refund tender must match the original payment tender';
  end if;

  -- Aggregate duplicate JSON rows before locking so a request cannot bypass
  -- the remaining-quantity check by repeating one sale_item_id.
  for v_item in
    select (entry->>'sale_item_id')::uuid as sale_item_id,
           sum((entry->>'qty')::numeric) as qty
    from jsonb_array_elements(p_items) as entry
    group by (entry->>'sale_item_id')::uuid
  loop
    if v_item.sale_item_id is null or v_item.qty is null or v_item.qty <= 0 then
      raise exception 'create_return: each item needs a sale_item_id and a positive qty';
    end if;

    select * into v_sale_item
    from public.sale_items
    where id = v_item.sale_item_id and sale_id = p_sale_id
    for update;
    if not found then
      raise exception 'create_return: sale item does not belong to the original sale';
    end if;

    select coalesce(sum(ri.qty), 0), coalesce(sum(ri.line_refund_total), 0)
    into v_returned_qty, v_returned_total
    from public.return_items ri
    join public.returns r on r.id = ri.return_id
    where ri.sale_item_id = v_sale_item.id;

    v_remaining_qty := v_sale_item.qty - v_returned_qty;
    if v_item.qty > v_remaining_qty then
      raise exception 'create_return: return quantity exceeds sold quantity';
    end if;

    -- On the final partial return, use the remainder to guarantee that
    -- rounded partial refunds sum exactly to the original snapshot total.
    if v_item.qty = v_remaining_qty then
      v_line_total := v_sale_item.line_total - v_returned_total;
    else
      v_line_total := round(v_sale_item.line_total * v_item.qty / v_sale_item.qty);
    end if;
    if v_line_total <= 0 then
      raise exception 'create_return: selected quantity has no refundable value';
    end if;
    v_total := v_total + v_line_total;
  end loop;

  -- Per tender: what was paid in that tender minus what was already refunded in it.
  select coalesce(sum(pm.amount), 0) into v_paid
  from public.payments pm
  where pm.sale_id = p_sale_id and pm.direction = 'charge' and pm.status = 'captured' and pm.tender = p_refund_tender;
  select coalesce(sum(r.refund_total), 0) into v_refunded
  from public.returns r
  where r.sale_id = p_sale_id and r.refund_tender = p_refund_tender;
  if v_refunded + v_total > v_paid then
    raise exception 'create_return: refund exceeds the original paid amount';
  end if;

  select manager_approval_threshold into v_threshold
  from public.return_settings where id = true;
  if not public.is_admin() and v_threshold is not null and v_total >= v_threshold then
    if p_approval_id is null then
      raise exception 'create_return: manager approval is required';
    end if;
    v_request_hash := encode(extensions.digest(
      'return|' || p_sale_id::text || '|' || p_refund_tender::text || '|' || btrim(p_reason) || '|' || p_restock::text || '|' || v_total::text,
      'sha256'
    ), 'hex');
    v_manager_id := public.consume_manager_approval(p_approval_id, 'return', v_request_hash);
  end if;

  insert into public.returns
    (sale_id, actor_id, manager_approved_by, reason, refund_tender, refund_total, restock)
  values
    (p_sale_id, v_actor_id, v_manager_id, btrim(p_reason), p_refund_tender, v_total, p_restock)
  returning id, public.returns.return_number, public.returns.created_at
  into v_return_id, v_return_number, v_created_at;

  for v_item in
    select (entry->>'sale_item_id')::uuid as sale_item_id,
           sum((entry->>'qty')::numeric) as qty
    from jsonb_array_elements(p_items) as entry
    group by (entry->>'sale_item_id')::uuid
  loop
    select * into v_sale_item from public.sale_items where id = v_item.sale_item_id;
    select coalesce(sum(ri.qty), 0), coalesce(sum(ri.line_refund_total), 0)
    into v_returned_qty, v_returned_total
    from public.return_items ri
    join public.returns r on r.id = ri.return_id
    where ri.sale_item_id = v_sale_item.id;

    -- The new return is not yet represented in return_items, so use the
    -- pre-insert aggregate to retain the exact final-return remainder.
    v_remaining_qty := v_sale_item.qty - v_returned_qty;
    if v_item.qty = v_remaining_qty then
      v_line_total := v_sale_item.line_total - v_returned_total;
    else
      v_line_total := round(v_sale_item.line_total * v_item.qty / v_sale_item.qty);
    end if;

    insert into public.return_items
      (return_id, sale_item_id, product_id, name_ar, name_en, unit_price, tax_rate, qty, line_refund_total)
    values
      (v_return_id, v_sale_item.id, v_sale_item.product_id, v_sale_item.name_ar, v_sale_item.name_en,
       v_sale_item.unit_price, v_sale_item.tax_rate, v_item.qty, v_line_total);

    if p_restock then
      update public.products set stock_qty = stock_qty + v_item.qty where id = v_sale_item.product_id;
      insert into public.stock_movements (product_id, qty_change, reason, reference_id, note, created_by)
      values (v_sale_item.product_id, v_item.qty, 'return', v_return_id, 'Return #' || v_return_number, v_actor_id);
    end if;
  end loop;

  perform public.write_audit_event(
    v_actor_id, v_manager_id, 'return_created', 'return', v_return_id,
    jsonb_build_object('refund_total', v_total, 'payment_method', p_refund_tender::text, 'restock', p_restock, 'reason_length', length(btrim(p_reason))),
    null
  );

  return query select v_return_id, v_return_number, v_total, v_created_at;
end;
$$;

-- ---------- create_sale: tender validation and payment records ----------
drop function public.create_sale(jsonb, public.payment_method, uuid, numeric, uuid, uuid, uuid, timestamptz, uuid, text[], boolean, numeric);
create or replace function public.create_sale(
  p_items jsonb,
  p_payment_method public.payment_method,
  p_shift_id uuid default null,
  p_amount_tendered numeric default null,
  p_cashier_id uuid default null,
  p_approval_id uuid default null,
  p_idempotency_key uuid default null,
  p_client_sold_at timestamptz default null,
  p_customer_id uuid default null,
  p_promotion_codes text[] default null,
  p_apply_promotions boolean default true,
  p_expected_total numeric default null,
  p_payment_ids uuid[] default null,
  p_card_reference text default null
)
returns table (
  sale_id uuid,
  sale_number bigint,
  subtotal numeric,
  tax_total numeric,
  discount_total numeric,
  total numeric,
  change_due numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cashier_id uuid;
  v_sale_id uuid;
  v_sale_number bigint;
  v_item record;
  v_product public.products%rowtype;
  v_line_gross numeric;   -- piasters, VAT-inclusive, after line discount
  v_line_net numeric;     -- piasters, VAT extracted
  v_lines jsonb := '[]'::jsonb; -- validated lines, written after the sale row exists
  v_line jsonb;
  v_subtotal numeric := 0;
  v_tax_total numeric := 0;
  v_discount_total numeric := 0;
  v_total numeric := 0;
  v_change numeric;
  v_gross_total numeric := 0;   -- piasters before any discount
  v_threshold_bp integer;
  v_needs_override boolean := false;
  v_approved_by uuid;
  v_hash text;
  v_existing public.sales%rowtype;
  v_promos jsonb := '[]'::jsonb;     -- [{i: line index, p: promotion id, d: discount}]
  v_manual_discount numeric := 0;    -- cashier discounts only: promotions are pre-authorised
  v_idx integer;
  v_promo_disc numeric;
  v_item_id uuid;
  v_promo_count integer := 0;
  v_promo_amount numeric := 0;
  v_has_limits boolean;
  v_method public.payment_method;
  v_card_paid numeric := 0;
  v_cash_portion numeric := 0;
  v_pay public.payments%rowtype;
  v_pay_count integer := 0;
  v_pay_id uuid;
begin
  v_cashier_id := coalesce(p_cashier_id, auth.uid());
  if v_cashier_id is null then
    raise exception 'create_sale: no cashier (not authenticated and p_cashier_id is null)';
  end if;

  -- The caller must be an active profile; when called with an explicit
  -- p_cashier_id different from the session user, only admins may do so
  -- (prevents a cashier recording sales as someone else).
  if auth.uid() is not null
     and v_cashier_id <> auth.uid()
     and not public.is_admin() then
    raise exception 'create_sale: cannot record a sale for another cashier';
  end if;

  -- Idempotency: a queued offline sale may be submitted more than once
  -- (lost response, retry, duplicate tab). Duplicates serialize on the key
  -- and replay the original result instead of creating a second sale.
  if p_idempotency_key is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));
    select * into v_existing from public.sales where idempotency_key = p_idempotency_key;
    if found then
      if v_existing.cashier_id <> v_cashier_id then
        raise exception 'create_sale: idempotency key belongs to another cashier';
      end if;
      return query
        select v_existing.id, v_existing.sale_number, v_existing.subtotal, v_existing.tax_total,
               v_existing.discount_total, v_existing.total, v_existing.change_due;
      return;
    end if;
  end if;

  if p_client_sold_at is not null
     and (p_client_sold_at > now() + interval '5 minutes' or p_client_sold_at < now() - interval '7 days') then
    raise exception 'create_sale: client sold_at is out of range';
  end if;

  if p_customer_id is not null
     and not exists (select 1 from public.customers where id = p_customer_id and anonymized_at is null) then
    raise exception 'create_sale: customer not found';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'create_sale: p_items must be a non-empty json array';
  end if;

  -- PASS 1 — validate every line and lock stock BEFORE inserting the sale.
  -- The sale_number sequence is only consumed once checkout is certain to
  -- succeed, so rejected checkouts (insufficient stock, bad tender, …)
  -- don't leave gaps in receipt numbers.
  for v_item in
    select
      (elem->>'product_id')::uuid  as product_id,
      (elem->>'qty')::numeric      as qty,
      coalesce((elem->>'line_discount')::numeric, 0) as line_discount
    from jsonb_array_elements(p_items) as elem
  loop
    if v_item.product_id is null or v_item.qty is null or v_item.qty <= 0 then
      raise exception 'create_sale: each item needs a product_id and a positive qty';
    end if;
    if v_item.line_discount < 0 then
      raise exception 'create_sale: line_discount cannot be negative';
    end if;

    -- Lock the product row: concurrent checkouts of the same product
    -- serialize here, so stock can never go negative.
    select * into v_product
    from public.products
    where id = v_item.product_id and active
    for update;

    if not found then
      raise exception 'create_sale: product % not found or inactive', v_item.product_id;
    end if;

    if v_product.unit = 'piece' and v_item.qty <> trunc(v_item.qty) then
      raise exception 'create_sale: product % (%) is sold per piece — qty must be a whole number',
        v_product.name_en, v_product.barcode;
    end if;

    if v_product.stock_qty < v_item.qty then
      raise exception 'create_sale: insufficient stock for % (%): have %, need %',
        v_product.name_en, v_product.barcode, v_product.stock_qty, v_item.qty
        using errcode = 'P0001';
    end if;

    -- All piaster amounts stay integers: round once per line.
    v_line_gross := round(v_product.price * v_item.qty) - v_item.line_discount;
    if v_line_gross < 0 then
      raise exception 'create_sale: discount exceeds line amount for % (%)',
        v_product.name_en, v_product.barcode;
    end if;
    -- Price is VAT-inclusive; extract the net portion.
    v_line_net := round(v_line_gross / (1 + v_product.tax_rate));

    v_lines := v_lines || jsonb_build_object(
      'product_id', v_product.id,
      'name_ar', v_product.name_ar,
      'name_en', v_product.name_en,
      'unit_price', v_product.price,
      'tax_rate', v_product.tax_rate,
      'unit_cost', v_product.cost,
      'qty', v_item.qty,
      'line_discount', v_item.line_discount,
      'line_total', v_line_gross
    );

    v_subtotal := v_subtotal + v_line_net;
    v_tax_total := v_tax_total + (v_line_gross - v_line_net);
    v_discount_total := v_discount_total + v_item.line_discount;
    v_gross_total := v_gross_total + round(v_product.price * v_item.qty);
    v_total := v_total + v_line_gross;
  end loop;

  -- Cumulative stock check: the per-line check above misses the case of
  -- the same product appearing on several lines. Rows are already locked.
  for v_item in
    select p.name_en, p.barcode, p.stock_qty, sum((elem->>'qty')::numeric) as needed
    from jsonb_array_elements(p_items) as elem
    join public.products p on p.id = (elem->>'product_id')::uuid
    group by p.id, p.name_en, p.barcode, p.stock_qty
    having p.stock_qty < sum((elem->>'qty')::numeric)
  loop
    raise exception 'create_sale: insufficient stock for % (%): have %, need %',
      v_item.name_en, v_item.barcode, v_item.stock_qty, v_item.needed
      using errcode = 'P0001';
  end loop;

  v_manual_discount := v_discount_total;

  -- Promotions are evaluated here, on the locked and validated lines, so the
  -- register preview and the recorded sale use the very same function.
  if p_apply_promotions then
    select exists (select 1 from public.promotions where active and (max_redemptions is not null or max_per_customer is not null))
      into v_has_limits;
    if v_has_limits then
      perform pg_advisory_xact_lock(hashtextextended('promotion-limits', 0));
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('i', e.line_idx, 'p', e.promotion_id, 'd', e.discount)), '[]'::jsonb)
      into v_promos
      from public.evaluate_promotions(p_items, p_customer_id, p_promotion_codes) e;
  end if;
  if jsonb_array_length(v_promos) > 0 then
    v_subtotal := 0; v_tax_total := 0; v_total := 0; v_discount_total := 0;
    for v_idx in 0 .. jsonb_array_length(v_lines) - 1 loop
      v_line := v_lines -> v_idx;
      select coalesce(sum((e->>'d')::numeric), 0) into v_promo_disc
        from jsonb_array_elements(v_promos) e where (e->>'i')::integer = v_idx;
      v_line_gross := (v_line->>'line_total')::numeric - v_promo_disc;
      v_line_net := round(v_line_gross / (1 + (v_line->>'tax_rate')::numeric));
      v_lines := jsonb_set(v_lines, array[v_idx::text], v_line || jsonb_build_object(
        'line_discount', (v_line->>'line_discount')::numeric + v_promo_disc,
        'line_total', v_line_gross));
      v_subtotal := v_subtotal + v_line_net;
      v_tax_total := v_tax_total + (v_line_gross - v_line_net);
      v_total := v_total + v_line_gross;
      v_discount_total := v_discount_total + (v_line->>'line_discount')::numeric + v_promo_disc;
    end loop;
  end if;
  if p_expected_total is not null and p_expected_total <> v_total then
    raise exception 'create_sale: total changed (now %)', v_total;
  end if;

  -- Cashier discounts above the configured share of the gross need the
  -- discount.override capability or a bound one-time manager approval.
  select approval_threshold_bp into v_threshold_bp from public.discount_settings where id = true;
  v_needs_override := v_manual_discount > 0
    and v_manual_discount * 10000 > v_gross_total * coalesce(v_threshold_bp, 0);
  if v_needs_override and not public.has_capability('discount.override') then
    if p_approval_id is null then
      raise exception 'create_sale: manager approval is required for this discount';
    end if;
    v_hash := encode(extensions.digest('sale_discount|' || v_gross_total::text || '|' || v_manual_discount::text, 'sha256'), 'hex');
    v_approved_by := public.consume_manager_approval(p_approval_id, 'sale_discount', v_hash);
  end if;

  -- Tender: captured card payments (if any) are validated and locked here;
  -- the cash remainder is whatever they do not cover. Payment rows are
  -- written after the sale row exists, in the same transaction.
  v_method := p_payment_method;
  if p_payment_ids is not null and coalesce(array_length(p_payment_ids, 1), 0) > 0 then
    for v_pay in select * from public.payments where id = any (p_payment_ids) order by id for update loop
      v_pay_count := v_pay_count + 1;
      if v_pay.direction <> 'charge' or v_pay.tender <> 'card' then
        raise exception 'create_sale: payment is not a card charge';
      end if;
      if v_pay.created_by <> v_cashier_id then raise exception 'create_sale: payment is not yours'; end if;
      if v_pay.sale_id is not null then raise exception 'create_sale: payment already used'; end if;
      if v_pay.status <> 'captured' then raise exception 'create_sale: payment is not captured'; end if;
      v_card_paid := v_card_paid + v_pay.amount;
    end loop;
    if v_pay_count <> (select count(distinct x) from unnest(p_payment_ids) x) then
      raise exception 'create_sale: payment not found';
    end if;
  end if;

  if p_payment_method = 'card' then
    if v_card_paid > 0 then
      if v_card_paid <> v_total then
        raise exception 'create_sale: card payments (%) must equal the sale total (%)', v_card_paid, v_total;
      end if;
    else
      if p_card_reference is null or length(btrim(p_card_reference)) = 0 then
        raise exception 'create_sale: card payment needs a terminal approval reference';
      end if;
      if not public.valid_payment_reference(p_card_reference) then
        raise exception 'create_sale: invalid reference (use the terminal approval code, never a card number)';
      end if;
      if exists (select 1 from public.payments where provider = 'manual_terminal' and provider_reference = p_card_reference and direction = 'charge') then
        raise exception 'create_sale: reference already used';
      end if;
    end if;
  elsif p_payment_method = 'cash' then
    if p_amount_tendered is null then
      raise exception 'create_sale: amount_tendered is required for cash payment';
    end if;
    if v_card_paid > 0 then
      if v_card_paid >= v_total then
        raise exception 'create_sale: card payments already cover the sale; pay it as card';
      end if;
      v_cash_portion := v_total - v_card_paid;
      v_method := 'split';
      if p_amount_tendered < v_cash_portion then
        raise exception 'create_sale: amount tendered (%) is less than the cash portion (%)', p_amount_tendered, v_cash_portion;
      end if;
    else
      v_cash_portion := v_total;
      if p_amount_tendered < v_total then
        raise exception 'create_sale: amount tendered (%) is less than total (%)',
          p_amount_tendered, v_total;
      end if;
    end if;
    v_change := p_amount_tendered - v_cash_portion;
  end if;

  -- PASS 2 — everything validated; persist the sale, its snapshot items,
  -- the stock decrements and the movement log. Still one transaction:
  -- any failure below rolls back all of it.
  insert into public.sales
    (shift_id, cashier_id, subtotal, tax_total, discount_total, total,
     payment_method, amount_tendered, change_due, idempotency_key, client_sold_at, customer_id)
  values
    (p_shift_id, v_cashier_id, v_subtotal, v_tax_total, v_discount_total, v_total,
     v_method,
     case when p_payment_method = 'cash' then p_amount_tendered end,
     v_change, p_idempotency_key, p_client_sold_at, p_customer_id)
  returning id, public.sales.sale_number into v_sale_id, v_sale_number;

  -- Payments: link the captured card payments, then record what was taken
  -- directly (terminal approval reference and/or the cash portion).
  if v_pay_count > 0 then
    update public.payments set sale_id = v_sale_id where id = any (p_payment_ids);
  end if;
  if p_payment_method = 'card' and v_card_paid = 0 then
    insert into public.payments (direction, tender, provider, provider_reference, amount, status, idempotency_key, sale_id, created_by)
    values ('charge', 'card', 'manual_terminal', p_card_reference, v_total, 'captured', gen_random_uuid(), v_sale_id, v_cashier_id)
    returning id into v_pay_id;
    perform public.record_payment_event(v_pay_id, null, 'captured', 'system', v_cashier_id, 'manual_terminal', null, v_total, 'terminal approval recorded at the sale');
  end if;
  if v_cash_portion > 0 then
    insert into public.payments (direction, tender, provider, amount, status, idempotency_key, sale_id, created_by)
    values ('charge', 'cash', 'cash', v_cash_portion, 'captured', gen_random_uuid(), v_sale_id, v_cashier_id)
    returning id into v_pay_id;
    perform public.record_payment_event(v_pay_id, null, 'captured', 'system', v_cashier_id, 'cash', null, v_cash_portion, null);
  end if;

  for v_idx in 0 .. jsonb_array_length(v_lines) - 1
  loop
    v_line := v_lines -> v_idx;
    insert into public.sale_items
      (sale_id, product_id, name_ar, name_en, unit_price, tax_rate, unit_cost, qty, line_discount, line_total)
    values
      (v_sale_id,
       (v_line->>'product_id')::uuid,
       v_line->>'name_ar',
       v_line->>'name_en',
       (v_line->>'unit_price')::numeric,
       (v_line->>'tax_rate')::numeric,
       (v_line->>'unit_cost')::numeric,
       (v_line->>'qty')::numeric,
       (v_line->>'line_discount')::numeric,
       (v_line->>'line_total')::numeric)
    returning id into v_item_id;

    insert into public.sale_item_promotions (sale_item_id, promotion_id, name_ar, name_en, code, discount)
    select v_item_id, pm.id, pm.name_ar, pm.name_en, pm.code, (e->>'d')::numeric
    from jsonb_array_elements(v_promos) e
    join public.promotions pm on pm.id = (e->>'p')::uuid
    where (e->>'i')::integer = v_idx;

    update public.products
    set stock_qty = stock_qty - (v_line->>'qty')::numeric
    where id = (v_line->>'product_id')::uuid;

    insert into public.stock_movements (product_id, qty_change, reason, reference_id, created_by)
    values ((v_line->>'product_id')::uuid, -(v_line->>'qty')::numeric, 'sale', v_sale_id, v_cashier_id);
  end loop;

  if v_needs_override then
    perform public.write_audit_event(v_cashier_id, v_approved_by, 'sale_discount_override', 'sale', v_sale_id,
      jsonb_build_object('discount_total', v_manual_discount, 'amount', v_gross_total), null);
  end if;

  if jsonb_array_length(v_promos) > 0 then
    insert into public.promotion_redemptions (promotion_id, sale_id, customer_id, code, amount)
    select pm.id, v_sale_id, p_customer_id, pm.code, sum((e->>'d')::numeric)
    from jsonb_array_elements(v_promos) e
    join public.promotions pm on pm.id = (e->>'p')::uuid
    group by pm.id, pm.code;
    select count(distinct e->>'p'), coalesce(sum((e->>'d')::numeric), 0) into v_promo_count, v_promo_amount
      from jsonb_array_elements(v_promos) e;
    perform public.write_audit_event(v_cashier_id, null, 'promotion_applied', 'sale', v_sale_id,
      jsonb_build_object('item_count', v_promo_count, 'discount_total', v_promo_amount), null);
  end if;

  return query
    select v_sale_id, v_sale_number, v_subtotal, v_tax_total, v_discount_total, v_total, v_change;
end;
$$;

revoke execute on function public.create_sale(jsonb, public.payment_method, uuid, numeric, uuid, uuid, uuid, timestamptz, uuid, text[], boolean, numeric, uuid[], text) from public, anon;
grant execute on function public.create_sale(jsonb, public.payment_method, uuid, numeric, uuid, uuid, uuid, timestamptz, uuid, text[], boolean, numeric, uuid[], text) to authenticated, service_role;

revoke execute on function
  public.valid_payment_reference(text),
  public.payment_transition_allowed(public.payment_status, public.payment_status),
  public.begin_payment(numeric, public.payment_method, text, uuid, text),
  public.record_payment_result(uuid, public.payment_status, text, text),
  public.apply_provider_event(text, text, text, public.payment_status, numeric),
  public.resolve_payment(uuid, text),
  public.report_payment_reconciliation(timestamptz, timestamptz),
  public.report_tender_summary(timestamptz, timestamptz)
from public, anon, authenticated;
grant execute on function
  public.valid_payment_reference(text),
  public.payment_transition_allowed(public.payment_status, public.payment_status),
  public.begin_payment(numeric, public.payment_method, text, uuid, text),
  public.record_payment_result(uuid, public.payment_status, text, text),
  public.resolve_payment(uuid, text),
  public.report_payment_reconciliation(timestamptz, timestamptz),
  public.report_tender_summary(timestamptz, timestamptz)
to authenticated, service_role;
-- Provider callbacks are applied by the webhook route only (service role).
grant execute on function public.apply_provider_event(text, text, text, public.payment_status, numeric) to service_role;
