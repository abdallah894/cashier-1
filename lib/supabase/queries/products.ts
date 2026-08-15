import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/lib/supabase/database.types";

export type Product = Tables<"products">;
export type ProductWithCategory = Product & {
  categories: Pick<Tables<"categories">, "name_ar" | "name_en"> | null;
};

export const PRODUCTS_PAGE_SIZE = 20;

export type ProductListParams = {
  q?: string;
  categoryId?: string;
  /** "all" | "active" | "inactive" */
  active?: string;
  page?: number;
};

/** Escape a user string for use inside a PostgREST .or() filter. */
function escapeFilterValue(q: string): string {
  // PostgREST separators/quotes would break out of the pattern
  return q.replace(/[,()"\\]/g, " ").trim();
}

export async function getProducts({ q, categoryId, active, page = 1 }: ProductListParams) {
  const supabase = await createClient();

  let query = supabase
    .from("products")
    .select("*, categories(name_ar, name_en)", { count: "exact" });

  if (q) {
    const safe = escapeFilterValue(q);
    if (safe) {
      query = query.or(`name_ar.ilike.%${safe}%,name_en.ilike.%${safe}%,barcode.ilike.%${safe}%`);
    }
  }
  if (categoryId) {
    query = query.eq("category_id", categoryId);
  }
  if (active === "active") query = query.eq("active", true);
  if (active === "inactive") query = query.eq("active", false);

  const from = (page - 1) * PRODUCTS_PAGE_SIZE;
  const { data, count, error } = await query
    .order("created_at", { ascending: false })
    .range(from, from + PRODUCTS_PAGE_SIZE - 1);

  if (error) throw error;
  return {
    rows: (data ?? []) as ProductWithCategory[],
    total: count ?? 0,
    page,
    pageCount: Math.max(1, Math.ceil((count ?? 0) / PRODUCTS_PAGE_SIZE)),
  };
}

export async function getProduct(id: string): Promise<ProductWithCategory | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select("*, categories(name_ar, name_en)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data as ProductWithCategory | null;
}

export type StockMovementWithActor = Tables<"stock_movements"> & {
  profiles: Pick<Tables<"profiles">, "full_name"> | null;
};

export async function getStockMovements(productId: string): Promise<StockMovementWithActor[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("stock_movements")
    .select("*, profiles(full_name)")
    .eq("product_id", productId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as StockMovementWithActor[];
}

/** Barcodes that already exist among the given set (for CSV import checks). */
export async function getExistingBarcodes(barcodes: string[]): Promise<Set<string>> {
  if (barcodes.length === 0) return new Set();
  const supabase = await createClient();
  const { data, error } = await supabase.from("products").select("barcode").in("barcode", barcodes);
  if (error) throw error;
  return new Set((data ?? []).map((r) => r.barcode));
}
