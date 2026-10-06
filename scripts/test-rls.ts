/**
 * RLS matrix — run with: npm run test:rls
 * Proves at the SQL level (not the UI) that a cashier can only reach
 * what the spec allows: catalog reads, own shifts, own sales.
 */
import { createTestDb, asUser, seedUser } from "./lib/pglite-db";

const ADMIN = "00000000-0000-0000-0000-00000000000a";
const CASHIER = "00000000-0000-0000-0000-00000000000b";
const CASHIER2 = "00000000-0000-0000-0000-00000000000c";
const PRODUCT = "00000000-0000-0000-0000-000000000101";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!cond) failures++;
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
  await seedUser(db, CASHIER2, "cashier2", "cashier");
  await db.exec(`
    insert into public.products (id, barcode, name_ar, name_en, price, tax_rate, stock_qty, unit)
    values ('${PRODUCT}', '100', 'منتج', 'Product', 1000, 0.14, 100, 'piece');
  `);

  // seed: each cashier opens a shift and records one sale
  const ITEM = JSON.stringify([{ product_id: PRODUCT, qty: 1 }]);
  for (const uid of [CASHIER, CASHIER2]) {
    await asUser(db, uid);
    const { rows } = await db.query<{ id: string }>(
      `insert into public.shifts (cashier_id, opening_float) values ('${uid}', 0) returning id`
    );
    await db.query(
      `select * from public.create_sale('${ITEM}'::jsonb, 'cash', '${rows[0].id}', 1000)`
    );
  }

  // ---------- as a cashier ----------
  await asUser(db, CASHIER);

  const products = await db.query(`select id from public.products`);
  check("cashier reads catalog", products.rows.length === 1);

  const upd = await db.query(`update public.products set price = 1 returning id`);
  check("cashier cannot update products (0 rows affected)", upd.rows.length === 0);

  await expectError(
    db.query(
      `insert into public.products (barcode, name_ar, name_en, price) values ('x', 'س', 'X', 1)`
    ),
    "row-level security",
    "cashier cannot insert products"
  );

  const shifts = await db.query<{ cashier_id: string }>(`select cashier_id from public.shifts`);
  check(
    "cashier sees ONLY own shifts",
    shifts.rows.length === 1 && shifts.rows[0].cashier_id === CASHIER,
    `saw ${shifts.rows.length}`
  );

  const sales = await db.query<{ cashier_id: string }>(`select cashier_id from public.sales`);
  check(
    "cashier sees ONLY own sales",
    sales.rows.length === 1 && sales.rows[0].cashier_id === CASHIER,
    `saw ${sales.rows.length}`
  );

  const movements = await db.query(`select id from public.stock_movements`);
  check("cashier sees NO stock_movements (reports data)", movements.rows.length === 0);

  const profiles = await db.query<{ id: string }>(`select id from public.profiles`);
  check(
    "cashier sees ONLY own profile",
    profiles.rows.length === 1 && profiles.rows[0].id === CASHIER
  );

  const promote = await db.query(
    `update public.profiles set role = 'admin' where id = '${CASHIER}' returning id`
  );
  check("cashier cannot self-promote (0 rows affected)", promote.rows.length === 0);

  await expectError(
    db.query(`insert into public.shifts (cashier_id, opening_float) values ('${CASHIER2}', 0)`),
    "row-level security",
    "cashier cannot open a shift for someone else"
  );

  // Phase 0 (P0-1): checkout is the RPC only — no direct sale/sale_items inserts.
  const ownShift = (
    await db.query<{ id: string }>(`select id from public.shifts where cashier_id = '${CASHIER}'`)
  ).rows[0].id;
  await expectError(
    db.query(
      `insert into public.sales (cashier_id, shift_id, subtotal, tax_total, total, payment_method, amount_tendered, change_due)
       values ('${CASHIER}', '${ownShift}', 1, 0, 1, 'cash', 1, 0)`
    ),
    "row-level security",
    "cashier cannot insert a sale directly (must use create_sale)"
  );
  const ownSale = (
    await db.query<{ id: string }>(`select id from public.sales where cashier_id = '${CASHIER}'`)
  ).rows[0].id;
  await expectError(
    db.query(
      `insert into public.sale_items (sale_id, product_id, name_ar, name_en, unit_price, tax_rate, qty)
       values ('${ownSale}', '${PRODUCT}', 'س', 'X', 1, 0, 1)`
    ),
    "row-level security",
    "cashier cannot append lines to a sale directly"
  );

  // Phase 0 (P0-2): a cashier cannot edit, close or reopen a shift by hand.
  const forgedClose = await db.query(
    `update public.shifts set closed_at = now(), closing_counted = 0, expected_cash = 0 where id = '${ownShift}' returning id`
  );
  check("cashier cannot close own shift by direct update (0 rows)", forgedClose.rows.length === 0);
  const forgedFloat = await db.query(
    `update public.shifts set opening_float = 999999 where id = '${ownShift}' returning id`
  );
  check("cashier cannot change opening float (0 rows)", forgedFloat.rows.length === 0);
  await asUser(db, CASHIER2);
  await expectError(
    db.query(
      `insert into public.shifts (cashier_id, opening_float, closed_at, closing_counted, expected_cash)
       values ('${CASHIER2}', 0, now(), 0, 0)`
    ),
    "must be open",
    "cannot create a shift that is already closed"
  );
  await asUser(db, CASHIER);

  // ---------- as admin ----------
  await asUser(db, ADMIN);
  const allShifts = await db.query(`select id from public.shifts`);
  check("admin sees all shifts", allShifts.rows.length === 2);
  const allSales = await db.query(`select id from public.sales`);
  check("admin sees all sales", allSales.rows.length === 2);
  const adminUpd = await db.query(`update public.products set price = 1100 returning id`);
  check("admin can update products", adminUpd.rows.length === 1);

  if (failures > 0) {
    console.error(`\n${failures} check(s) failing`);
    process.exit(1);
  }
  console.log("\nAll RLS checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
