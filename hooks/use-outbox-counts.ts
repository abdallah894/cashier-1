"use client";

import { useEffect, useState } from "react";
import { liveQuery } from "dexie";
import { getOfflineDb } from "@/lib/offline/db";
import { countByStatus, type StatusCounts } from "@/lib/offline/outbox";

/**
 * Live outbox counts for one cashier. Dexie's liveQuery re-runs the query
 * whenever IndexedDB changes (any tab), like a computed over a reactive
 * table; null until the first read.
 */
export function useOutboxCounts(userId: string): StatusCounts | null {
  const [counts, setCounts] = useState<StatusCounts | null>(null);
  useEffect(() => {
    const subscription = liveQuery(() => countByStatus(getOfflineDb(), userId)).subscribe({
      next: setCounts,
      error: () => setCounts(null),
    });
    return () => subscription.unsubscribe();
  }, [userId]);
  return counts;
}
