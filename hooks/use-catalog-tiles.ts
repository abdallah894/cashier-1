"use client";

import { useEffect, useState } from "react";
import { liveQuery } from "dexie";
import type { Tables } from "@/lib/supabase/database.types";
import { getOfflineDb } from "@/lib/offline/db";
import { loadCategories, pickTiles, type CatalogCategory } from "@/lib/offline/catalog";

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
      // one read of the catalog serves both the tiles and the category chips
      const [categories, all] = await Promise.all([loadCategories(db), db.catalog.toArray()]);
      const used = new Set(all.map((product) => product.category_id));
      return {
        categories: categories.filter((category) => used.has(category.id)),
        products: pickTiles(all, categoryId, locale),
      };
    }).subscribe({ next: setTiles, error: () => setTiles({ categories: [], products: [] }) });
    return () => subscription.unsubscribe();
  }, [categoryId, locale]);
  return tiles;
}
