-- Suppliers, purchase orders, receiving and cost history.
--
-- COST POLICY (explicit): products.cost is a moving average of NET (ex-VAT)
-- unit cost, recomputed on every receipt from the invoiced price. Every sale
-- snapshots that figure into sale_items.unit_cost, so historic profit never
-- changes when a product's cost is edited or new stock arrives at a new price.
-- Returns that restock reverse cost at the snapshot of the original sale line.
--
-- OVER-RECEIPT POLICY (explicit): partial receipts are always allowed; a
-- receipt may exceed the ordered quantity only within
-- purchasing_settings.over_receipt_tolerance_pct (default 0 = never).

-- ---------- audit vocabulary ----------
insert into public.audit_actions (action, target_type) values
  ('purchase_order_placed', 'purchase_order'),
  ('goods_received', 'purchase_order');

-- ---------- sale cost snapshot ----------
alter table public.sale_items add column unit_cost numeric(12,0);
-- Pre-existing sales have no recorded cost: the current product cost is the
-- best available estimate. The ledger trigger is lifted for this one backfill.
alter table public.sale_items disable trigger sale_items_immutable;
update public.sale_items si set unit_cost = p.cost from public.products p where p.id = si.product_id;
alter table public.sale_items enable trigger sale_items_immutable;
alter table public.sale_items alter column unit_cost set not null;
alter table public.sale_items add constraint sale_items_unit_cost_check check (unit_cost >= 0);

-- ---------- suppliers ----------
create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  phone text,
  email text,
  tax_id text,
  payment_terms text,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index suppliers_name_key on public.suppliers (lower(btrim(name)));
create trigger suppliers_set_updated_at before update on public.suppliers
  for each row execute function public.set_updated_at();
alter table public.suppliers enable row level security;
create policy "suppliers: stock staff read"
  on public.suppliers for select to authenticated using (public.has_capability('stock.correct'));
create policy "suppliers: admins write"
  on public.suppliers for all to authenticated using (public.is_admin()) with check (public.is_admin());

create table public.purchasing_settings (
  id boolean primary key default true check (id),
  over_receipt_tolerance_pct numeric(5,2) not null default 0 check (over_receipt_tolerance_pct between 0 and 100)
);
insert into public.purchasing_settings (id) values (true);
alter table public.purchasing_settings enable row level security;
create policy "purchasing settings: stock staff read"
  on public.purchasing_settings for select to authenticated using (public.has_capability('stock.correct'));
create policy "purchasing settings: admins write"
  on public.purchasing_settings for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------- purchase orders ----------
create type public.purchase_order_status as enum
  ('draft', 'ordered', 'partially_received', 'received', 'closed', 'cancelled');
create sequence public.purchase_order_number_seq;
create sequence public.goods_receipt_number_seq;

create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  po_number bigint not null unique default nextval('public.purchase_order_number_seq'),
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  supplier_name text not null,
  status public.purchase_order_status not null default 'draft',
  expected_date date,
  note text,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  ordered_at timestamptz,
  closed_at timestamptz
);
create index purchase_orders_status_idx on public.purchase_orders (status, created_at desc);

create table public.purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references public.purchase_orders(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  barcode text not null,
  name_ar text not null,
  name_en text not null,
  unit public.product_unit not null,
  ordered_qty numeric(10,3) not null check (ordered_qty > 0),
  received_qty numeric(10,3) not null default 0 check (received_qty >= 0),
  unit_cost numeric(12,0) not null check (unit_cost >= 0),   -- piasters, ex-VAT
  tax_rate numeric(5,4) not null default 0 check (tax_rate >= 0 and tax_rate <= 1),
  unique (po_id, product_id)
);
create index purchase_order_lines_po_idx on public.purchase_order_lines (po_id);

create table public.goods_receipts (
  id uuid primary key default gen_random_uuid(),
  receipt_number bigint not null unique default nextval('public.goods_receipt_number_seq'),
  po_id uuid not null references public.purchase_orders(id) on delete restrict,
  invoice_reference text,
  note text,
  received_by uuid not null references public.profiles(id) on delete restrict,
  received_at timestamptz not null default now(),
  idempotency_key uuid unique
);
create index goods_receipts_po_idx on public.goods_receipts (po_id);

