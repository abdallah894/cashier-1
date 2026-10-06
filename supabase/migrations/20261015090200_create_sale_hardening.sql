-- Phase 0 hardening of create_sale (review P1-2). Same signature and behaviour,
-- plus: caller must be an active profile, products are locked in a fixed order
-- (no cross-till deadlocks), qty has at most 3 decimals, discounts and cash
-- received are whole piasters, and cash received has an upper bound.
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

  -- A deactivated member of staff keeps a valid token until it expires;
  -- they must not be able to keep selling with it.
  if auth.uid() is not null
     and not exists (select 1 from public.profiles where id = auth.uid() and active) then
    raise exception 'create_sale: your account is not active';
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

  -- Money is whole piasters. The app validates this too, but the function is
  -- callable directly, so the database must not trust the caller. The upper
  -- bound (EGP 100,000) keeps a scanned barcode from becoming "cash received".
  if p_amount_tendered is not null
     and (p_amount_tendered < 0 or p_amount_tendered <> trunc(p_amount_tendered) or p_amount_tendered > 10000000) then
    raise exception 'create_sale: amount tendered must be whole piasters between 0 and 10000000';
  end if;

  -- Lock every product in the cart up front, in a fixed (id) order. Two tills
  -- selling {A, B} and {B, A} at the same moment used to lock in cart order and
  -- could deadlock; with one global order the second simply waits.
  perform 1
    from public.products
   where id in (select (elem->>'product_id')::uuid from jsonb_array_elements(p_items) as elem)
   order by id
     for update;

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
    if v_item.qty <> round(v_item.qty, 3) then
      raise exception 'create_sale: qty allows at most 3 decimals';
    end if;
    if v_item.line_discount <> trunc(v_item.line_discount) then
      raise exception 'create_sale: line_discount must be whole piasters';
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
