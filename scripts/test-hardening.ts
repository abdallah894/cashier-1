import { createHash } from "node:crypto";
import { asAdminService, asUser, createTestDb, seedUser } from "./lib/pglite-db";

const ADMIN = "00000000-0000-0000-0000-00000000000a";
const CASHIER = "00000000-0000-0000-0000-00000000000b";
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

const sha = (value: string) => createHash("sha256").update(value).digest("hex");

async function main() {
  const db = await createTestDb();
  await seedUser(db, ADMIN, "admin", "admin");
  await seedUser(db, CASHIER, "cashier", "cashier");
  await db.query(`select public.set_pin('${ADMIN}', '1234')`);
  await db.query(`insert into public.products (id, barcode, name_ar, name_en, price, tax_rate, stock_qty, unit)
    values ('${PRODUCT}', 'hard-100', 'منتج', 'Product', 10000, 0, 100, 'piece')`);
  const { rows: shifts } = await db.query<{ id: string }>(
    `insert into public.shifts (cashier_id, opening_float) values ('${CASHIER}', 50000) returning id`
  );
  const shiftId = shifts[0].id;

  // ---- discount override: seeded default threshold is 10% of the gross ----
  await asUser(db, CASHIER);
  const sale = (discount: number, approval = "null") =>
    db.query<{ sale_id: string }>(
      `select * from public.create_sale(
        '[{"product_id":"${PRODUCT}","qty":1,"line_discount":${discount}}]'::jsonb,
        'cash', '${shiftId}', 10000, null, ${approval === "null" ? "null" : `'${approval}'::uuid`})`
    );

  const small = await sale(500); // 5% — below threshold
  check("small discount needs no approval", small.rows.length === 1);
  await asAdminService(db);
  const { rows: noAudit } = await db.query<{ count: string }>(
    `select count(*) from public.audit_events where action = 'sale_discount_override'`
  );
  check("below-threshold discount emits no override audit", Number(noAudit[0].count) === 0);

  await asUser(db, CASHIER);
  await expectError(sale(3000), "manager approval is required", "large discount requires approval");

  const gross = 10000;
  const discount = 3000;
  const hash = sha(`sale_discount|${gross}|${discount}`);
  const { rows: approvals } = await db.query<{ id: string }>(
    `select public.create_manager_approval('sale_discount', '${hash}', '1234') as id`
  );
  const big = await sale(discount, approvals[0].id);
  check("approved large discount succeeds", big.rows.length === 1);
  await expectError(sale(discount, approvals[0].id), "already used", "discount approval is single-use");

  await asAdminService(db);
  const { rows: audits } = await db.query<{ count: string; approved_by: string; target_id: string }>(
    `select count(*), max(approved_by::text) as approved_by, max(target_id::text) as target_id
     from public.audit_events where action = 'sale_discount_override'`
  );
  check("approved discount writes exactly one audit event", Number(audits[0].count) === 1);
  check("audit event records the approving manager", audits[0].approved_by === ADMIN);
  check("audit event targets the sale", audits[0].target_id === big.rows[0].sale_id);

  // ---- cart void ----
  await asUser(db, CASHIER);
  await expectError(
    db.query(`select public.record_cart_void(3, 4500, null)`),
    "approval is required",
    "cart void needs capability or approval"
  );
  const voidHash = sha("cart_void|3|4500");
  const { rows: voidApprovals } = await db.query<{ id: string }>(
    `select public.create_manager_approval('cart_void', '${voidHash}', '1234') as id`
  );
  await db.query(`select public.record_cart_void(3, 4500, '${voidApprovals[0].id}')`);
  await asAdminService(db);
  const { rows: voidAudits } = await db.query<{ count: string }>(
    `select count(*) from public.audit_events where action = 'cart_void'`
  );
  check("cart void writes exactly one audit event", Number(voidAudits[0].count) === 1);

  // ---- tamper resistance: ledgers cannot be edited or deleted, even by service role ----
  const { rows: ledger } = await db.query<{ id: string }>(`select id from public.audit_events limit 1`);
  await expectError(
    db.query(`update public.audit_events set actor_id = '${CASHIER}' where id = '${ledger[0].id}'`),
    "immutable",
    "service role cannot rewrite audit events"
  );
  await expectError(db.query(`delete from public.audit_events`), "immutable", "service role cannot delete audit events");
  await expectError(db.query(`delete from public.stock_movements`), "immutable", "stock movements cannot be deleted");
  await expectError(db.query(`update public.sales set total = 1`), "immutable", "sales cannot be edited");
  await expectError(db.query(`update public.sale_items set qty = 99`), "immutable", "sale items cannot be edited");
  await expectError(db.query(`delete from public.sales`), "immutable", "sales cannot be deleted");

  await db.query(`insert into public.cash_drawer_events (shift_id, event_type, amount, reason, actor_id)
    values ('${shiftId}', 'paid_in', 100, 'tamper probe', '${ADMIN}')`);
  await expectError(
    db.query(`update public.cash_drawer_events set amount = 1`),
    "immutable",
    "drawer events cannot be edited"
  );
  await expectError(db.query(`delete from public.cash_drawer_events`), "immutable", "drawer events cannot be deleted");

  await expectError(
    db.query(`update public.manager_approvals set approved_by = '${CASHIER}'`),
    "immutable",
    "approval binding cannot be rewritten"
  );
  await expectError(db.query(`delete from public.manager_approvals`), "immutable", "approvals cannot be deleted");
  await expectError(db.query(`truncate public.audit_events`), "immutable", "audit events cannot be truncated");

  await asUser(db, CASHIER);
  const cashierUpdate = await db.query(`update public.audit_events set metadata = '{}'::jsonb`).then((r) => r.affectedRows ?? 0, () => 0);
  check("cashier cannot touch audit events", cashierUpdate === 0);

  // ---- capability grants are audited and admin-only ----
  await asUser(db, CASHIER);
  await expectError(
    db.query(`select public.set_staff_capabilities('${CASHIER}', array['stock.correct']::public.capability[])`),
    "admin only",
    "a cashier cannot grant capabilities"
  );
  await asUser(db, ADMIN);
  await expectError(
    db.query(`select public.set_staff_capabilities('${ADMIN}', array[]::public.capability[])`),
    "your own",
    "an admin cannot change their own grants"
  );
  await db.query(`select public.set_staff_capabilities('${CASHIER}', array['stock.correct', 'customer.manage', 'stock.correct']::public.capability[])`);
  await asAdminService(db);
  const grants = await db.query<{ capability: string }>(`select capability from public.staff_capabilities where staff_id = '${CASHIER}' order by capability`);
  check("grants replace the previous set without duplicates", grants.rows.map((r) => r.capability).join() === "stock.correct,customer.manage".split(",").sort().join() || grants.rows.length === 2);
  const grantAudits = await db.query<{ count: string }>(`select count(*) from public.audit_events where action = 'capabilities_changed'`);
  check("a grant change emits one audit event", Number(grantAudits.rows[0].count) === 1);
  await asUser(db, ADMIN);
  await db.query(`select public.set_staff_capabilities('${CASHIER}', array[]::public.capability[])`);
  await asAdminService(db);
  const revoked = await db.query(`select 1 from public.staff_capabilities where staff_id = '${CASHIER}'`);
  check("an empty set revokes everything", revoked.rows.length === 0);

  // ---- double close: the second attempt must fail and change nothing ----
  await asUser(db, CASHIER);
  await db.query(`select * from public.close_shift('${shiftId}', 0)`);
  await asAdminService(db);
  const snapshot = async () =>
    (await db.query(`select closed_at::text, closing_counted::text, expected_cash::text from public.shifts where id = '${shiftId}'`)).rows;
  const closedBefore = await snapshot();
  await asUser(db, CASHIER);
  await expectError(
    db.query(`select * from public.close_shift('${shiftId}', 5)`),
    "already closed",
    "second close attempt is rejected"
  );
  await asAdminService(db);
  check("rejected second close leaves the shift untouched", JSON.stringify(closedBefore) === JSON.stringify(await snapshot()));
  const { rows: shiftAudits } = await db.query<{ count: string }>(
    `select count(*) from public.audit_events where action = 'shift_close' and target_id = '${shiftId}'`
  );
  check("a shift is closed and audited exactly once", Number(shiftAudits[0].count) === 1);

  if (failures > 0) {
    console.error(`\n${failures} check(s) failing`);
    process.exit(1);
  }
  console.log("\nHardening tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