create table public.goods_receipt_lines (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.goods_receipts(id) on delete restrict,
  po_line_id uuid not null references public.purchase_order_lines(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  qty numeric(10,3) not null check (qty > 0),
  unit_cost numeric(12,0) not null check (unit_cost >= 0),
  tax_rate numeric(5,4) not null check (tax_rate >= 0 and tax_rate <= 1)
);
create index goods_receipt_lines_receipt_idx on public.goods_receipt_lines (receipt_id);

alter table public.purchase_orders enable row level security;
alter table public.purchase_order_lines enable row level security;
alter table public.goods_receipts enable row level security;
alter table public.goods_receipt_lines enable row level security;
create policy "purchase orders: stock staff read" on public.purchase_orders for select to authenticated
  using (public.has_capability('stock.correct'));
create policy "purchase order lines: stock staff read" on public.purchase_order_lines for select to authenticated
  using (public.has_capability('stock.correct'));
create policy "goods receipts: stock staff read" on public.goods_receipts for select to authenticated
  using (public.has_capability('stock.correct'));
create policy "goods receipt lines: stock staff read" on public.goods_receipt_lines for select to authenticated
  using (public.has_capability('stock.correct'));
-- No write policies: orders and receipts change only through the RPCs below.

-- ---------- status derivation + guards ----------
create or replace function public.derive_po_status(p_po_id uuid)
returns public.purchase_order_status
language sql stable set search_path = ''
as $$
  select case
    when not exists (select 1 from public.purchase_order_lines where po_id = p_po_id) then 'ordered'
    when not exists (select 1 from public.purchase_order_lines where po_id = p_po_id and received_qty < ordered_qty) then 'received'
    when exists (select 1 from public.purchase_order_lines where po_id = p_po_id and received_qty > 0) then 'partially_received'
    else 'ordered'
  end::public.purchase_order_status;
$$;

create or replace function public.guard_purchase_order()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'purchase_orders is immutable (DELETE rejected)' using errcode = 'P0001';
  end if;
  if new.status <> old.status and not (
    (old.status = 'draft' and new.status in ('ordered', 'cancelled'))
    or (old.status = 'ordered' and new.status in ('partially_received', 'received', 'cancelled'))
    or (old.status = 'partially_received' and new.status in ('received', 'closed'))
  ) then
    raise exception 'purchase_orders: illegal status change % -> %', old.status, new.status using errcode = 'P0001';
  end if;
  -- Receiving states are derived from the lines, never asserted by a caller.
  if old.status in ('ordered', 'partially_received')
     and new.status in ('ordered', 'partially_received', 'received')
     and new.status <> public.derive_po_status(old.id) then
    raise exception 'purchase_orders: status must match the received quantities' using errcode = 'P0001';
  end if;
  if old.status in ('received', 'closed', 'cancelled') then
    raise exception 'purchase_orders is immutable once %', old.status using errcode = 'P0001';
  end if;
  if (new.id, new.po_number, new.supplier_id, new.supplier_name, new.created_by, new.created_at)
     is distinct from
     (old.id, old.po_number, old.supplier_id, old.supplier_name, old.created_by, old.created_at) then
    raise exception 'purchase_orders is immutable (identity fields)' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger purchase_orders_guard before update or delete on public.purchase_orders
  for each row execute function public.guard_purchase_order();

create or replace function public.guard_purchase_order_line()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'purchase_order_lines is immutable (DELETE rejected)' using errcode = 'P0001';
  end if;
  if (new.id, new.po_id, new.product_id, new.barcode, new.name_ar, new.name_en, new.unit, new.ordered_qty, new.unit_cost, new.tax_rate)
     is distinct from
     (old.id, old.po_id, old.product_id, old.barcode, old.name_ar, old.name_en, old.unit, old.ordered_qty, old.unit_cost, old.tax_rate) then
    raise exception 'purchase_order_lines is immutable (only received_qty changes)' using errcode = 'P0001';
  end if;
  if new.received_qty < old.received_qty then
    raise exception 'purchase_order_lines is immutable (received quantity cannot decrease)' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger purchase_order_lines_guard before update or delete on public.purchase_order_lines
  for each row execute function public.guard_purchase_order_line();

create trigger goods_receipts_immutable before update or delete on public.goods_receipts
  for each row execute function public.reject_ledger_change();
create trigger goods_receipt_lines_immutable before update or delete on public.goods_receipt_lines
  for each row execute function public.reject_ledger_change();
create trigger purchase_orders_no_truncate before truncate on public.purchase_orders
  for each statement execute function public.reject_ledger_change();
create trigger purchase_order_lines_no_truncate before truncate on public.purchase_order_lines
  for each statement execute function public.reject_ledger_change();
create trigger goods_receipts_no_truncate before truncate on public.goods_receipts
  for each statement execute function public.reject_ledger_change();
create trigger goods_receipt_lines_no_truncate before truncate on public.goods_receipt_lines
  for each statement execute function public.reject_ledger_change();

-- ---------- RPCs ----------
create or replace function public.create_purchase_order(
  p_supplier_id uuid,
  p_lines jsonb,
  p_expected_date date default null,
  p_note text default null
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_supplier public.suppliers%rowtype;
  v_po uuid;
  v_entry jsonb;
  v_product public.products%rowtype;
  v_qty numeric;
  v_cost numeric;
  v_tax numeric;
begin
  if v_actor is null or not public.is_admin() then raise exception 'purchase order: admin only'; end if;
  select * into v_supplier from public.suppliers where id = p_supplier_id and active;
  if not found then raise exception 'purchase order: supplier not found or inactive'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'purchase order: at least one line is required';
  end if;

  insert into public.purchase_orders (supplier_id, supplier_name, expected_date, note, created_by)
  values (v_supplier.id, v_supplier.name, p_expected_date, nullif(btrim(p_note), ''), v_actor)
  returning id into v_po;

  for v_entry in select * from jsonb_array_elements(p_lines) loop
    select * into v_product from public.products where id = (v_entry->>'product_id')::uuid and active;
    if not found then raise exception 'purchase order: product not found or inactive'; end if;
    v_qty := (v_entry->>'ordered_qty')::numeric;
    v_cost := (v_entry->>'unit_cost')::numeric;
    v_tax := coalesce((v_entry->>'tax_rate')::numeric, v_product.tax_rate);
    if v_qty is null or v_qty <= 0 then raise exception 'purchase order: quantity must be positive'; end if;
    if v_qty <> round(v_qty, 3) then raise exception 'purchase order: at most three decimal places'; end if;
    if v_product.unit = 'piece' and v_qty <> trunc(v_qty) then
      raise exception 'purchase order: % is counted per piece: quantity must be a whole number', v_product.name_en;
    end if;
    if v_cost is null or v_cost < 0 or v_cost <> trunc(v_cost) then
      raise exception 'purchase order: unit cost must be whole piasters';
    end if;
    if v_tax < 0 or v_tax > 1 then raise exception 'purchase order: invalid tax rate'; end if;
    insert into public.purchase_order_lines
      (po_id, product_id, barcode, name_ar, name_en, unit, ordered_qty, unit_cost, tax_rate)
    values
      (v_po, v_product.id, v_product.barcode, v_product.name_ar, v_product.name_en, v_product.unit, v_qty, v_cost, v_tax);
  end loop;
  return v_po;
end;
$$;

create or replace function public.place_purchase_order(p_po_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := auth.uid(); v_po public.purchase_orders%rowtype; v_total numeric; v_lines integer;
begin
  if v_actor is null or not public.is_admin() then raise exception 'purchase order: admin only'; end if;
  select * into v_po from public.purchase_orders where id = p_po_id for update;
  if not found then raise exception 'purchase order: not found'; end if;
  if v_po.status <> 'draft' then raise exception 'purchase order: only a draft can be placed'; end if;
  select count(*), coalesce(sum(round(ordered_qty * unit_cost)), 0) into v_lines, v_total
  from public.purchase_order_lines where po_id = p_po_id;
  update public.purchase_orders set status = 'ordered', ordered_at = now() where id = p_po_id;
  perform public.write_audit_event(v_actor, null, 'purchase_order_placed', 'purchase_order', p_po_id,
    jsonb_build_object('item_count', v_lines, 'amount', v_total), null);
end;
$$;

create or replace function public.cancel_purchase_order(p_po_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_po public.purchase_orders%rowtype;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'purchase order: admin only'; end if;
  select * into v_po from public.purchase_orders where id = p_po_id for update;
  if not found then raise exception 'purchase order: not found'; end if;
  if v_po.status not in ('draft', 'ordered') then
    raise exception 'purchase order: goods were already received; close it instead';
  end if;
  update public.purchase_orders set status = 'cancelled', closed_at = now() where id = p_po_id;
end;
$$;

create or replace function public.close_purchase_order(p_po_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_po public.purchase_orders%rowtype;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'purchase order: admin only'; end if;
  select * into v_po from public.purchase_orders where id = p_po_id for update;
  if not found then raise exception 'purchase order: not found'; end if;
  if v_po.status <> 'partially_received' then
    raise exception 'purchase order: only a partially received order can be closed short';
  end if;
  update public.purchase_orders set status = 'closed', closed_at = now() where id = p_po_id;
end;
$$;

create or replace function public.receive_purchase_order(
  p_po_id uuid,
  p_lines jsonb,
  p_invoice_reference text default null,
  p_note text default null,
  p_idempotency_key uuid default null
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_po public.purchase_orders%rowtype;
  v_existing public.goods_receipts%rowtype;
  v_receipt uuid;
  v_receipt_number bigint;
  v_tolerance numeric;
  v_entry jsonb;
  v_line public.purchase_order_lines%rowtype;
  v_product public.products%rowtype;
  v_qty numeric;
  v_cost numeric;
  v_allowed numeric;
  v_new_cost numeric;
  v_value numeric := 0;
  v_items integer := 0;
  v_status public.purchase_order_status;
begin
  if v_actor is null or not public.has_capability('stock.correct') then
    raise exception 'receiving: capability required';
  end if;
  if p_idempotency_key is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 1));
    select * into v_existing from public.goods_receipts where idempotency_key = p_idempotency_key;
    if found then
      if v_existing.po_id <> p_po_id then raise exception 'receiving: idempotency key belongs to another order'; end if;
      return v_existing.id;
    end if;
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'receiving: at least one line is required';
  end if;

  select * into v_po from public.purchase_orders where id = p_po_id for update;
  if not found then raise exception 'receiving: order not found'; end if;
  if v_po.status not in ('ordered', 'partially_received') then
    raise exception 'receiving: order is not open for receiving (status %)', v_po.status;
  end if;
  select over_receipt_tolerance_pct into v_tolerance from public.purchasing_settings where id = true;

  insert into public.goods_receipts (po_id, invoice_reference, note, received_by, idempotency_key)
  values (p_po_id, nullif(btrim(coalesce(p_invoice_reference, '')), ''), nullif(btrim(coalesce(p_note, '')), ''), v_actor, p_idempotency_key)
  returning id, receipt_number into v_receipt, v_receipt_number;

  for v_entry in select * from jsonb_array_elements(p_lines) loop
    v_qty := (v_entry->>'qty')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'receiving: quantity must be positive'; end if;
    if v_qty <> round(v_qty, 3) then raise exception 'receiving: at most three decimal places'; end if;

    select * into v_line from public.purchase_order_lines
    where id = (v_entry->>'po_line_id')::uuid and po_id = p_po_id for update;
    if not found then raise exception 'receiving: line is not on this order'; end if;
    if v_line.unit = 'piece' and v_qty <> trunc(v_qty) then
      raise exception 'receiving: % is counted per piece: quantity must be a whole number', v_line.name_en;
    end if;

    v_allowed := v_line.ordered_qty * (1 + coalesce(v_tolerance, 0) / 100) - v_line.received_qty;
    if v_qty > v_allowed then
      raise exception 'receiving: quantity exceeds the remaining quantity for % (remaining %, tolerance % percent)',
        v_line.name_en, round(greatest(v_allowed, 0), 3), coalesce(v_tolerance, 0);
    end if;

    v_cost := coalesce((v_entry->>'unit_cost')::numeric, v_line.unit_cost);
    if v_cost < 0 or v_cost <> trunc(v_cost) then raise exception 'receiving: unit cost must be whole piasters'; end if;

    select * into v_product from public.products where id = v_line.product_id for update;
    v_new_cost := case
      when v_product.stock_qty + v_qty > 0
        then round((v_product.stock_qty * v_product.cost + v_qty * v_cost) / (v_product.stock_qty + v_qty))
      else v_cost end;
    update public.products set stock_qty = stock_qty + v_qty, cost = v_new_cost where id = v_product.id;

    insert into public.goods_receipt_lines (receipt_id, po_line_id, product_id, qty, unit_cost, tax_rate)
    values (v_receipt, v_line.id, v_line.product_id, v_qty, v_cost, v_line.tax_rate);
    insert into public.stock_movements (product_id, qty_change, reason, reference_id, note, created_by)
    values (v_line.product_id, v_qty, 'received', v_receipt,
            'PO #' || v_po.po_number || ' receipt #' || v_receipt_number
              || coalesce(' / ' || nullif(btrim(coalesce(p_invoice_reference, '')), ''), ''), v_actor);
    update public.purchase_order_lines set received_qty = received_qty + v_qty where id = v_line.id;

    v_value := v_value + round(v_qty * v_cost);
    v_items := v_items + 1;
  end loop;

  v_status := public.derive_po_status(p_po_id);
  if v_status <> v_po.status then
    update public.purchase_orders set status = v_status where id = p_po_id;
  end if;

  perform public.write_audit_event(v_actor, null, 'goods_received', 'purchase_order', p_po_id,
    jsonb_build_object('item_count', v_items, 'amount', v_value), null);
  return v_receipt;
end;
$$;

-- ---------- reports (admin only, same guard as the other reports) ----------
create or replace function public.report_outstanding_purchase_orders()
returns table (
  po_id uuid, po_number bigint, supplier_name text, status public.purchase_order_status,
  expected_date date, product_id uuid, name_ar text, name_en text,
  ordered_qty numeric, received_qty numeric, remaining_qty numeric, unit_cost numeric, remaining_value numeric
)
language plpgsql security definer set search_path = '' stable
as $$
begin
  perform public.reports_guard();
  return query
    select o.id, o.po_number, o.supplier_name, o.status, o.expected_date, l.product_id, l.name_ar, l.name_en,
           l.ordered_qty, l.received_qty, l.ordered_qty - l.received_qty, l.unit_cost,
           round((l.ordered_qty - l.received_qty) * l.unit_cost)
    from public.purchase_orders o
    join public.purchase_order_lines l on l.po_id = o.id
    where o.status in ('ordered', 'partially_received') and l.received_qty < l.ordered_qty
    order by o.po_number, l.name_en;
end;
$$;

create or replace function public.report_received_cost(p_from timestamptz, p_to timestamptz)
returns table (
  supplier_id uuid, supplier_name text, receipt_count bigint, qty numeric, cost_total numeric, vat_total numeric
)
language plpgsql security definer set search_path = '' stable
as $$
begin
  perform public.reports_guard();
  return query
    select o.supplier_id, o.supplier_name, count(distinct r.id), sum(gl.qty),
           sum(round(gl.qty * gl.unit_cost)), sum(round(gl.qty * gl.unit_cost * gl.tax_rate))
    from public.goods_receipts r
    join public.goods_receipt_lines gl on gl.receipt_id = r.id
    join public.purchase_orders o on o.id = r.po_id
    where r.received_at >= p_from and r.received_at <= p_to
    group by o.supplier_id, o.supplier_name
    order by sum(round(gl.qty * gl.unit_cost)) desc;
end;
$$;

-- ---------- profit now reads the cost snapshot ----------
create or replace function public.report_profit(p_from timestamptz, p_to timestamptz)
returns table (net_revenue numeric, cost numeric, profit numeric, margin numeric)
language plpgsql security definer set search_path = '' stable
as $$
declare v_net numeric; v_cost numeric; v_ret_net numeric; v_ret_cost numeric;
begin
  perform public.reports_guard();
  select coalesce(sum(round(si.line_total / (1 + si.tax_rate))), 0), coalesce(sum(round(si.unit_cost * si.qty)), 0)
  into v_net, v_cost
  from public.sale_items si join public.sales s on s.id = si.sale_id
  where s.created_at >= p_from and s.created_at <= p_to;

  -- Returns reverse revenue; only restocked goods go back on the shelf, so only they reverse cost.
  select coalesce(sum(round(ri.line_refund_total / (1 + ri.tax_rate))), 0),
         coalesce(sum(case when r.restock then round(si.unit_cost * ri.qty) else 0 end), 0)
  into v_ret_net, v_ret_cost
  from public.return_items ri
  join public.returns r on r.id = ri.return_id
  join public.sale_items si on si.id = ri.sale_item_id
  where r.created_at >= p_from and r.created_at <= p_to;

  v_net := v_net - v_ret_net;
  v_cost := v_cost - v_ret_cost;
  return query
  select v_net, v_cost, (v_net - v_cost)::numeric,
         case when v_net > 0 then round((v_net - v_cost) / v_net, 4) end;
end;
$$;

-- ---------- create_sale: snapshot unit cost on every line ----------
drop function public.create_sale(jsonb, public.payment_method, uuid, numeric, uuid, uuid, uuid, timestamptz);

create or replace function public.create_sale(
  p_items jsonb,
  p_payment_method public.payment_method,
  p_shift_id uuid default null,
  p_amount_tendered numeric default null,
  p_cashier_id uuid default null,
  p_approval_id uuid default null,
  p_idempotency_key uuid default null,
  p_client_sold_at timestamptz default null
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
     payment_method, amount_tendered, change_due, idempotency_key, client_sold_at)
  values
    (p_shift_id, v_cashier_id, v_subtotal, v_tax_total, v_discount_total, v_total,
     p_payment_method,
     case when p_payment_method = 'cash' then p_amount_tendered end,
     v_change, p_idempotency_key, p_client_sold_at)
  returning id, public.sales.sale_number into v_sale_id, v_sale_number;

  for v_line in select * from jsonb_array_elements(v_lines)
  loop
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

revoke execute on function public.create_sale(jsonb, public.payment_method, uuid, numeric, uuid, uuid, uuid, timestamptz) from public, anon;
grant execute on function public.create_sale(jsonb, public.payment_method, uuid, numeric, uuid, uuid, uuid, timestamptz) to authenticated, service_role;

revoke execute on function
  public.create_purchase_order(uuid, jsonb, date, text),
  public.place_purchase_order(uuid),
  public.cancel_purchase_order(uuid),
  public.close_purchase_order(uuid),
  public.receive_purchase_order(uuid, jsonb, text, text, uuid),
  public.report_outstanding_purchase_orders(),
  public.report_received_cost(timestamptz, timestamptz),
  public.report_profit(timestamptz, timestamptz)
from public, anon;
grant execute on function
  public.create_purchase_order(uuid, jsonb, date, text),
  public.place_purchase_order(uuid),
  public.cancel_purchase_order(uuid),
  public.close_purchase_order(uuid),
  public.receive_purchase_order(uuid, jsonb, text, text, uuid),
  public.report_outstanding_purchase_orders(),
  public.report_received_cost(timestamptz, timestamptz),
  public.report_profit(timestamptz, timestamptz)
to authenticated, service_role;
