// Client-side product lookups for the register (browser Supabase client,
// consumed through TanStack Query). RLS: any signed-in staff can read.
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@/lib/supabase/database.types";

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
