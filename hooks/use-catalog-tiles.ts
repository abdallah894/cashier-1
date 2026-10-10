"use client";

import { useEffect, useState } from "react";
import { liveQuery } from "dexie";
import type { Tables } from "@/lib/supabase/database.types";
import { getOfflineDb } from "@/lib/offline/db";
import { browseCatalog, loadCategories, type CatalogCategory } from "@/lib/offline/catalog";

export type CatalogTiles = { categories: CatalogCategory[]; products: Tables<"products">[] };

/**
 * Register tiles from the cached catalog, so tapping products works offline
 * too. liveQuery re-runs when the background sync refreshes the cache
 * (Vue: a computed over a reactive store that a watcher keeps fresh).
 * Only categories that have products are returned.
 */
export function useCatalogTiles(categoryId: string | null, locale: "ar" | "en"): CatalogTiles | null {
  const [tiles, setTiles] = useState<CatalogTiles | null>(null);
  useEffect(() => {
    const subscription = liveQuery(async () => {
      const db = getOfflineDb();
      const [categories, products, all] = await Promise.all([
        loadCategories(db),
        browseCatalog(db, categoryId, locale),
        db.catalog.toArray(),
      ]);
      const used = new Set(all.map((product) => product.category_id));
      return { categories: categories.filter((category) => used.has(category.id)), products };
    }).subscribe({ next: setTiles, error: () => setTiles({ categories: [], products: [] }) });
    return () => subscription.unsubscribe();
  }, [categoryId, locale]);
  return tiles;
}
