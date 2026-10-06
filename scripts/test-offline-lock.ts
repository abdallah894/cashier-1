/**
 * Phase 0 (review P1-6/7/8): one tab drains at a time, an expired login is
 * reported (not silently retried), and stale offline prices are detected.
 */
import "fake-indexeddb/auto";
import { createOfflineDb } from "../lib/offline/db";
import { enqueueSale, listOutbox } from "../lib/offline/outbox";
import { drainOutboxExclusive, type LockManagerLike, type SubmitResult } from "../lib/offline/sync";
import { CATALOG_EXPIRED_AFTER_MS, CATALOG_STALE_AFTER_MS, catalogFreshness } from "../lib/offline/catalog";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failures++;
}

const USER = "00000000-0000-0000-0000-00000000000b";
const provisional = { lines: [], vatBreakdown: [], subtotal: 1000, taxTotal: 0, discountTotal: 0, total: 1000, amountTendered: 1000, changeDue: 0, cashierName: "T" };
const sale = (n: number) => ({ userId: USER, shiftId: "s", items: [{ product_id: `p-${n}`, qty: 1, line_discount: 0 }], amountTendered: 1000, provisional });

/** A same-browser lock manager: the lock is shared by every "tab" that uses this object. */
function fakeLocks(): LockManagerLike {
  const held = new Set<string>();
  return {
    async request(name, _options, callback) {
      if (held.has(name)) return callback(null);
      held.add(name);
      try {
        return await callback({});
      } finally {
        held.delete(name);
      }
    },
  };
}

async function main() {
  // ---- two tabs, one browser: the second must not submit ----
  {
    // the same IndexedDB name opened twice = two tabs of one browser
    const tabA = createOfflineDb("lock-shared");
    const tabB = createOfflineDb("lock-shared");
    for (const n of [1, 2, 3]) await enqueueSale(tabA, sale(n));
    const locks = fakeLocks();

    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const submit = async (entry: { items: { product_id: string }[] }): Promise<SubmitResult> => {
      order.push(entry.items[0].product_id);
      if (order.length === 1) await gate; // tab A is mid-flight on sale #1
      return { kind: "synced", saleId: order.length.toString(), saleNumber: order.length };
    };

    const a = drainOutboxExclusive(tabA, USER, submit, locks);
    await new Promise((resolve) => setTimeout(resolve, 20)); // let A take the lock and enter submit
    const b = await drainOutboxExclusive(tabB, USER, submit, locks);
    check("the second tab does not drain while the first holds the lock", b === null);
    check("only the first sale has been submitted so far", order.join() === "p-1", order.join());
    release();
    const aResult = await a;
    check("the first tab drains everything in order", aResult?.synced === 3 && order.join() === "p-1,p-2,p-3", order.join());
    check("the lock is released afterwards", (await drainOutboxExclusive(tabB, USER, submit, locks))?.synced === 0);
  }

  // ---- without the Web Locks API it still drains (in-tab guard) ----
  {
    const db = createOfflineDb("lock-none");
    await enqueueSale(db, sale(1));
    const r = await drainOutboxExclusive(db, USER, async () => ({ kind: "synced", saleId: "x", saleNumber: 1 }), undefined);
    check("falls back to the in-tab guard when navigator.locks is missing", r?.synced === 1);
  }

  // ---- an expired login pauses the queue and says so ----
  {
    const db = createOfflineDb("lock-auth");
    await enqueueSale(db, sale(1));
    await enqueueSale(db, sale(2));
    const r = await drainOutboxExclusive(db, USER, async () => { throw new Error("notAuthorized"); }, fakeLocks());
    check("an expired session reports needsSignIn", r?.needsSignIn === true && r.synced === 0);
    const rows = await listOutbox(db);
    check("the sales stay queued, none rejected or lost", rows.length === 2 && rows.every((row) => row.status === "queued"));
    const network = await drainOutboxExclusive(db, USER, async () => { throw new TypeError("offline"); }, fakeLocks());
    check("a plain network failure does not ask for a sign-in", network?.needsSignIn === undefined);
    const after = await drainOutboxExclusive(db, USER, async () => ({ kind: "synced", saleId: "s", saleNumber: 1 }), fakeLocks());
    check("after signing in the queue drains", after?.synced === 2 && after.needsSignIn === undefined);
  }

  // ---- catalog freshness ----
  {
    const now = Date.parse("2026-10-10T12:00:00Z");
    const ago = (ms: number) => new Date(now - ms).toISOString();
    check("a catalog synced minutes ago is fresh", catalogFreshness(ago(5 * 60_000), now) === "fresh");
    check("just inside 24 h is fresh", catalogFreshness(ago(CATALOG_STALE_AFTER_MS - 1), now) === "fresh");
    check("over 24 h is stale", catalogFreshness(ago(CATALOG_STALE_AFTER_MS + 1), now) === "stale");
    check("over 72 h is expired", catalogFreshness(ago(CATALOG_EXPIRED_AFTER_MS + 1), now) === "expired");
    check("never synced is expired", catalogFreshness(null, now) === "expired");
    check("a garbage timestamp is expired", catalogFreshness("not a date", now) === "expired");
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) failing`);
    process.exit(1);
  }
  console.log("\nOffline lock tests passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
