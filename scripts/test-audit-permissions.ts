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
  await seedUser(db, ADMIN, "admin", "admin");
  await seedUser(db, CASHIER, "cashier", "cashier");
  await seedUser(db, CASHIER2, "cashier2", "cashier");
  await asAdminService(db);
  await db.query(`select public.set_pin('${ADMIN}', '1234')`);
  await db.query(`insert into public.products (id, barcode, name_ar, name_en, price, tax_rate, stock_qty, unit)
    values ('${PRODUCT}', 'audit-100', 'منتج', 'Product', 1000, 0, 10, 'piece')`);

  await asUser(db, CASHIER);
  await expectError(
    db.query(`insert into public.staff_capabilities (staff_id, capability, granted_by)
      values ('${CASHIER}', 'cash.drawer.adjust', '${CASHIER}')`),
    "row-level security",
    "cashier cannot self-grant a capability"
  );
  const { rows: cashierCapabilities } = await db.query<{ allowed: boolean }>(
    `select public.has_capability('cash.drawer.adjust') as allowed`
  );
  check("cashier has no ungranted capability", cashierCapabilities[0].allowed === false);

  await asUser(db, ADMIN);
  const { rows: adminCapabilities } = await db.query<{ allowed: boolean }>(
    `select public.has_capability('cash.drawer.adjust') as allowed`
  );
  check("active admin has every capability", adminCapabilities[0].allowed === true);

  await asAdminService(db);
  await db.query(`insert into public.staff_capabilities (staff_id, capability, granted_by)
    values ('${CASHIER}', 'cash.drawer.adjust', '${ADMIN}')`);
  await asUser(db, CASHIER);
  const { rows: grantedCapabilities } = await db.query<{ allowed: boolean }>(
    `select public.has_capability('cash.drawer.adjust') as allowed`
  );
  check("explicit cashier grant enables the capability", grantedCapabilities[0].allowed === true);
  await expectError(
    db.query(`insert into public.audit_events (actor_id, action, target_type, metadata)
      values ('${CASHIER}', 'cash_drawer_event', 'shift', '{}'::jsonb)`),
    "row-level security",
    "cashier cannot forge audit event"
  );

  const requestHash = "a".repeat(64);
  const { rows: approvals } = await db.query<{ approval_id: string }>(
    `select public.create_manager_approval('cash_drawer_event', '${requestHash}', '1234') as approval_id`
  );
  await expectError(
    db.query(`select public.consume_manager_approval('${approvals[0].approval_id}',
      'cash_drawer_event', '${"b".repeat(64)}')`),
    "does not match",
    "approval cannot authorize a changed request"
  );
  await asUser(db, CASHIER2);
  await expectError(
    db.query(`select public.consume_manager_approval('${approvals[0].approval_id}',
      'cash_drawer_event', '${requestHash}')`),
    "not requested by you",
    "approval cannot be consumed by another requester"
  );
  await asUser(db, CASHIER);
  const { rows: consumed } = await db.query<{ consume_manager_approval: string }>(
    `select public.consume_manager_approval('${approvals[0].approval_id}',
      'cash_drawer_event', '${requestHash}')`
  );
  check("matching requester can consume approval", consumed[0].consume_manager_approval === ADMIN);
  await expectError(
    db.query(`select public.consume_manager_approval('${approvals[0].approval_id}',
      'cash_drawer_event', '${requestHash}')`),
    "already used",
    "approval cannot be consumed twice"
  );
  await asUser(db, CASHIER);
  const { rows: expiredApprovals } = await db.query<{ approval_id: string }>(
    `select public.create_manager_approval('cash_drawer_event', '${"c".repeat(64)}', '1234') as approval_id`
  );
  await asAdminService(db);
  await db.query(`update public.manager_approvals set expires_at = now() - interval '1 second'
    where id = '${expiredApprovals[0].approval_id}'`);
  await asUser(db, CASHIER);
  await expectError(
    db.query(`select public.consume_manager_approval('${expiredApprovals[0].approval_id}',
      'cash_drawer_event', '${"c".repeat(64)}')`),
    "expired",
    "expired approval is rejected"
  );
  await asAdminService(db);
  const { rows: auditMetadata } = await db.query<{ metadata: unknown }>(
    `select metadata from public.audit_events where action = 'approval_created'`
  );
  check("approval audit metadata contains no PIN", !JSON.stringify(auditMetadata).includes("1234"));

  await asUser(db, CASHIER2);
  await expectError(
    db.query(`select public.adjust_stock('${PRODUCT}', 1, 'correction', 'Count correction')`),
    "capability required",
    "cashier needs stock correction capability"
  );
  await asAdminService(db);
  await db.query(`insert into public.staff_capabilities (staff_id, capability, granted_by)
    values ('${CASHIER2}', 'stock.correct', '${ADMIN}')`);
  await asUser(db, CASHIER2);
  await db.query(`select public.adjust_stock('${PRODUCT}', 1, 'correction', 'Count correction')`);
  await asAdminService(db);
  const { rows: stockAudits } = await db.query<{ count: string }>(
    `select count(*) from public.audit_events where action = 'stock_correction' and actor_id = '${CASHIER2}'`
  );
  check("authorized stock correction writes one audit event", Number(stockAudits[0].count) === 1);
  await asUser(db, CASHIER2);
  const { rows: shiftRows } = await db.query<{ id: string }>(
    `insert into public.shifts (cashier_id, opening_float) values ('${CASHIER2}', 0) returning id`
  );
  await expectError(
    db.query(`select public.record_cash_drawer_event('${shiftRows[0].id}', 'paid_in', 100, 'Float top-up')`),
    "capability required",
    "cashier needs cash drawer capability"
  );
  await asAdminService(db);
  await db.query(`insert into public.staff_capabilities (staff_id, capability, granted_by)
    values ('${CASHIER2}', 'cash.drawer.adjust', '${ADMIN}')`);
  await asUser(db, CASHIER2);
  await db.query(`select public.record_cash_drawer_event('${shiftRows[0].id}', 'paid_in', 100, 'Float top-up')`);
  await asAdminService(db);
  const { rows: drawerAudits } = await db.query<{ count: string }>(
    `select count(*) from public.audit_events where action = 'cash_drawer_event' and actor_id = '${CASHIER2}'`
  );
  check("authorized drawer event writes one audit event", Number(drawerAudits[0].count) === 1);

  if (failures > 0) {
    console.error(`\n${failures} check(s) failing`);
    process.exit(1);
  }
  console.log("\nAudit permission tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
