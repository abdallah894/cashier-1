-- Offline checkout support: idempotent create_sale + the time the till rang the sale.
-- Server-side stock, price, tax and sale numbering stay authoritative.

alter table public.sales
  add column idempotency_key uuid,
  add column client_sold_at timestamptz;
create unique index sales_idempotency_key_idx on public.sales (idempotency_key)
  where idempotency_key is not null;

drop function public.create_sale(jsonb, public.payment_method, uuid, numeric, uuid, uuid);

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

revoke execute on function public.create_sale(jsonb, public.payment_method, uuid, numeric, uuid, uuid, uuid, timestamptz) from public, anon;
grant execute on function public.create_sale(jsonb, public.payment_method, uuid, numeric, uuid, uuid, uuid, timestamptz) to authenticated, service_role;
