import { createHash } from "node:crypto";
import { asAdminService, asUser, createTestDb, seedUser } from "./lib/pglite-db";

const ADMIN = "00000000-0000-0000-0000-00000000000a";
const CASHIER = "00000000-0000-0000-0000-00000000000b";
const OTHER = "00000000-0000-0000-0000-00000000000c";
const P = "00000000-0000-0000-0000-000000000101";

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
const n = (value: unknown) => Number(value);
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

async function main() {
  const db = await createTestDb();
  await seedUser(db, ADMIN, "admin", "admin");
  await seedUser(db, CASHIER, "cashier", "cashier");
  await seedUser(db, OTHER, "other", "cashier");
  await db.query(`select public.set_pin('${ADMIN}', '1234')`);
  await db.query(`insert into public.products (id, barcode, name_ar, name_en, price, cost, tax_rate, stock_qty, unit)
    values ('${P}', 'dev-1', 'منتج', 'Product', 5000, 3000, 0, 1000, 'piece')`);
  const { rows: shifts } = await db.query<{ id: string; till_id: string }>(
    `insert into public.shifts (cashier_id, opening_float) values ('${CASHIER}', 0) returning id, till_id`
  );
  const shiftId = shifts[0].id;
  await db.query(`insert into public.shifts (cashier_id, opening_float) values ('${OTHER}', 0)`);

  const read = async (sql: string) => {
    const who = (await db.query<{ sub: string | null; u: string }>(`select current_setting('request.jwt.claim.sub', true) as sub, current_user as u`)).rows[0];
    await asAdminService(db);
    const rows = (await db.query(sql)).rows as Record<string, unknown>[];
    if (who.u === "authenticated" && who.sub) await asUser(db, who.sub);
    return rows;
  };

  // ---- tills ----
  const tills = await read(`select id, name from public.tills`);
  check("a default till exists", tills.length === 1 && tills[0].name === "Main Register");
  check("every shift belongs to a till", shifts[0].till_id === tills[0].id);
  const tillId = tills[0].id as string;

  // ---- device profiles are a declared list ----
  const profiles = await read(`select key, kind, supported from public.device_profiles order by key`);
  check("hardware profiles are declared", profiles.length >= 5 && profiles.every((p) => typeof p.kind === "string"));
  check("keyboard-wedge scanner, ESC/POS printer and printer-kick drawer are supported",
    ["usb_hid_keyboard", "escpos_usb_80mm", "printer_kick"].every((key) => profiles.some((p) => p.key === key && p.supported === true)));

  // ---- device management is admin-only and audited ----
  await asUser(db, CASHIER);
  await expectError(
    db.query(`select public.upsert_device('{"till_id":"${tillId}","kind":"printer","name":"Counter printer","profile":"escpos_usb_80mm"}'::jsonb)`),
    "admin only",
    "a cashier cannot register hardware"
  );
  await asUser(db, ADMIN);
  await expectError(
    db.query(`select public.upsert_device('{"till_id":"${tillId}","kind":"printer","name":"Bad","profile":"nope"}'::jsonb)`),
    "unknown profile",
    "an undeclared hardware profile is refused"
  );
  await expectError(
    db.query(`select public.upsert_device('{"till_id":"${tillId}","kind":"printer","name":"Bad","profile":"usb_hid_keyboard"}'::jsonb)`),
    "does not match",
    "a profile of another device kind is refused"
  );
  await expectError(
    db.query(`select public.upsert_device('{"till_id":"${tillId}","kind":"printer","name":"Unsupported","profile":"escpos_network_80mm"}'::jsonb)`),
    "not supported",
    "an undeclared-as-supported profile cannot be registered"
  );
  // Phase 3: printing through the Windows print queue (desktop app)
  const spooler = await read(`select kind, supported from public.device_profiles where key = 'escpos_spooler_80mm'`);
  check("the Windows print-queue printer profile is declared and supported", spooler.length === 1 && spooler[0].kind === "printer" && spooler[0].supported === true);
  await expectError(
    db.query(`select public.upsert_device('{"till_id":"${tillId}","kind":"cash_drawer","name":"Wrong","profile":"escpos_spooler_80mm"}'::jsonb)`),
    "does not match",
    "the print-queue profile cannot be used for another device kind"
  );
  const { rows: printer } = await db.query<{ id: string }>(
    `select public.upsert_device('{"till_id":"${tillId}","kind":"printer","name":"Counter printer","profile":"escpos_usb_80mm","settings":{"vendorId":1208}}'::jsonb) as id`
  );
  const { rows: drawer } = await db.query<{ id: string }>(
    `select public.upsert_device('{"till_id":"${tillId}","kind":"cash_drawer","name":"Drawer","profile":"printer_kick"}'::jsonb) as id`
  );
  const deviceAudits = await read(`select count(*) as c from public.audit_events where action = 'device_changed'`);
  check("registering hardware emits an audit event each time", n(deviceAudits[0].c) === 2);
  await asUser(db, CASHIER);
  check("a cashier can see the active devices of the till", (await db.query(`select * from public.devices`)).rows.length === 2);
  await expectError(db.query(`update public.devices set name = 'x'`).then((r) => { if (!r.affectedRows) throw new Error("no rows affected"); }), "no rows affected", "a cashier cannot edit devices directly");

  // ---- health ----
  await db.query(`select public.report_device_health('${printer[0].id}', 'ok', null)`);
  await db.query(`select public.report_device_health('${printer[0].id}', 'ok', null)`);
  await db.query(`select public.report_device_health('${printer[0].id}', 'offline', 'USB device not found')`);
  await expectError(db.query(`select public.report_device_health('${printer[0].id}', 'on fire', null)`), "invalid health", "an unknown health value is refused");
  const health = await read(`select health, health_detail, last_seen_at from public.devices where id = '${printer[0].id}'`);
  check("health is stored with its detail", health[0].health === "offline" && health[0].health_detail === "USB device not found" && health[0].last_seen_at !== null);
  const healthEvents = await read(`select count(*) as c from public.device_events where device_id = '${printer[0].id}' and event_type = 'health_change'`);
  check("only health changes are logged (ok, ok, offline -> two events)", n(healthEvents[0].c) === 2);

  // ---- a sale and a return to print / open the drawer for ----
  await asUser(db, CASHIER);
  const sell = (method: string, tendered: string, ref: string) =>
    db.query<{ sale_id: string }>(
      `select * from public.create_sale('[{"product_id":"${P}","qty":1,"line_discount":0}]'::jsonb, '${method}', '${shiftId}', ${tendered}, null, null, null, null, null, null, true, null, null, ${ref})`
    );
  const cashSale = await sell("cash", "10000", "null");
  const cardSale = await sell("card", "null", "'DEV-APPR-1'");

  // ---- print jobs: failures stay visible and reprint without a new sale ----
  const salesBefore = n((await read(`select count(*) as c from public.sales`))[0].c);
  const job1 = await db.query<{ id: string }>(`select public.request_print('sale_receipt', '${cashSale.rows[0].sale_id}', 'original', null) as id`);
  const created = await read(`select status, copy_number, requested_by, till_id, kind from public.print_jobs where id = '${job1.rows[0].id}'`);
  check("a print request records actor, till and copy number", created[0].status === "queued" && n(created[0].copy_number) === 1 && created[0].requested_by === CASHIER && created[0].till_id === tillId);
  await db.query(`select public.complete_print_job('${job1.rows[0].id}', false, 'paper out', '${printer[0].id}')`);
  const failed = await read(`select status, error from public.print_jobs where id = '${job1.rows[0].id}'`);
  check("a failed print is recorded with its error", failed[0].status === "failed" && failed[0].error === "paper out");
  await expectError(db.query(`select public.complete_print_job('${job1.rows[0].id}', true, null, '${printer[0].id}')`), "already completed", "a finished job cannot be completed twice");
  const retry = await db.query<{ id: string }>(`select public.request_print('sale_receipt', '${cashSale.rows[0].sale_id}', 'original', null) as id`);
  check("retrying a failed print is a new job for the same copy", (await read(`select copy_number from public.print_jobs where id = '${retry.rows[0].id}'`))[0].copy_number === 1);
  await db.query(`select public.complete_print_job('${retry.rows[0].id}', true, null, '${printer[0].id}')`);

  await expectError(db.query(`select public.request_print('sale_receipt', '${cashSale.rows[0].sale_id}', 'reprint', '  ')`), "reason is required", "a reprint needs a reason");
  const reprint = await db.query<{ id: string }>(`select public.request_print('sale_receipt', '${cashSale.rows[0].sale_id}', 'reprint', 'Customer lost the receipt') as id`);
  check("a reprint is marked as the next copy", (await read(`select copy_number, reason from public.print_jobs where id = '${reprint.rows[0].id}'`))[0].copy_number === 2);
  const reprintAudit = await read(`select count(*) as c from public.audit_events where action = 'receipt_reprinted'`);
  check("a reprint emits exactly one audit event", n(reprintAudit[0].c) === 1);
  check("printing never creates a sale", n((await read(`select count(*) as c from public.sales`))[0].c) === salesBefore);

  const gift = await db.query<{ id: string }>(`select public.request_print('sale_receipt', '${cashSale.rows[0].sale_id}', 'gift', null) as id`);
  check("a gift receipt is allowed for a sale", gift.rows[0].id !== undefined);
  await expectError(db.query(`select public.request_print('z_report', '${shiftId}', 'gift', null)`), "gift receipts", "a gift receipt only exists for sales");
  await asUser(db, OTHER);
  await expectError(db.query(`select public.request_print('sale_receipt', '${cashSale.rows[0].sale_id}', 'original', null)`), "not yours", "another cashier cannot print someone else's sale");
  await expectError(db.query(`select public.request_print('sale_receipt', '00000000-0000-0000-0000-0000000000ff', 'original', null)`), "not found", "an unknown document is refused");
  await asAdminService(db);
  await expectError(db.query(`delete from public.device_events`), "immutable", "device events cannot be deleted");
  await expectError(db.query(`update public.device_events set detail = 'x'`), "immutable", "device events cannot be edited");

  // ---- the drawer opens only for approved events ----
  await asUser(db, CASHIER);
  const authorize = (reason: string, ref: string, note = "null", approval = "null") =>
    db.query<{ id: string }>(`select public.authorize_drawer_open('${reason}', ${ref}, ${note}, ${approval}) as id`);
  await expectError(authorize("cash_sale", `'${cardSale.rows[0].sale_id}'::uuid`), "not a cash sale", "a card sale does not open the drawer");
  await asUser(db, OTHER);
  await expectError(authorize("cash_sale", `'${cashSale.rows[0].sale_id}'::uuid`), "not yours", "another cashier's sale does not open my drawer");
  await asUser(db, CASHIER);
  const opening = await authorize("cash_sale", `'${cashSale.rows[0].sale_id}'::uuid`);
  await expectError(authorize("cash_sale", `'${cashSale.rows[0].sale_id}'::uuid`), "already authorized", "one sale authorises one opening");
  await db.query(`select public.complete_drawer_opening('${opening.rows[0].id}', true, null, '${drawer[0].id}')`);
  const opened = await read(`select status, till_id, actor_id, shift_id from public.drawer_openings where id = '${opening.rows[0].id}'`);
  check("an approved opening records till, actor and shift", opened[0].status === "opened" && opened[0].till_id === tillId && opened[0].actor_id === CASHIER && opened[0].shift_id === shiftId);
  await expectError(authorize("cash_sale", `'${cashSale.rows[0].sale_id}'::uuid`), "already authorized", "a completed opening cannot be replayed");

  await asAdminService(db);
  await db.query(`set session_replication_role = replica`);
  await db.query(`update public.sales set created_at = now() - interval '2 hours' where id = '${cashSale.rows[0].sale_id}'`);
  await db.query(`set session_replication_role = origin`);
  await asUser(db, CASHIER);
  const oldSale = await sell("cash", "10000", "null");
  void oldSale;
  await expectError(authorize("cash_sale", `'${cashSale.rows[0].sale_id}'::uuid`), "too old", "an old sale no longer opens the drawer");

  const failedOpening = await sell("cash", "10000", "null");
  const first = await authorize("cash_sale", `'${failedOpening.rows[0].sale_id}'::uuid`);
  await db.query(`select public.complete_drawer_opening('${first.rows[0].id}', false, 'printer offline', '${drawer[0].id}')`);
  const second = await authorize("cash_sale", `'${failedOpening.rows[0].sale_id}'::uuid`);
  check("a failed opening can be authorised again", second.rows[0].id !== first.rows[0].id);

  await expectError(authorize("no_sale", "null", "'  '"), "reason is required", "a no-sale opening needs a reason");
  await expectError(authorize("no_sale", "null", "'check change'"), "approval is required", "a no-sale opening needs the capability or a manager");
  const hash = sha(`drawer_open|${shiftId}|check change`);
  const { rows: approvals } = await db.query<{ id: string }>(`select public.create_manager_approval('cash_drawer_event', '${hash}', '1234') as id`);
  const noSale = await authorize("no_sale", "null", "'check change'", `'${approvals[0].id}'::uuid`);
  check("a manager-approved no-sale opening is authorised", noSale.rows.length === 1);
  const noSaleAudit = await read(`select approved_by from public.audit_events where action = 'drawer_open_authorized' and target_id = '${shiftId}' order by created_at desc limit 1`);
  check("the approving manager is on the audit event", noSaleAudit[0].approved_by === ADMIN);
  await asAdminService(db);
  await db.query(`insert into public.staff_capabilities (staff_id, capability, granted_by) values ('${CASHIER}', 'cash.drawer.adjust', '${ADMIN}')`);
  await asUser(db, CASHIER);
  const byCapability = await authorize("no_sale", "null", "'swap float'");
  check("a cash-drawer capability holder can open without a manager", byCapability.rows.length === 1);

  // cash refund + drawer event
  const sale2 = await sell("cash", "10000", "null");
  const item = (await read(`select id from public.sale_items where sale_id = '${sale2.rows[0].sale_id}'`))[0].id as string;
  const ret = await db.query<{ return_id: string }>(`select * from public.create_return('${sale2.rows[0].sale_id}', '[{"sale_item_id":"${item}","qty":1}]'::jsonb, 'cash', 'changed mind', true)`);
  const refundOpening = await authorize("cash_refund", `'${ret.rows[0].return_id}'::uuid`);
  check("a cash refund opens the drawer", refundOpening.rows.length === 1);
  const cardItem = (await read(`select id from public.sale_items where sale_id = '${cardSale.rows[0].sale_id}'`))[0].id as string;
  const cardRet = await db.query<{ return_id: string }>(`select * from public.create_return('${cardSale.rows[0].sale_id}', '[{"sale_item_id":"${cardItem}","qty":1}]'::jsonb, 'card', 'changed mind', true)`);
  await expectError(authorize("cash_refund", `'${cardRet.rows[0].return_id}'::uuid`), "not a cash refund", "a card refund does not open the drawer");

  const ev = await db.query<{ id: string }>(`select (public.record_cash_drawer_event('${shiftId}', 'paid_in', 500, 'float top-up')).id as id`);
  const eventOpening = await authorize("cash_drawer_event", `'${ev.rows[0].id}'::uuid`);
  check("a recorded paid-in opens the drawer", eventOpening.rows.length === 1);

  // ---- RLS / immutability ----
  await asUser(db, OTHER);
  check("a cashier sees only their own print jobs", (await db.query<{ requested_by: string }>(`select requested_by from public.print_jobs`)).rows.every((r) => r.requested_by === OTHER));
  check("a cashier sees only their own drawer openings", (await db.query(`select * from public.drawer_openings`)).rows.length === 0);
  await asUser(db, ADMIN);
  check("an admin sees every drawer opening", (await db.query(`select * from public.drawer_openings`)).rows.length >= 4);
  await asAdminService(db);
  await expectError(db.query(`delete from public.drawer_openings`), "immutable", "drawer openings cannot be deleted");
  await expectError(db.query(`update public.drawer_openings set reason = 'cash_sale'`), "immutable", "an opening's authorisation cannot be rewritten");

  if (failures > 0) {
    console.error(`\n${failures} check(s) failing`);
    process.exit(1);
  }
  console.log("\nDevice and hardware tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
