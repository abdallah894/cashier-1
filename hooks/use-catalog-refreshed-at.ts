"use client";

import { useEffect, useState } from "react";
import { liveQuery } from "dexie";
import { getOfflineDb } from "@/lib/offline/db";
import { catalogRefreshedAt } from "@/lib/offline/catalog";

/** When the offline catalog was last refreshed (ISO), or null if never; `undefined` until first read. */
export function useCatalogRefreshedAt(): string | null | undefined {
  const [value, setValue] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    const subscription = liveQuery(() => catalogRefreshedAt(getOfflineDb())).subscribe({
      next: setValue,
      error: () => setValue(null),
    });
    return () => subscription.unsubscribe();
  }, []);
  return value;
}
