-- Phase 0 (review P0-4): the store identity printed on receipts, return
-- receipts and Z-reports lived in a hard-coded demo constant. It now comes from
-- store_settings so the owner sets the real name, address and tax number.
-- Empty text means "not set"; receipts simply omit empty lines.
alter table public.store_settings
  add column store_name_ar text not null default '' check (length(store_name_ar) <= 120),
  add column store_name_en text not null default '' check (length(store_name_en) <= 120),
  add column address_ar text not null default '' check (length(address_ar) <= 200),
  add column address_en text not null default '' check (length(address_en) <= 200),
  add column phone text not null default '' check (length(phone) <= 40),
  add column tax_registration_number text not null default '' check (length(tax_registration_number) <= 40),
  add column receipt_footer_ar text not null default '' check (length(receipt_footer_ar) <= 200),
  add column receipt_footer_en text not null default '' check (length(receipt_footer_en) <= 200);

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
    receipt_footer_en = coalesce(btrim(p->>'receipt_footer_en'), receipt_footer_en)
  where id;
  select count(*) into v_keys from jsonb_object_keys(p);
  perform public.write_audit_event(v_actor, null, 'store_settings_changed', 'settings', null,
    jsonb_build_object('item_count', v_keys), null);
end;
$$;
