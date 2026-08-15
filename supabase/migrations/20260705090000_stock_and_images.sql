-- ============================================================
-- Phase 2 — stock adjustments + product images
-- ============================================================

-- ---------- product image ----------

alter table public.products add column image_url text;

-- ---------- atomic stock adjustment ----------
--
-- One call = one transaction: update stock_qty + insert the audit
-- movement together. Admin-only; 'sale' movements are reserved for
-- create_sale(). Returns the new stock_qty.

create or replace function public.adjust_stock(
  p_product_id uuid,
  p_qty_change numeric,
  p_reason public.stock_movement_reason,
  p_note text default null
)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.products%rowtype;
  v_new_qty numeric;
begin
  if not public.is_admin() then
    raise exception 'adjust_stock: admin only';
  end if;

  if p_reason = 'sale' then
    raise exception 'adjust_stock: sale movements are created by create_sale only';
  end if;

  if p_qty_change is null or p_qty_change = 0 then
    raise exception 'adjust_stock: qty_change must be non-zero';
  end if;

  select * into v_product
  from public.products
  where id = p_product_id
  for update;

  if not found then
    raise exception 'adjust_stock: product % not found', p_product_id;
  end if;

  if v_product.unit = 'piece' and p_qty_change <> trunc(p_qty_change) then
    raise exception 'adjust_stock: % (%) is counted per piece — change must be a whole number',
      v_product.name_en, v_product.barcode;
  end if;

  if v_product.stock_qty + p_qty_change < 0 then
    raise exception 'adjust_stock: would make stock negative for % (%): have %, change %',
      v_product.name_en, v_product.barcode, v_product.stock_qty, p_qty_change;
  end if;

  update public.products
  set stock_qty = stock_qty + p_qty_change
  where id = p_product_id
  returning stock_qty into v_new_qty;

  insert into public.stock_movements (product_id, qty_change, reason, reference_id, note, created_by)
  values (p_product_id, p_qty_change, p_reason, null, p_note, auth.uid());

  return v_new_qty;
end;
$$;

revoke execute on function public.adjust_stock from public, anon;
grant execute on function public.adjust_stock to authenticated, service_role;

-- ---------- storage: product images bucket ----------

insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

create policy "product images: public read"
  on storage.objects for select
  using (bucket_id = 'product-images');

create policy "product images: admin insert"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'product-images' and public.is_admin());

create policy "product images: admin update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'product-images' and public.is_admin())
  with check (bucket_id = 'product-images' and public.is_admin());

create policy "product images: admin delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'product-images' and public.is_admin());
