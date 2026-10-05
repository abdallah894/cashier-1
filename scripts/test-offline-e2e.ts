import "fake-indexeddb/auto";
import { asAdminService, asUser, createTestDb, seedUser } from "./lib/pglite-db";
import { createOfflineDb } from "../lib/offline/db";
import { enqueueSale, listOutbox, resolveRejected } from "../lib/offline/outbox";
import { drainOutbox, type SubmitResult } from "../lib/offline/sync";
import { buildProvisionalReceipt, discountNeedsApproval } from "../lib/offline/provisional";
import { computeTotals, toSaleItems, toCartItem } from "../lib/store/cart";
import type { Tables } from "../lib/supabase/database.types";

const CASHIER = "00000000-0000-0000-0000-00000000000b";
const MILK = "00000000-0000-0000-0000-000000000101";
const RICE = "00000000-0000-0000-0000-000000000102";

let failures = 0;
function check(name: string, condition: boolean, detail = "") {
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!condition) failures++;
}

/**
 * Full path: IndexedDB outbox -> sync engine -> the real create_sale RPC
 * (PGlite). `dropResponses` simulates a response lost after the server
 * already committed the sale.
 */
async function main() {
  const pg = await createTestDb();
  await seedUser(pg, CASHIER, "cashier", "cashier");
  await pg.query(`insert into public.products (id, barcode, name_ar, name_en, price, tax_rate, stock_qty, unit) values
    ('${MILK}', 'm-1', 'حليب', 'Milk', 2000, 0.14, 10, 'piece'),
    ('${RICE}', 'r-1', 'أرز', 'Rice', 5000, 0, 1, 'piece')`);
  const { rows: shifts } = await pg.query<{ id: string }>(
    `insert into public.shifts (cashier_id, opening_float) values ('${CASHIER}', 0) returning id`
  );
  const shiftId = shifts[0].id;
  await asUser(pg, CASHIER);

  let dropResponses = false;
  let rpcCalls = 0;
  const submit = async (entry: Parameters<Parameters<typeof drainOutbox>[2]>[0]): Promise<SubmitResult> => {
    rpcCalls++;
    try {
      const { rows } = await pg.query<{ sale_id: string; sale_number: string }>(
        `select * from public.create_sale($1::jsonb, 'cash', $2::uuid, $3, null, null, $4::uuid, $5::timestamptz)`,
        [JSON.stringify(entry.items), entry.shiftId, entry.amountTendered, entry.id, entry.createdAt]
      );
      if (dropResponses) throw new TypeError("response lost");
      return { kind: "synced", saleId: rows[0].sale_id, saleNumber: Number(rows[0].sale_number) };
    } catch (error) {
      if (error instanceof TypeError) throw error;
      const message = (error as Error).message;
      return { kind: "rejected", error: message.includes("insufficient stock") ? "insufficientStock" : "checkoutFailed" };
    }
  };

  const db = createOfflineDb("e2e");
  const product = (id: string, name: string, price: number, rate: number) =>
    ({ id, barcode: id.slice(-3), name_ar: name, name_en: name, price, tax_rate: rate, stock_qty: 10, unit: "piece" }) as Tables<"products">;
  const cart = (items: [Tables<"products">, number][]) =>
    computeTotals(items.map(([p, qty]) => ({ ...toCartItem(p), qty, discount: null })), null);

  const milkTotals = cart([[product(MILK, "Milk", 2000, 0.14), 2]]);
  const entry = await enqueueSale(db, {
    userId: CASHIER,
    shiftId,
    items: toSaleItems(milkTotals),
    amountTendered: 5000,
    provisional: buildProvisionalReceipt(milkTotals, 5000, "Cashier"),
  });
  check("provisional receipt matches the cart totals", entry.provisional.total === 4000 && entry.provisional.changeDue === 1000);

  // response lost after the server committed -> retried under the same key
  dropResponses = true;
  await drainOutbox(db, CASHIER, submit);
  check("a lost response leaves the sale queued", (await listOutbox(db))[0].status === "queued");
  dropResponses = false;
  const result = await drainOutbox(db, CASHIER, submit);
  check("the retry syncs", result.synced === 1);

  await asAdminService(pg);
  const { rows: counts } = await pg.query<{ sales: string; stock: string; client_sold_at: string | null }>(
    `select (select count(*) from public.sales) as sales,
            (select stock_qty from public.products where id = '${MILK}') as stock,
            (select client_sold_at::text from public.sales limit 1) as client_sold_at`
  );
  check("a queued sale creates exactly one server sale", Number(counts[0].sales) === 1, `rpc calls: ${rpcCalls}`);
  check("stock is decremented once", Number(counts[0].stock) === 8);
  check("the rung-at time is kept", counts[0].client_sold_at !== null);
  const synced = (await listOutbox(db))[0];
  check("the outbox records the server sale number", synced.status === "synced" && synced.saleNumber === 1);
  await asUser(pg, CASHIER);

  // stale offline stock: the till thought 10 rice were left, the server has 1
  const riceTotals = cart([[product(RICE, "Rice", 5000, 0), 3]]);
  const stale = await enqueueSale(db, {
    userId: CASHIER,
    shiftId,
    items: toSaleItems(riceTotals),
    amountTendered: 20000,
    provisional: buildProvisionalReceipt(riceTotals, 20000, "Cashier"),
  });
  const after = await drainOutbox(db, CASHIER, submit);
  const rejected = (await listOutbox(db)).find((row) => row.id === stale.id)!;
  check("stale stock is rejected by the server", after.rejected === 1 && rejected.status === "rejected" && rejected.error === "insufficientStock");
  await asAdminService(pg);
  const { rows: afterReject } = await pg.query<{ sales: string; stock: string }>(
    `select (select count(*) from public.sales) as sales, (select stock_qty from public.products where id = '${RICE}') as stock`
  );
  check("a rejected sale changes nothing on the server", Number(afterReject[0].sales) === 1 && Number(afterReject[0].stock) === 1);
  await resolveRejected(db, stale.id, "Customer paid for 1 item; the rest was returned to the shelf");
  const final = (await listOutbox(db)).find((row) => row.id === stale.id)!;
  check("staff can resolve it and the record is kept", final.status === "resolved" && final.resolution !== null);

  // discounts: the offline guard mirrors the server threshold
  const discounted = computeTotals([{ ...toCartItem(product(MILK, "Milk", 2000, 0.14)), qty: 1, discount: { kind: "percent", bp: 2000 } }], null);
  check("a large discount cannot be rung offline", discountNeedsApproval(discounted, 1000));
  check("a small discount can", !discountNeedsApproval(discounted, 2500));
  check("no cached threshold blocks any discount", discountNeedsApproval(discounted, null));
  check("no discount never needs approval", !discountNeedsApproval(milkTotals, null));

  if (failures > 0) {
    console.error(`\n${failures} check(s) failing`);
    process.exit(1);
  }
  console.log("\nOffline end-to-end tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
