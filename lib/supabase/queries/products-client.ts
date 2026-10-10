// Client-side product lookups for the register (browser Supabase client,
// consumed through TanStack Query). RLS: any signed-in staff can read.
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@/lib/supabase/database.types";
import { weighedConfigFromSettings, type WeighedConfig } from "@/lib/barcode/weighed";
import { storeInfoFromSettings } from "@/lib/receipts/store-info";
import type { StoreInfo } from "@/lib/receipts/types";
import type { CatalogCategory } from "@/lib/offline/catalog";

function escapeFilterValue(q: string): string {
  return q.replace(/[,()"\\]/g, " ").trim();
}

export async function searchProductsClient(q: string, limit = 8): Promise<Tables<"products">[]> {
  const safe = escapeFilterValue(q);
  if (!safe) return [];
  const supabase = createClient();
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("active", true)
    .or(`name_ar.ilike.%${safe}%,name_en.ilike.%${safe}%,barcode.ilike.${safe}%`)
    .order("name_en")
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function getProductByBarcodeClient(
  barcode: string
): Promise<Tables<"products"> | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("barcode", barcode)
    .eq("active", true)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Every active product, paged, for the offline catalog cache. */
export async function fetchCatalogClient(): Promise<Tables<"products">[]> {
  const supabase = createClient();
  const pageSize = 1000;
  const all: Tables<"products">[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .eq("active", true)
      .order("id")
      .range(from, from + pageSize - 1);
    if (error) throw error;
    all.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  return all;
}

/** Categories for the register's tile tabs, in the admin's order. */
export async function fetchCategoriesClient(): Promise<CatalogCategory[]> {
  const supabase = createClient();
  const { data, error } = await supabase.from("categories").select("id, name_ar, name_en, sort_order").order("sort_order").order("name_en");
  if (error) throw error;
  return (data ?? []).map((c) => ({ id: c.id, nameAr: c.name_ar, nameEn: c.name_en, sortOrder: c.sort_order }));
}

/** Discount share (basis points) above which a manager must approve; cached for offline checks. */
export async function fetchDiscountThresholdClient(): Promise<number> {
  const supabase = createClient();
  const { data, error } = await supabase.from("discount_settings").select("approval_threshold_bp").eq("id", true).single();
  if (error) throw error;
  return data.approval_threshold_bp;
}

/** Store identity for receipts, cached offline for provisional receipts. */
export async function fetchStoreInfoClient(): Promise<StoreInfo> {
  const supabase = createClient();
  const { data, error } = await supabase.from("store_settings").select("*").eq("id", true).single();
  if (error) throw error;
  return storeInfoFromSettings(data);
}

/** The product sold from a scale under this PLU (no leading zeros). */
export async function getProductByPluClient(plu: string): Promise<Tables<"products"> | null> {
  const supabase = createClient();
  const { data, error } = await supabase.from("products").select("*").eq("plu_code", plu).eq("active", true).maybeSingle();
  if (error) throw error;
  return data;
}

/** Scale-label layout from store settings; cached offline so scanning keeps working. */
export async function fetchWeighedConfigClient(): Promise<WeighedConfig> {
  const supabase = createClient();
  const { data, error } = await supabase.from("store_settings").select("*").eq("id", true).single();
  if (error) throw error;
  return weighedConfigFromSettings(data);
}
