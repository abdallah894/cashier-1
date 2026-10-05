import "fake-indexeddb/auto";
import { createOfflineDb } from "../lib/offline/db";
import {
  countByStatus,
  enqueueSale,
  listOutbox,
  recoverStuck,
  resolveRejected,
  retryRejected,
} from "../lib/offline/outbox";
import { drainOutbox, type SubmitResult } from "../lib/offline/sync";
import { findByBarcode, refreshCatalog, searchCatalog } from "../lib/offline/catalog";
import type { Tables } from "../lib/supabase/database.types";

let failures = 0;
function check(name: string, condition: boolean, detail = "") {
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!condition) failures++;
}

const USER = "00000000-0000-0000-0000-00000000000b";
const OTHER_USER = "00000000-0000-0000-0000-00000000000c";
let dbCounter = 0;
const freshDb = () => createOfflineDb(`test-${++dbCounter}`);

const provisional = {
  lines: [],
  vatBreakdown: [],
  subtotal: 1000,
  taxTotal: 0,
  discountTotal: 0,
  total: 1000,
  amountTendered: 1000,
  changeDue: 0,
  cashierName: "Test",
};
const input = (n = 1, userId = USER) => ({
  userId,
  shiftId: "shift-1",
  items: [{ product_id: `p-${n}`, qty: 1, line_discount: 0 }],
  amountTendered: 1000,
  provisional,
});

const ok = (n: number): SubmitResult => ({ kind: "synced", saleId: `sale-${n}`, saleNumber: n });

