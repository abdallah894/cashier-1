/**
 * Phase 0 (review P1-2): create_sale validates what a direct RPC caller sends.
 * Run with: npx tsx scripts/test-create-sale-hardening.ts
 */
import { createTestDb, asUser, asAdminService, seedUser } from "./lib/pglite-db";

const ADMIN = "00000000-0000-0000-0000-00000000000a";
const CASHIER = "00000000-0000-0000-0000-00000000000b";
const PIECE = "00000000-0000-0000-0000-000000000101";
const KG = "00000000-0000-0000-0000-000000000102";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failures++;
}
async function expectError(promise: Promise<unknown>, fragment: string, name: string) {
  try {
    await promise;
    check(name, false, "no error raised");
  } catch (err) {
    const msg = (err as Error).message;
    check(name, msg.includes(fragment), msg);
  }
}

async function main() {
  const db = await createTestDb();
  await seedUser(db, ADMIN, "admin", "admin");
  await seedUser(db, CASHIER, "cashier", "cashier");
  await db.exec(`
    insert into public.products (id, barcode, name_ar, name_en, price, tax_rate, stock_qty, unit) values
      ('${PIECE}', '100', 'قطعة', 'Piece', 1000, 0.14, 100, 'piece'),
      ('${KG}', '200', 'كيلو', 'Kilo', 4000, 0, 50, 'kg');
  `);
  await asUser(db, CASHIER);
  const shift = (await db.query<{ id: string }>(`insert into public.shifts (cashier_id, opening_float) values ('${CASHIER}', 0) returning id`)).rows[0].id;

  const sale = (items: unknown, tendered: number | string, extra = "") =>
    db.query(`select * from public.create_sale('${JSON.stringify(items)}'::jsonb, 'cash', '${shift}', ${tendered} ${extra})`);
  const one = (qty: number, id = PIECE, line_discount = 0) => [{ product_id: id, qty, line_discount }];

  // a normal sale still works, including a weighed line
  const ok = await sale([{ product_id: KG, qty: 1.25 }], 20000);
  check("a normal weighed sale still works", ok.rows.length === 1 && Number((ok.rows[0] as { total: string }).total) === 5000);

  await expectError(sale(one(0.4355, KG), 20000), "at most 3 decimals", "qty with more than 3 decimals is refused");
  await expectError(sale(one(1, PIECE, 10.5), 20000), "whole piasters", "a fractional line discount is refused");
  await expectError(sale(one(1), 1000.5), "whole piasters", "fractional cash received is refused");
  await expectError(sale(one(1), -5), "whole piasters", "negative cash received is refused");
  await expectError(sale(one(1), 10000001), "between 0 and 10000000", "a barcode-sized cash amount is refused");
  const atCap = await sale(one(1), 10000000);
  check("the cap itself is accepted", atCap.rows.length === 1);

  // stock was only reduced by the two accepted sales (1 piece, 1.25 kg)
  const stock = await db.query<{ id: string; stock_qty: string }>(`select id, stock_qty from public.products order by id`);
  check("refused sales changed no stock", Number(stock.rows[0].stock_qty) === 99 && Number(stock.rows[1].stock_qty) === 48.75, stock.rows.map((r) => r.stock_qty).join(","));

  // a deactivated cashier with a still-valid token cannot sell
  await asAdminService(db);
  await db.exec(`update public.profiles set active = false where id = '${CASHIER}'`);
  await asUser(db, CASHIER);
  await expectError(sale(one(1), 5000), "not active", "a deactivated cashier cannot sell");

  // Locking order cannot be raced in a single connection; guard the source so a
  // future rewrite of the function cannot silently drop the global product lock order.
  await asAdminService(db);
  const src = (await db.query<{ prosrc: string }>(`select prosrc from pg_proc where proname = 'create_sale'`)).rows[0].prosrc;
  check("products are locked up front in id order", /order by id\s+for update/.test(src));

  if (failures > 0) {
    console.error(`\n${failures} check(s) failing`);
    process.exit(1);
  }
  console.log("\ncreate_sale hardening tests passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
