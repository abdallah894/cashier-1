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
