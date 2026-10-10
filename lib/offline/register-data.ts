import type { Tables } from "@/lib/supabase/database.types";
import {
  fetchCatalogClient,
  fetchCategoriesClient,
  fetchDiscountThresholdClient,
  fetchStoreInfoClient,
  fetchWeighedConfigClient,
  getProductByPluClient,
  getProductByBarcodeClient,
  searchProductsClient,
} from "@/lib/supabase/queries/products-client";
import { parseWeighedBarcode, quantityForLabelPrice, DEFAULT_WEIGHED_CONFIG, type WeighedConfig } from "@/lib/barcode/weighed";
import { findByBarcode, findByPlu, loadWeighedConfig, refreshCatalog, saveCategories, saveDiscountThreshold, saveStoreInfo, saveWeighedConfig, searchCatalog } from "./catalog";
import { getOfflineDb } from "./db";

type Product = Tables<"products">;

/** `fromCache` means the stock figures are the last synced estimate, not live. */
export type ProductSearch = { products: Product[]; fromCache: boolean };
export type BarcodeLookup = { product: Product | null; fromCache: boolean };

const isOffline = () => typeof navigator !== "undefined" && !navigator.onLine;

/** Live search; falls back to the cached catalog when offline or the server is unreachable. */
export async function searchProducts(query: string): Promise<ProductSearch> {
  if (!isOffline()) {
    try {
      return { products: await searchProductsClient(query), fromCache: false };
    } catch {
      // fall through to the cache
    }
  }
  return { products: await searchCatalog(getOfflineDb(), query), fromCache: true };
}

export async function lookupBarcode(barcode: string): Promise<BarcodeLookup> {
  if (!isOffline()) {
    try {
      return { product: await getProductByBarcodeClient(barcode), fromCache: false };
    } catch {
      // fall through to the cache
    }
  }
  return { product: await findByBarcode(getOfflineDb(), barcode), fromCache: true };
}

export type WeighedLookup =
  | { ok: true; product: Product; qty: number; fromCache: boolean }
  | { ok: false; reason: "unknownPlu"; plu: string }
  | { ok: false; reason: "notByWeight"; plu: string };

/** Layout of the shop's scale labels: live when online (briefly memoised), else the offline copy. */
let weighedMemo: { at: number; config: WeighedConfig } | null = null;
async function weighedConfig(): Promise<WeighedConfig> {
  const db = getOfflineDb();
  if (!isOffline()) {
    if (weighedMemo && Date.now() - weighedMemo.at < 60_000) return weighedMemo.config;
    try {
      const config = await fetchWeighedConfigClient();
      weighedMemo = { at: Date.now(), config };
      await saveWeighedConfig(db, config);
      return config;
    } catch {
      // fall through to the cached copy
    }
  }
  return (await loadWeighedConfig(db)) ?? DEFAULT_WEIGHED_CONFIG;
}

/**
 * Is this a scale label? Returns null when it is not (feature off, wrong
 * prefix/check digit) so the caller handles it as an ordinary unknown barcode.
 * A real product barcode is always tried first by the caller.
 */
export async function lookupWeighed(barcode: string): Promise<WeighedLookup | null> {
  const parsed = parseWeighedBarcode(barcode, await weighedConfig());
  if (!parsed) return null;
  let product: Product | null = null;
  let fromCache = true;
  if (!isOffline()) {
    try {
      product = await getProductByPluClient(parsed.plu);
      fromCache = false;
    } catch {
      // fall through to the cache
    }
  }
  if (fromCache) product = await findByPlu(getOfflineDb(), parsed.plu);
  if (!product) return { ok: false, reason: "unknownPlu", plu: parsed.plu };
  if (parsed.kind === "weight") {
    if (product.unit !== "kg") return { ok: false, reason: "notByWeight", plu: parsed.plu };
    return { ok: true, product, qty: parsed.weightKg, fromCache };
  }
  const qty = product.unit === "kg" ? quantityForLabelPrice(parsed.pricePiasters, product.price) : 1;
  if (qty <= 0) return { ok: false, reason: "unknownPlu", plu: parsed.plu };
  return { ok: true, product, qty, fromCache };
}

/** Refreshes the offline catalog + discount threshold; a failure keeps the previous cache. */
export async function refreshOfflineData(): Promise<void> {
  const db = getOfflineDb();
  await refreshCatalog(db, fetchCatalogClient);
  try {
    await saveDiscountThreshold(db, await fetchDiscountThresholdClient());
  } catch {
    // keep any previously cached threshold
  }
  try {
    await saveWeighedConfig(db, await fetchWeighedConfigClient());
  } catch {
    // keep any previously cached label layout
  }
  try {
    await saveStoreInfo(db, await fetchStoreInfoClient());
  } catch {
    // keep any previously cached store identity
  }
  try {
    await saveCategories(db, await fetchCategoriesClient());
  } catch {
    // keep any previously cached tile tabs
  }
}
