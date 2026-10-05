"use client";

import { useEffect, useState } from "react";
import { liveQuery } from "dexie";
import { getOfflineDb } from "@/lib/offline/db";
import { listOutbox } from "@/lib/offline/outbox";
import type { OutboxEntry } from "@/lib/offline/types";

/** Live outbox rows (FIFO); null until IndexedDB has answered. */
export function useOutbox(): OutboxEntry[] | null {
  const [rows, setRows] = useState<OutboxEntry[] | null>(null);
  useEffect(() => {
    const subscription = liveQuery(() => listOutbox(getOfflineDb())).subscribe({
      next: setRows,
      error: () => setRows([]),
    });
    return () => subscription.unsubscribe();
  }, []);
  return rows;
}
