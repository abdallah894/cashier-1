import type { Tables } from "@/lib/supabase/database.types";
import type { OfflineDb } from "./db";

type Product = Tables<"products">;

/**
 * Replaces the cached catalog with `fetchAll()`'s result. The old cache is
 * only touched after the fetch succeeded, so an outage mid-refresh keeps
 * the last good copy.
 */
export async function refreshCatalog(db: OfflineDb, fetchAll: () => Promise<Product[]>): Promise<number> {
  const products = (await fetchAll()).filter((product) => product.active);
  await db.transaction("rw", db.catalog, db.meta, async () => {
    await db.catalog.clear();
    await db.catalog.bulkPut(products);
    await db.meta.put({ key: "catalogRefreshedAt", value: new Date().toISOString() });
  });
  return products.length;
}

export async function catalogRefreshedAt(db: OfflineDb): Promise<string | null> {
  const row = await db.meta.get("catalogRefreshedAt");
  return typeof row?.value === "string" ? row.value : null;
}

export async function searchCatalog(db: OfflineDb, query: string, limit = 8): Promise<Product[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const all = await db.catalog.toArray();
  return all
    .filter(
      (product) =>
        product.name_en.toLowerCase().includes(q) ||
        product.name_ar.toLowerCase().includes(q) ||
        product.barcode.toLowerCase().startsWith(q)
    )
    .sort((a, b) => a.name_en.localeCompare(b.name_en))
    .slice(0, limit);
}

export async function findByBarcode(db: OfflineDb, barcode: string): Promise<Product | null> {
  const product = await db.catalog.where("barcode").equals(barcode).first();
  return product && product.active ? product : null;
}

export async function saveDiscountThreshold(db: OfflineDb, bp: number): Promise<void> {
  await db.meta.put({ key: "discountThresholdBp", value: bp });
}

export async function loadDiscountThreshold(db: OfflineDb): Promise<number | null> {
  const row = await db.meta.get("discountThresholdBp");
  return typeof row?.value === "number" ? row.value : null;
}
