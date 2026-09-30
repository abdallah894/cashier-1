/**
 * Reporting RPC SQL tests — run with: npm run test:reports
 * Validates supabase/migrations/20260714120000_reporting.sql on PGlite:
 * every aggregate is asserted against hand-computed totals, plus the
 * admin-only guard.
 */
import { createTestDb, asUser, asAdminService, seedUser } from "./lib/pglite-db";

const ADMIN = "00000000-0000-0000-0000-00000000000a";
const CASHIER = "00000000-0000-0000-0000-00000000000b";
const CAT1 = "00000000-0000-0000-0000-0000000000c1";
const PROD_A = "00000000-0000-0000-0000-000000000101"; // priced 114.00, 14% VAT, cost 80.00
const PROD_B = "00000000-0000-0000-0000-000000000102"; // priced 50.00, 0% VAT, cost 40.00, per-kg
const SHIFT = "00000000-0000-0000-0000-0000000000f1";

// Full range covering the fixed sale timestamps below.
const FROM = "2026-07-01T00:00:00Z";
const TO = "2026-07-31T23:59:59.999Z";

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
const n = (v: unknown) => Number(v);

async function main() {
  const db = await createTestDb();
  await seedUser(db, ADMIN, "admin", "admin");
  await seedUser(db, CASHIER, "cashier", "cashier");

  await db.exec(`
    insert into public.categories (id, name_ar, name_en) values ('${CAT1}', 'صنف', 'Cat1');
    insert into public.products (id, barcode, name_ar, name_en, category_id, price, cost, tax_rate, stock_qty, unit)
    values
      ('${PROD_A}', '101', 'أ', 'A', '${CAT1}', 11400, 8000, 0.14, 100, 'piece'),
      ('${PROD_B}', '102', 'ب', 'B', null,        5000, 4000, 0,    100, 'kg');
    insert into public.shifts (id, cashier_id, opened_at, opening_float)
    values ('${SHIFT}', '${CASHIER}', '2026-07-10T08:00:00Z', 50000);
  `);

  // Three sales as the cashier, all on 2026-07-10 (one UTC-day bucket).
  await asUser(db, CASHIER);
  const sell = (items: string, tendered: string) =>
    db.query(
      `select * from public.create_sale($1::jsonb, 'cash', $2::uuid, $3::numeric, null)`,
      [items, SHIFT, tendered]
    );
  await sell(JSON.stringify([{ product_id: PROD_A, qty: 2 }]), "50000"); // total 22800
  await sell(JSON.stringify([{ product_id: PROD_A, qty: 1 }]), "50000"); // total 11400
  await sell(JSON.stringify([{ product_id: PROD_B, qty: 5 }]), "50000"); // total 25000
  // Expected: revenue 59200, count 3; A qty 3 rev 34200; B qty 5 rev 25000

  // `create_sale` intentionally stamps facts with now(); pin test-only data
  // to the fixed report window so this suite is independent of the clock.
  await asAdminService(db);
  await db.exec(`
    update public.sales
    set created_at = '2026-07-10T10:00:00Z'
    where shift_id = '${SHIFT}';
  `);

  await asUser(db, ADMIN);
  const call = async (sql: string) => (await db.query(sql, [FROM, TO])).rows as Record<string, unknown>[];

  // ---- summary ----
  {
    const [r] = await call(`select * from public.report_summary($1, $2)`);
    check("summary revenue = 59200", n(r.revenue) === 59200, String(r.revenue));
    check("summary refunds = 0", n(r.refunds) === 0, String(r.refunds));
    check("summary net_revenue = 59200", n(r.net_revenue) === 59200, String(r.net_revenue));
    check("summary sale_count = 3", n(r.sale_count) === 3, String(r.sale_count));
    check("summary avg_basket = 19733", n(r.avg_basket) === 19733, String(r.avg_basket));
  }

  // ---- sales over time (day) ----
  {
    const rows = await call(`select * from public.report_sales_over_time($1, $2, 'day')`);
    check("over_time single day bucket", rows.length === 1, `${rows.length} buckets`);
    check("over_time bucket revenue = 59200", n(rows[0]?.revenue) === 59200, String(rows[0]?.revenue));
    check("over_time bucket count = 3", n(rows[0]?.sale_count) === 3);
  }

  // ---- top products ----
  {
    const byRev = await call(`select * from public.report_top_products($1, $2, 'revenue', 10)`);
    check("top by revenue: A first", byRev[0]?.product_id === PROD_A, String(byRev[0]?.product_id));
    check("top A revenue = 34200", n(byRev[0]?.revenue) === 34200, String(byRev[0]?.revenue));
    check("top A qty = 3", n(byRev[0]?.qty) === 3, String(byRev[0]?.qty));
    const byQty = await call(`select * from public.report_top_products($1, $2, 'qty', 10)`);
    check("top by qty: B first (qty 5 > 3)", byQty[0]?.product_id === PROD_B, String(byQty[0]?.product_id));
  }

  // ---- sales by category ----
  {
    const rows = await call(`select * from public.report_sales_by_category($1, $2)`);
    const cat1 = rows.find((r) => r.category_id === CAT1);
    const uncat = rows.find((r) => r.category_id === null);
    check("category Cat1 revenue = 34200", n(cat1?.revenue) === 34200, String(cat1?.revenue));
    check("category Uncategorized revenue = 25000", n(uncat?.revenue) === 25000, String(uncat?.revenue));
  }

  // ---- sales by cashier ----
  {
    const [r] = await call(`select * from public.report_sales_by_cashier($1, $2)`);
    check("cashier revenue = 59200", n(r?.revenue) === 59200, String(r?.revenue));
    check("cashier sale_count = 3", n(r?.sale_count) === 3);
  }

  // ---- profit ----
  {
    const [r] = await call(`select * from public.report_profit($1, $2)`);
    // net: 20000 + 10000 + 25000 = 55000; cost: 3*8000 + 5*4000 = 44000
    check("profit net_revenue = 55000", n(r?.net_revenue) === 55000, String(r?.net_revenue));
    check("profit cost = 44000", n(r?.cost) === 44000, String(r?.cost));
    check("profit = 11000", n(r?.profit) === 11000, String(r?.profit));
    check("margin = 0.2", n(r?.margin) === 0.2, String(r?.margin));
  }

  // ---- admin-only guard ----
  await asUser(db, CASHIER);
  await expectError(
    db.query(`select * from public.report_summary($1, $2)`, [FROM, TO]),
    "admin only",
    "cashier is denied (42501)"
  );

  if (failures > 0) {
    console.error(`\n${failures} check(s) failing`);
    process.exit(1);
  }
  console.log("\nAll reporting tests passed.");
}

main();
