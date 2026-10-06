-- Phase 1: scale-printed (weighed) barcodes.
-- A deli/produce scale prints an in-store EAN-13 (prefix 20-29) holding the
-- product's PLU and the weight or price. The layout is a store setting; each
-- product that is sold from a scale gets a unique PLU code.
alter table public.store_settings
  add column weighed_barcode_enabled boolean not null default false,
  add column weighed_prefix_min integer not null default 20 check (weighed_prefix_min between 20 and 29),
  add column weighed_prefix_max integer not null default 29 check (weighed_prefix_max between 20 and 29),
  add column weighed_item_code_length integer not null default 5 check (weighed_item_code_length between 4 and 6),
  add column weighed_value_kind text not null default 'weight_grams' check (weighed_value_kind in ('weight_grams', 'price_piasters')),
  add constraint store_settings_weighed_prefix_order check (weighed_prefix_min <= weighed_prefix_max);

-- PLU: 1-6 digits, no leading zeros (the scale pads with zeros), unique.
alter table public.products
  add column plu_code text check (plu_code is null or plu_code ~ '^[1-9][0-9]{0,5}$');
create unique index products_plu_code_key on public.products (plu_code) where plu_code is not null;

create or replace function public.update_store_settings(p jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := auth.uid(); v_keys integer := 0;
begin
  if v_actor is null or not public.is_admin() then raise exception 'settings: admin only'; end if;
  if p ? 'timezone' and not exists (select 1 from pg_catalog.pg_timezone_names where name = p->>'timezone') then
    raise exception 'settings: unknown timezone %', p->>'timezone';
  end if;
  update public.store_settings set
    timezone = coalesce(p->>'timezone', timezone),
    business_day_cutoff_minutes = coalesce((p->>'business_day_cutoff_minutes')::integer, business_day_cutoff_minutes),
    reorder_cover_days = coalesce((p->>'reorder_cover_days')::integer, reorder_cover_days),
    reorder_lookback_days = coalesce((p->>'reorder_lookback_days')::integer, reorder_lookback_days),
    default_lead_time_days = coalesce((p->>'default_lead_time_days')::integer, default_lead_time_days),
    store_name_ar = coalesce(btrim(p->>'store_name_ar'), store_name_ar),
    store_name_en = coalesce(btrim(p->>'store_name_en'), store_name_en),
    address_ar = coalesce(btrim(p->>'address_ar'), address_ar),
    address_en = coalesce(btrim(p->>'address_en'), address_en),
    phone = coalesce(btrim(p->>'phone'), phone),
    tax_registration_number = coalesce(btrim(p->>'tax_registration_number'), tax_registration_number),
    receipt_footer_ar = coalesce(btrim(p->>'receipt_footer_ar'), receipt_footer_ar),
    receipt_footer_en = coalesce(btrim(p->>'receipt_footer_en'), receipt_footer_en),
    weighed_barcode_enabled = coalesce((p->>'weighed_barcode_enabled')::boolean, weighed_barcode_enabled),
    weighed_prefix_min = coalesce((p->>'weighed_prefix_min')::integer, weighed_prefix_min),
    weighed_prefix_max = coalesce((p->>'weighed_prefix_max')::integer, weighed_prefix_max),
    weighed_item_code_length = coalesce((p->>'weighed_item_code_length')::integer, weighed_item_code_length),
    weighed_value_kind = coalesce(p->>'weighed_value_kind', weighed_value_kind)
  where id;
  select count(*) into v_keys from jsonb_object_keys(p);
  perform public.write_audit_event(v_actor, null, 'store_settings_changed', 'settings', null,
    jsonb_build_object('item_count', v_keys), null);
end;
$$;
