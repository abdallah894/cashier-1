import { asAdminService, asUser, createTestDb, seedUser } from "./lib/pglite-db";

const ADMIN = "00000000-0000-0000-0000-00000000000a";
const CASHIER = "00000000-0000-0000-0000-00000000000b";

async function main() {
  const db = await createTestDb();
  await seedUser(db, ADMIN, "admin", "admin");
  await seedUser(db, CASHIER, "cashier", "cashier");
  await asUser(db, CASHIER);
  const { rows: shifts } = await db.query<{ id: string }>(
    `insert into public.shifts (cashier_id, opening_float) values ('${CASHIER}', 50000) returning id`
  );
  const shiftId = shifts[0].id;

  await asAdminService(db);
  await db.exec(`insert into public.products (barcode, name_ar, name_en, price, tax_rate, stock_qty, unit)
    values ('drawer-test', 'منتج', 'Product', 6300, 0, 10, 'piece')`);
  await db.query(`insert into public.staff_capabilities (staff_id, capability, granted_by)
    values ('${CASHIER}', 'cash.drawer.adjust', '${ADMIN}')`);
  const { rows: productRows } = await db.query<{ id: string }>("select id from public.products where barcode = 'drawer-test'");
  await asUser(db, CASHIER);
  await db.query(`select * from public.create_sale('[{"product_id":"${productRows[0].id}","qty":1}]'::jsonb, 'cash', '${shiftId}', 6300)`);
  const { rows: cashSaleEvents } = await db.query<{ amount: string }>(`select amount from public.cash_drawer_events where shift_id = '${shiftId}' and event_type = 'cash_sale'`);
  if (cashSaleEvents.length !== 1 || Number(cashSaleEvents[0].amount) !== 6300) throw new Error("cash sale must append exactly one drawer event");

  let rejected = false;
  try {
    await db.query(`select public.record_cash_drawer_event('${shiftId}', 'paid_out', 5000, '')`);
  } catch (error) {
    rejected = (error as Error).message.includes("reason is required");
  }
  if (!rejected) throw new Error("paid-out without a reason must be rejected");

  await db.query(`select public.record_cash_drawer_event('${shiftId}', 'paid_in', 10000, 'Float top-up')`);
  await db.query(`select public.record_cash_drawer_event('${shiftId}', 'safe_drop', 5000, 'Safe deposit')`);
  const { rows } = await db.query<{ expected_cash: string }>(
    `select * from public.close_shift('${shiftId}', 61300)`
  );
  if (Number(rows[0].expected_cash) !== 61300) throw new Error("expected cash must include drawer events");

  await asAdminService(db);
  await db.query(`select public.set_pin('${ADMIN}', '4321')`);
  await db.query(`update public.cash_drawer_settings set variance_approval_threshold = 1000 where id = true`);
  const { rows: varianceShifts } = await db.query<{ id: string }>(
    `insert into public.shifts (cashier_id, opening_float) values ('${CASHIER}', 10000) returning id`
  );
  await asUser(db, CASHIER);
  let approvalRejected = false;
  try {
    await db.query(`select * from public.close_shift('${varianceShifts[0].id}', 0)`);
  } catch (error) {
    approvalRejected = (error as Error).message.includes("manager approval is required");
  }
  if (!approvalRejected) throw new Error("threshold variance must require manager approval");
  await db.query(`select * from public.close_shift('${varianceShifts[0].id}', 0, '4321')`);

  await asAdminService(db);
  const { rows: otherShifts } = await db.query<{ id: string }>(
    `insert into public.shifts (cashier_id, opening_float) values ('${ADMIN}', 0) returning id`
  );
  await asUser(db, CASHIER);
  let ownershipRejected = false;
  try {
    await db.query(`select public.record_cash_drawer_event('${otherShifts[0].id}', 'paid_in', 100, 'Wrong shift')`);
  } catch (error) {
    ownershipRejected = (error as Error).message.includes("not your shift");
  }
  if (!ownershipRejected) throw new Error("cashier must not record drawer events in another cashier's shift");
  console.log("Cash drawer ledger tests passed.");
}

main().catch((error) => { console.error(error); process.exit(1); });
