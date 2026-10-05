-- Defense in depth: Postgres grants EXECUTE on new functions to PUBLIC by default,
-- and Supabase additionally grants it to anon. Every RPC authenticates inside
-- (auth.uid() / is_admin()), but signed-out callers should not be able to reach
-- them at all. Revoke from PUBLIC/anon and keep whatever signed-in staff and the service role already had.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig,
           has_function_privilege('authenticated', p.oid, 'execute') as auth_ok,
           has_function_privilege('service_role', p.oid, 'execute') as service_ok
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
  loop
    -- keep exactly the access signed-in staff and the service role had; functions
    -- that earlier migrations made service-only stay service-only
    execute format('revoke execute on function %s from public, anon', f.sig);
    if f.auth_ok then execute format('grant execute on function %s to authenticated', f.sig); end if;
    if f.service_ok then execute format('grant execute on function %s to service_role', f.sig); end if;
  end loop;
end $$;

-- Functions created by later migrations get the same treatment by default.
alter default privileges in schema public revoke execute on functions from public, anon;

-- Foreign keys that are joined or filtered on in reports and lookups.
create index if not exists purchase_orders_supplier_idx on public.purchase_orders (supplier_id);
create index if not exists purchase_order_lines_product_idx on public.purchase_order_lines (product_id);
create index if not exists goods_receipt_lines_po_line_idx on public.goods_receipt_lines (po_line_id);
create index if not exists goods_receipt_lines_product_idx on public.goods_receipt_lines (product_id);
create index if not exists product_suppliers_supplier_idx on public.product_suppliers (supplier_id);
create index if not exists return_items_product_idx on public.return_items (product_id);
create index if not exists stocktake_items_product_idx on public.stocktake_items (product_id);
create index if not exists promotion_redemptions_sale_idx on public.promotion_redemptions (sale_id);
create index if not exists promotion_redemptions_customer_idx on public.promotion_redemptions (customer_id);
create index if not exists sale_item_promotions_promotion_idx on public.sale_item_promotions (promotion_id);
create index if not exists promotion_products_product_idx on public.promotion_products (product_id);
create index if not exists payments_original_idx on public.payments (original_payment_id);
create index if not exists print_jobs_device_idx on public.print_jobs (device_id);
create index if not exists drawer_openings_shift_idx on public.drawer_openings (shift_id);
create index if not exists shifts_till_idx on public.shifts (till_id);
create index if not exists stock_movements_created_by_idx on public.stock_movements (created_by);
