import Dexie, { type Table } from "dexie";
import type { Tables } from "@/lib/supabase/database.types";
import type { OutboxEntry } from "./types";

type MetaRow = { key: string; value: unknown };

/**
 * IndexedDB for the offline till. Dexie is a typed wrapper over the raw
 * IndexedDB API (think of a tiny local ORM); tables are declared once and
 * every read/write is a promise.
 */
export class OfflineDb extends Dexie {
  outbox!: Table<OutboxEntry, string>;
  catalog!: Table<Tables<"products">, string>;
  meta!: Table<MetaRow, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      outbox: "id, status, userId, createdAt, localNumber",
      catalog: "id, barcode",
      meta: "key",
    });
  }
}

export function createOfflineDb(name = "cachier-offline"): OfflineDb {
  return new OfflineDb(name);
}

let singleton: OfflineDb | null = null;

/** Browser-only lazy singleton; never call during SSR. */
export function getOfflineDb(): OfflineDb {
  singleton ??= createOfflineDb();
  return singleton;
}
