-- Audit hardening: discount-override approvals, audited cart voids, and
-- database-enforced immutability for every financial ledger.

-- ---------- Settings: share of the gross a cashier may discount unapproved ----------
create table public.discount_settings (
  id boolean primary key default true check (id),
  approval_threshold_bp integer not null default 1000
    check (approval_threshold_bp between 0 and 10000)
);
insert into public.discount_settings (id) values (true);
alter table public.discount_settings enable row level security;
create policy "discount settings: authenticated read"
  on public.discount_settings for select to authenticated using (true);
create policy "discount settings: admins write"
  on public.discount_settings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------- Extend audit + approval vocabularies ----------
alter table public.audit_events drop constraint audit_events_action_check;
alter table public.audit_events add constraint audit_events_action_check check (action in (
  'approval_created', 'stock_correction', 'cash_drawer_event',
  'return_created', 'sale_discount_override', 'shift_close', 'cart_void'
));
alter table public.manager_approvals drop constraint manager_approvals_action_check;
alter table public.manager_approvals add constraint manager_approvals_action_check check (action in (
  'cash_drawer_event', 'stock_correction', 'return', 'sale_discount', 'shift_close', 'cart_void'
));

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
    'return_created', 'sale_discount_override', 'shift_close', 'cart_void'
  ) or p_target_type not in ('approval', 'product', 'shift', 'return', 'sale') then
    raise exception 'audit: invalid event';
  end if;
  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'audit: metadata must be an object';
  end if;
  for v_key in select jsonb_object_keys(p_metadata) loop
    if v_key not in (
      'amount', 'capability', 'discount_total', 'event_type', 'expected_cash',
      'hash_prefix', 'item_count', 'payment_method', 'reason_length', 'refund_total',
      'restock', 'shift_id', 'signed_qty_change', 'variance'
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

create or replace function public.create_manager_approval(
  p_action text,
  p_request_hash text,
  p_pin text
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_manager_id uuid; v_approval_id uuid; v_actor_id uuid := auth.uid();
begin
  if v_actor_id is null then raise exception 'approval: not authenticated'; end if;
  if p_action not in ('cash_drawer_event', 'stock_correction', 'return', 'sale_discount', 'shift_close', 'cart_void') then
    raise exception 'approval: invalid action';
  end if;
  if p_request_hash is null or p_request_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'approval: invalid request hash';
  end if;
  select id into v_manager_id from public.profiles
  where role = 'admin' and active and pin_hash = extensions.crypt(p_pin, pin_hash)
  limit 1;
  if v_manager_id is null then raise exception 'approval: manager approval is required'; end if;
  insert into public.manager_approvals (action, request_hash, requested_by, approved_by)
  values (p_action, p_request_hash, v_actor_id, v_manager_id) returning id into v_approval_id;
  perform public.write_audit_event(
    v_actor_id, v_manager_id, 'approval_created', 'approval', v_approval_id,
    jsonb_build_object('hash_prefix', left(p_request_hash, 12)), null
  );
  return v_approval_id;
end;
$$;
grant execute on function public.create_manager_approval(text, text, text) to authenticated, service_role;

-- ---------- create_sale: discount-override approval (stock/price/number logic unchanged) ----------
drop function public.create_sale(jsonb, public.payment_method, uuid, numeric, uuid);

create or replace function public.create_sale(
  p_items jsonb,
  p_payment_method public.payment_method,
  p_shift_id uuid default null,
  p_amount_tendered numeric default null,
  p_cashier_id uuid default null,
  p_approval_id uuid default null
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

  -- Discounts above the configured share of the gross need the
  -- discount.override capability or a bound one-time manager approval.
  select approval_threshold_bp into v_threshold_bp from public.discount_settings where id = true;
  v_needs_override := v_discount_total > 0
    and v_discount_total * 10000 > v_gross_total * coalesce(v_threshold_bp, 0);
  if v_needs_override and not public.has_capability('discount.override') then
    if p_approval_id is null then
      raise exception 'create_sale: manager approval is required for this discount';
    end if;
    v_hash := encode(extensions.digest('sale_discount|' || v_gross_total::text || '|' || v_discount_total::text, 'sha256'), 'hex');
    v_approved_by := public.consume_manager_approval(p_approval_id, 'sale_discount', v_hash);
  end if;

  if p_payment_method = 'cash' then
    if p_amount_tendered is null then
      raise exception 'create_sale: amount_tendered is required for cash payment';
    end if;
    if p_amount_tendered < v_total then
      raise exception 'create_sale: amount tendered (%) is less than total (%)',
        p_amount_tendered, v_total;
    end if;
    v_change := p_amount_tendered - v_total;
  end if;

  -- PASS 2 — everything validated; persist the sale, its snapshot items,
  -- the stock decrements and the movement log. Still one transaction:
  -- any failure below rolls back all of it.
  insert into public.sales
    (shift_id, cashier_id, subtotal, tax_total, discount_total, total,
     payment_method, amount_tendered, change_due)
  values
    (p_shift_id, v_cashier_id, v_subtotal, v_tax_total, v_discount_total, v_total,
     p_payment_method,
     case when p_payment_method = 'cash' then p_amount_tendered end,
     v_change)
  returning id, public.sales.sale_number into v_sale_id, v_sale_number;

  for v_line in select * from jsonb_array_elements(v_lines)
  loop
    insert into public.sale_items
      (sale_id, product_id, name_ar, name_en, unit_price, tax_rate, qty, line_discount, line_total)
    values
      (v_sale_id,
       (v_line->>'product_id')::uuid,
       v_line->>'name_ar',
       v_line->>'name_en',
       (v_line->>'unit_price')::numeric,
       (v_line->>'tax_rate')::numeric,
       (v_line->>'qty')::numeric,
       (v_line->>'line_discount')::numeric,
       (v_line->>'line_total')::numeric);

    update public.products
    set stock_qty = stock_qty - (v_line->>'qty')::numeric
    where id = (v_line->>'product_id')::uuid;

    insert into public.stock_movements (product_id, qty_change, reason, reference_id, created_by)
    values ((v_line->>'product_id')::uuid, -(v_line->>'qty')::numeric, 'sale', v_sale_id, v_cashier_id);
  end loop;

  if v_needs_override then
    perform public.write_audit_event(v_cashier_id, v_approved_by, 'sale_discount_override', 'sale', v_sale_id,
      jsonb_build_object('discount_total', v_discount_total, 'amount', v_gross_total), null);
  end if;

  return query
    select v_sale_id, v_sale_number, v_subtotal, v_tax_total, v_discount_total, v_total, v_change;
end;
$$;

revoke execute on function public.create_sale(jsonb, public.payment_method, uuid, numeric, uuid, uuid) from public, anon;
grant execute on function public.create_sale(jsonb, public.payment_method, uuid, numeric, uuid, uuid) to authenticated, service_role;

-- ---------- Audited cart void ----------
-- Abandoning a non-empty cart is a classic till-fraud vector, so it needs
-- the cart.void capability or a bound manager approval, and leaves one event.
create or replace function public.record_cart_void(
  p_item_count integer,
  p_value numeric,
  p_approval_id uuid default null
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_actor_id uuid := auth.uid(); v_shift_id uuid; v_approved_by uuid; v_hash text;
begin
  if v_actor_id is null then raise exception 'cart void: not authenticated'; end if;
  if p_item_count is null or p_item_count <= 0 or p_value is null or p_value < 0 then
    raise exception 'cart void: invalid cart';
  end if;
  select id into v_shift_id from public.shifts where cashier_id = v_actor_id and closed_at is null;
  if v_shift_id is null then raise exception 'cart void: no open shift'; end if;
  if not public.has_capability('cart.void') then
    if p_approval_id is null then raise exception 'cart void: approval is required'; end if;
    v_hash := encode(extensions.digest('cart_void|' || p_item_count::text || '|' || p_value::text, 'sha256'), 'hex');
    v_approved_by := public.consume_manager_approval(p_approval_id, 'cart_void', v_hash);
  end if;
  perform public.write_audit_event(v_actor_id, v_approved_by, 'cart_void', 'shift', v_shift_id,
    jsonb_build_object('item_count', p_item_count, 'amount', p_value), null);
end;
$$;
revoke execute on function public.record_cart_void(integer, numeric, uuid) from public, anon;
grant execute on function public.record_cart_void(integer, numeric, uuid) to authenticated, service_role;

-- ---------- Immutability: ledgers are append-only for every role ----------
-- RLS only stops app users; these triggers also stop service_role and
-- dashboard edits. Ordinary triggers do not fire under
-- session_replication_role = replica, which only a superuser may set —
-- the deliberate escape hatch for test fixtures and DBA repair.
create or replace function public.reject_ledger_change()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  raise exception '% is immutable (% rejected)', tg_table_name, tg_op using errcode = 'P0001';
end;
$$;

create trigger audit_events_immutable before update or delete on public.audit_events
  for each row execute function public.reject_ledger_change();
create trigger cash_drawer_events_immutable before update or delete on public.cash_drawer_events
  for each row execute function public.reject_ledger_change();
create trigger stock_movements_immutable before update or delete on public.stock_movements
  for each row execute function public.reject_ledger_change();
create trigger returns_immutable before update or delete on public.returns
  for each row execute function public.reject_ledger_change();
create trigger return_items_immutable before update or delete on public.return_items
  for each row execute function public.reject_ledger_change();
create trigger sales_immutable before update or delete on public.sales
  for each row execute function public.reject_ledger_change();
create trigger sale_items_immutable before update or delete on public.sale_items
  for each row execute function public.reject_ledger_change();
create trigger manager_approvals_no_delete before delete on public.manager_approvals
  for each row execute function public.reject_ledger_change();

create trigger audit_events_no_truncate before truncate on public.audit_events
  for each statement execute function public.reject_ledger_change();
create trigger cash_drawer_events_no_truncate before truncate on public.cash_drawer_events
  for each statement execute function public.reject_ledger_change();
create trigger stock_movements_no_truncate before truncate on public.stock_movements
  for each statement execute function public.reject_ledger_change();
create trigger sales_no_truncate before truncate on public.sales
  for each statement execute function public.reject_ledger_change();
create trigger sale_items_no_truncate before truncate on public.sale_items
  for each statement execute function public.reject_ledger_change();

-- An approval may only be consumed (used_at null -> timestamp); its binding
-- to requester, approver, action, hash and expiry can never be rewritten.
create or replace function public.guard_manager_approval_update()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if old.used_at is not null
     or new.used_at is null
     or (new.id, new.action, new.request_hash, new.requested_by, new.approved_by, new.expires_at, new.created_at)
        is distinct from
        (old.id, old.action, old.request_hash, old.requested_by, old.approved_by, old.expires_at, old.created_at)
  then
    raise exception 'manager_approvals is immutable (only consumption is allowed)' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger manager_approvals_guard_update before update on public.manager_approvals
  for each row execute function public.guard_manager_approval_update();
