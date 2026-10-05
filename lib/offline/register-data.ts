import type { Tables } from "@/lib/supabase/database.types";
import {
  fetchCatalogClient,
  fetchDiscountThresholdClient,
  getProductByBarcodeClient,
  searchProductsClient,
} from "@/lib/supabase/queries/products-client";
import { findByBarcode, refreshCatalog, saveDiscountThreshold, searchCatalog } from "./catalog";
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

/** Refreshes the offline catalog + discount threshold; a failure keeps the previous cache. */
export async function refreshOfflineData(): Promise<void> {
  const db = getOfflineDb();
  await refreshCatalog(db, fetchCatalogClient);
  try {
    await saveDiscountThreshold(db, await fetchDiscountThresholdClient());
  } catch {
    // keep any previously cached threshold
  }
}
