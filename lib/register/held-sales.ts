import type { OfflineDb } from "@/lib/offline/db";
import type { CartCustomer, CartItem, Discount } from "@/lib/store/cart";

/**
 * A cart put aside so the cashier can serve the next customer. Kept on this
 * till (IndexedDB), so it survives a reload and works offline; any cashier on
 * the till can bring it back. It is not a sale: stock and reports only change
 * when it is paid.
 */
export type HeldSale = {
  id: string;
  heldAt: string; // ISO
  heldBy: string | null; // cashier name, for the list
  items: CartItem[];
  saleDiscount: Discount | null;
  customer: CartCustomer | null;
  promoCodes: string[];
  /** total when held (piasters), for the list only — recomputed on recall */
  total: number;
};

export const MAX_HELD_SALES = 5;
const KEY = "heldSales";

export async function listHeldSales(db: OfflineDb): Promise<HeldSale[]> {
  const row = await db.meta.get(KEY);
  return Array.isArray(row?.value) ? (row.value as HeldSale[]) : [];
}

/** Adds a held cart; refuses when the till already holds MAX_HELD_SALES. */
export async function holdSale(db: OfflineDb, sale: Omit<HeldSale, "id" | "heldAt">): Promise<HeldSale | null> {
  return db.transaction("rw", db.meta, async () => {
    const held = await listHeldSales(db);
    if (held.length >= MAX_HELD_SALES || sale.items.length === 0) return null;
    const entry: HeldSale = { ...sale, id: crypto.randomUUID(), heldAt: new Date().toISOString() };
    await db.meta.put({ key: KEY, value: [...held, entry] });
    return entry;
  });
}

/** Removes a held cart and returns it (null if another tab already took it). */
export async function takeHeldSale(db: OfflineDb, id: string): Promise<HeldSale | null> {
  return db.transaction("rw", db.meta, async () => {
    const held = await listHeldSales(db);
    const entry = held.find((sale) => sale.id === id) ?? null;
    if (entry) await db.meta.put({ key: KEY, value: held.filter((sale) => sale.id !== id) });
    return entry;
  });
}
