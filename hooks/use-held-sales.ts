"use client";

import { useEffect, useState } from "react";
import { liveQuery } from "dexie";
import { getOfflineDb } from "@/lib/offline/db";
import { listHeldSales, type HeldSale } from "@/lib/register/held-sales";

/** Held carts on this till, kept live (Vue: a computed over a store that IndexedDB updates). */
export function useHeldSales(): HeldSale[] {
  const [held, setHeld] = useState<HeldSale[]>([]);
  useEffect(() => {
    const subscription = liveQuery(() => listHeldSales(getOfflineDb())).subscribe({
      next: setHeld,
      error: () => setHeld([]),
    });
    return () => subscription.unsubscribe();
  }, []);
  return held;
}
