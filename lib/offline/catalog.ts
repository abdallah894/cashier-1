import type { Tables } from "@/lib/supabase/database.types";
import { DEFAULT_WEIGHED_CONFIG, type WeighedConfig } from "@/lib/barcode/weighed";
import type { StoreInfo } from "@/lib/receipts/types";
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

/** Store identity cached for provisional (offline) receipts. */
export async function saveStoreInfo(db: OfflineDb, info: StoreInfo): Promise<void> {
  await db.meta.put({ key: "storeInfo", value: info });
}

export async function loadStoreInfo(db: OfflineDb): Promise<StoreInfo | null> {
  const row = await db.meta.get("storeInfo");
  const v = row?.value as Partial<StoreInfo> | undefined;
  return v && typeof v.nameEn === "string" && typeof v.nameAr === "string" ? { ...v } as StoreInfo : null;
}

/** Offline prices older than this show a warning; older than EXPIRED refuse offline sales. */
export const CATALOG_STALE_AFTER_MS = 24 * 60 * 60 * 1000;
export const CATALOG_EXPIRED_AFTER_MS = 72 * 60 * 60 * 1000;

export type CatalogFreshness = "fresh" | "stale" | "expired";

/** How trustworthy the cached prices are. Never synced (null) counts as expired. */
export function catalogFreshness(refreshedAt: string | null, now: number = Date.now()): CatalogFreshness {
  if (!refreshedAt) return "expired";
  const age = now - Date.parse(refreshedAt);
  if (!Number.isFinite(age)) return "expired";
  if (age > CATALOG_EXPIRED_AFTER_MS) return "expired";
  if (age > CATALOG_STALE_AFTER_MS) return "stale";
  return "fresh";
}

/** Offline lookup of a scale-label PLU in the cached catalog. */
export async function findByPlu(db: OfflineDb, plu: string): Promise<Product | null> {
  const product = await db.catalog.filter((p) => p.plu_code === plu && p.active).first();
  return product ?? null;
}

/** Scale-label layout cached for offline scanning. */
export async function saveWeighedConfig(db: OfflineDb, config: WeighedConfig): Promise<void> {
  await db.meta.put({ key: "weighedConfig", value: config });
}

export async function loadWeighedConfig(db: OfflineDb): Promise<WeighedConfig | null> {
  const row = await db.meta.get("weighedConfig");
  const v = row?.value as Partial<WeighedConfig> | undefined;
  return v && typeof v.enabled === "boolean" && typeof v.itemCodeLength === "number" ? ({ ...DEFAULT_WEIGHED_CONFIG, ...v } as WeighedConfig) : null;
}
