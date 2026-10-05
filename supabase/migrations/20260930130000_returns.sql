-- Immutable, auditable sale corrections. A completed sale and its items are
-- never modified; returns are separate facts and may restore stock.

alter type public.stock_movement_reason add value if not exists 'return';

create sequence public.return_number_seq;

create table public.return_settings (
  id boolean primary key default true check (id),
  -- Null means no manager approval is required. A non-null piaster amount
  -- requires an active admin's PIN for a cashier return at or above it.
  manager_approval_threshold numeric(12,0) check (manager_approval_threshold >= 0),
  updated_at timestamptz not null default now()
);

insert into public.return_settings (id) values (true);

create table public.returns (
  id uuid primary key default gen_random_uuid(),
  return_number bigint not null unique default nextval('public.return_number_seq'),
  sale_id uuid not null references public.sales(id) on delete restrict,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  manager_approved_by uuid references public.profiles(id) on delete restrict,
  reason text not null check (length(btrim(reason)) > 0),
  refund_tender public.payment_method not null,
  refund_total numeric(12,0) not null check (refund_total > 0),
  restock boolean not null,
  created_at timestamptz not null default now()
);

create index returns_sale_id_idx on public.returns (sale_id);
create index returns_actor_id_idx on public.returns (actor_id);

create table public.return_items (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references public.returns(id) on delete restrict,
  sale_item_id uuid not null references public.sale_items(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  name_ar text not null,
  name_en text not null,
  unit_price numeric(12,0) not null check (unit_price >= 0),
  tax_rate numeric(5,4) not null check (tax_rate >= 0 and tax_rate <= 1),
  qty numeric(10,3) not null check (qty > 0),
  line_refund_total numeric(12,0) not null check (line_refund_total > 0),
  created_at timestamptz not null default now()
);

create index return_items_return_id_idx on public.return_items (return_id);
create index return_items_sale_item_id_idx on public.return_items (sale_item_id);

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
  if p_refund_tender <> v_sale.payment_method then
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

  if v_total > v_sale.total then
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

revoke execute on function public.create_return(uuid, jsonb, public.payment_method, text, boolean, uuid)
  from public, anon;
grant execute on function public.create_return(uuid, jsonb, public.payment_method, text, boolean, uuid)
  to authenticated, service_role;

alter table public.return_settings enable row level security;
alter table public.returns enable row level security;
alter table public.return_items enable row level security;

create policy "return settings: admin manages"
  on public.return_settings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "returns: read own sale or admin"
  on public.returns for select to authenticated
  using (
    public.is_admin() or exists (
      select 1 from public.sales s
      where s.id = sale_id and s.cashier_id = (select auth.uid())
    )
  );

create policy "return items: read via own return or admin"
  on public.return_items for select to authenticated
  using (
    public.is_admin() or exists (
      select 1 from public.returns r
      join public.sales s on s.id = r.sale_id
      where r.id = return_id and s.cashier_id = (select auth.uid())
    )
  );

-- Deliberately no direct INSERT/UPDATE/DELETE policies: all writes pass
-- through create_return(), which owns validation, audit attribution and stock.