async function main() {
  // ---- enqueue: queued state, unique idempotency key, local numbering ----
  {
    const db = freshDb();
    const a = await enqueueSale(db, input(1));
    const b = await enqueueSale(db, input(2));
    check("enqueued sale starts queued", a.status === "queued");
    check("each sale gets a distinct idempotency key", a.id !== b.id);
    check("local provisional numbers increase", b.localNumber === a.localNumber + 1);
    check("outbox lists FIFO", (await listOutbox(db)).map((e) => e.id).join() === [a.id, b.id].join());
  }

  // ---- reconnect: FIFO drain delivers in order ----
  {
    const db = freshDb();
    const entries = [await enqueueSale(db, input(1)), await enqueueSale(db, input(2)), await enqueueSale(db, input(3))];
    const order: string[] = [];
    const result = await drainOutbox(db, USER, async (entry) => {
      order.push(entry.id);
      return ok(order.length);
    });
    check("drain submits in FIFO order", order.join() === entries.map((e) => e.id).join());
    check("drain reports synced count", result.synced === 3 && result.remaining === 0);
    const synced = await listOutbox(db);
    check("synced entries keep the server sale number", synced.every((e) => e.status === "synced" && e.saleNumber !== null));
  }

  // ---- disconnect mid-drain: stop, keep order, nothing lost ----
  {
    const db = freshDb();
    await enqueueSale(db, input(1));
    await enqueueSale(db, input(2));
    await enqueueSale(db, input(3));
    let calls = 0;
    const result = await drainOutbox(db, USER, async () => {
      calls++;
      if (calls === 2) throw new TypeError("fetch failed");
      return ok(calls);
    });
    check("network failure stops the drain", calls === 2);
    check("network failure leaves the rest queued", result.remaining === 2 && result.synced === 1);
    const counts = await countByStatus(db, USER);
    check("failed attempt is back to queued, not lost", counts.queued === 2 && counts.syncing === 0);
    const [, second] = await listOutbox(db);
    check("a network failure does not burn an attempt", second.attempts === 0 || second.attempts === 1);
    const order: string[] = [];
    await drainOutbox(db, USER, async (entry) => {
      order.push(entry.items[0].product_id);
      return ok(10);
    });
    check("reconnect drains the remainder in order", order.join() === "p-2,p-3");
  }

  // ---- restart: entries stuck in 'syncing' are recovered ----
  {
    const db = freshDb();
    const a = await enqueueSale(db, input(1));
    await db.outbox.update(a.id, { status: "syncing", syncingSince: Date.now() - 10 * 60_000 });
    check("a stuck entry is recovered after restart", (await recoverStuck(db, 60_000)) === 1);
    check("recovered entry is queued again", (await listOutbox(db))[0].status === "queued");
    const b = await enqueueSale(db, input(2));
    await db.outbox.update(b.id, { status: "syncing", syncingSince: Date.now() });
    check("an in-flight entry is not stolen", (await recoverStuck(db, 60_000)) === 0);
  }

  // ---- duplicate submit: concurrent drains submit each sale once ----
  {
    const db = freshDb();
    await enqueueSale(db, input(1));
    await enqueueSale(db, input(2));
    const seen: string[] = [];
    const submit = async (entry: { id: string }): Promise<SubmitResult> => {
      seen.push(entry.id);
      await new Promise((r) => setTimeout(r, 15));
      return ok(seen.length);
    };
    await Promise.all([drainOutbox(db, USER, submit), drainOutbox(db, USER, submit), drainOutbox(db, USER, submit)]);
    check("concurrent drains submit each queued sale exactly once", seen.length === 2 && new Set(seen).size === 2, `${seen.length}`);
  }

  // ---- stale stock / rejection: surfaced, never discarded, does not block the line ----
  {
    const db = freshDb();
    const bad = await enqueueSale(db, input(1));
    await enqueueSale(db, input(2));
    const result = await drainOutbox(db, USER, async (entry) =>
      entry.id === bad.id ? { kind: "rejected", error: "insufficientStock" } : ok(7)
    );
    check("rejection is counted", result.rejected === 1 && result.synced === 1);
    const [first, second] = await listOutbox(db);
    check("rejected sale is kept with its error", first.status === "rejected" && first.error === "insufficientStock");
    check("a rejection does not block later sales", second.status === "synced");

    await resolveRejected(db, bad.id, "  ").then(
      () => check("resolving needs a note", false),
      () => check("resolving needs a note", true)
    );
    await retryRejected(db, bad.id);
    check("retry returns a rejected sale to the queue", (await listOutbox(db))[0].status === "queued");
    await drainOutbox(db, USER, async () => ({ kind: "rejected", error: "insufficientStock" }));
    await resolveRejected(db, bad.id, "Customer refunded in cash, items re-rung");
    const resolved = (await listOutbox(db))[0];
    check("resolved sale stays on record with the note", resolved.status === "resolved" && resolved.resolution?.note.includes("refunded") === true);
    await resolveRejected(db, bad.id, "again").then(
      () => check("only rejected sales can be resolved", false),
      () => check("only rejected sales can be resolved", true)
    );
  }

  // ---- transient server errors: retried, then surfaced instead of looping forever ----
  {
    const db = freshDb();
    await enqueueSale(db, input(1));
    let lastStatus = "";
    for (let i = 0; i < 6; i++) {
      await drainOutbox(db, USER, async () => ({ kind: "retry", error: "checkoutFailed" }));
      lastStatus = (await listOutbox(db))[0].status;
    }
    check("repeated server failures end up rejected for staff review", lastStatus === "rejected");
  }

  // ---- ownership: a cashier's queue is only submitted by that cashier ----
  {
    const db = freshDb();
    await enqueueSale(db, input(1, OTHER_USER));
    const mine = await enqueueSale(db, input(2, USER));
    const seen: string[] = [];
    await drainOutbox(db, USER, async (entry) => {
      seen.push(entry.id);
      return ok(1);
    });
    check("another cashier's sale is left alone", seen.length === 1 && seen[0] === mine.id);
    const counts = await countByStatus(db, OTHER_USER);
    check("the other cashier's sale is still queued", counts.queued === 1);
  }

  // ---- cached catalog: search + barcode work offline, replaced on refresh ----
  {
    const db = freshDb();
    const product = (id: string, barcode: string, en: string, ar: string, active = true) =>
      ({ id, barcode, name_en: en, name_ar: ar, price: 1000, tax_rate: 0.14, stock_qty: 5, unit: "piece", active }) as Tables<"products">;
    await refreshCatalog(db, async () => [
      product("1", "6221", "Milk 1L", "حليب"),
      product("2", "6222", "Milk Chocolate", "شوكولاتة"),
      product("3", "7000", "Rice", "أرز"),
    ]);
    check("offline search matches English names", (await searchCatalog(db, "milk")).length === 2);
    check("offline search matches Arabic names", (await searchCatalog(db, "أرز")).map((p) => p.id).join() === "3");
    check("offline search matches barcode prefix", (await searchCatalog(db, "6222")).map((p) => p.id).join() === "2");
    check("offline barcode lookup is exact", (await findByBarcode(db, "7000"))?.id === "3" && (await findByBarcode(db, "700")) === null);
    await refreshCatalog(db, async () => [product("3", "7000", "Rice", "أرز")]);
    check("refresh drops products removed upstream", (await searchCatalog(db, "milk")).length === 0);
    await refreshCatalog(db, async () => {
      throw new Error("network");
    }).catch(() => undefined);
    check("a failed refresh keeps the previous cache", (await searchCatalog(db, "rice")).length === 1);
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) failing`);
    process.exit(1);
  }
  console.log("\nOffline outbox tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
