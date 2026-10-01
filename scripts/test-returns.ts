/**
 * Audited return SQL tests — run with: npx tsx scripts/test-returns.ts
 *
 * Covers the immutable return RPC: partial and full quantities, tender
 * ceilings, restock disposition, ownership, and manager approval.
 */
import { asAdminService, asUser, createTestDb, seedUser } from "./lib/pglite-db";

const ADMIN = "00000000-0000-0000-0000-00000000000a";
const CASHIER = "00000000-0000-0000-0000-00000000000b";
const CASHIER2 = "00000000-0000-0000-0000-00000000000c";
const PRODUCT = "00000000-0000-0000-0000-000000000101";

let failures = 0;

function check(name: string, condition: boolean, detail = "") {
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!condition) failures++;
}

async function expectError(promise: Promise<unknown>, fragment: string, name: string) {
  try {
    await promise;
    check(name, false, "no error raised");
  } catch (error) {
    const message = (error as Error).message;
    check(name, message.includes(fragment), message);
  }
}

async function main() {
  const db = await createTestDb();
  await seedUser(db, ADMIN, "manager", "admin");
  await seedUser(db, CASHIER, "cashier", "cashier");
  await seedUser(db, CASHIER2, "cashier2", "cashier");
  await db.exec(`
    insert into public.products (id, barcode, name_ar, name_en, price, tax_rate, stock_qty, unit)
    values ('${PRODUCT}', '100', 'منتج', 'Product', 6300, 0.14, 100, 'piece');
  `);

  await asAdminService(db);
  await db.query(`select public.set_pin('${ADMIN}', '1234')`);

  await asUser(db, CASHIER);
  const { rows: shiftRows } = await db.query<{ id: string }>(
    `insert into public.shifts (cashier_id, opening_float) values ('${CASHIER}', 0) returning id`
  );
  const { rows: saleRows } = await db.query<{ sale_id: string }>(
    `select * from public.create_sale(
      '[{"product_id":"${PRODUCT}","qty":2}]'::jsonb,
      'cash', '${shiftRows[0].id}', 20000
    )`
  );
  const saleId = saleRows[0].sale_id;
  const { rows: saleItemRows } = await db.query<{ id: string }>(
    `select id from public.sale_items where sale_id = '${saleId}'`
  );
  const saleItemId = saleItemRows[0].id;

  const createReturn = (quantity: number, restock: boolean, managerPin: string | null = null) =>
    db.query<{ refund_total: string; return_id: string }>(
      `select * from public.create_return(
        '${saleId}',
        '[{"sale_item_id":"${saleItemId}","qty":${quantity}}]'::jsonb,
        'cash', 'Customer changed mind', ${restock}, ${managerPin ? `'${managerPin}'` : "null"}
      )`
    );

  const { rows: partial } = await createReturn(1, true);
  check("partial return refunds the snapshot line total", Number(partial[0].refund_total) === 6300);

  const { rows: drawerRefunds } = await db.query<{ amount: string; event_type: string }>(
    `select amount, event_type from public.cash_drawer_events where return_id = '${partial[0].return_id}'`
  );
  check(
    "cash return records a negative drawer event",
    drawerRefunds.length === 1 && drawerRefunds[0].event_type === "cash_refund" && Number(drawerRefunds[0].amount) === -6300
  );

  const { rows: stockAfterRestock } = await db.query<{ stock_qty: string }>(
    `select stock_qty from public.products where id = '${PRODUCT}'`
  );
  check("restocked return restores stock", Number(stockAfterRestock[0].stock_qty) === 99);

  await asAdminService(db);
  const { rows: movements } = await db.query<{ qty_change: string; reason: string }>(
    `select qty_change, reason from public.stock_movements where reason = 'return'`
  );
  check(
    "restocked return records a positive immutable stock movement",
    movements.length === 1 && Number(movements[0].qty_change) === 1 && movements[0].reason === "return"
  );

  await asUser(db, CASHIER);

  await expectError(
    createReturn(2, true),
    "return quantity exceeds sold quantity",
    "return cannot exceed the unreturned quantity"
  );

  const { rows: noRestock } = await createReturn(1, false);
  check("remaining quantity can be returned without restocking", Number(noRestock[0].refund_total) === 6300);
  const { rows: stockAfterNoRestock } = await db.query<{ stock_qty: string }>(
    `select stock_qty from public.products where id = '${PRODUCT}'`
  );
  check("no-restock return leaves stock unchanged", Number(stockAfterNoRestock[0].stock_qty) === 99);

  await asUser(db, CASHIER2);
  await expectError(
    db.query(
      `select * from public.create_return(
        '${saleId}', '[{"sale_item_id":"${saleItemId}","qty":1}]'::jsonb,
        'cash', 'Customer changed mind', true, null
      )`
    ),
    "not your sale",
    "cashier cannot return another cashier's sale"
  );

  await asAdminService(db);
  await db.exec(`update public.return_settings set manager_approval_threshold = 1 where id = true;`);
  await asUser(db, CASHIER);
  const { rows: thresholdSaleRows } = await db.query<{ sale_id: string }>(
    `select * from public.create_sale(
      '[{"product_id":"${PRODUCT}","qty":1}]'::jsonb,
      'cash', '${shiftRows[0].id}', 10000
    )`
  );
  const { rows: thresholdItemRows } = await db.query<{ id: string }>(
    `select id from public.sale_items where sale_id = '${thresholdSaleRows[0].sale_id}'`
  );
  const createThresholdReturn = (managerPin: string | null = null) =>
    db.query<{ refund_total: string }>(
      `select * from public.create_return(
        '${thresholdSaleRows[0].sale_id}',
        '[{"sale_item_id":"${thresholdItemRows[0].id}","qty":1}]'::jsonb,
        'cash', 'Customer changed mind', true, ${managerPin ? `'${managerPin}'` : "null"}
      )`
    );
  await expectError(
    createThresholdReturn(),
    "manager approval is required",
    "configured threshold rejects a cashier return without manager approval"
  );
  const { rows: approved } = await createThresholdReturn("1234");
  check("manager PIN approves a threshold return", Number(approved[0].refund_total) === 6300);

  if (failures > 0) {
    console.error(`\n${failures} check(s) failing`);
    process.exit(1);
  }
  console.log("\nAll return tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
