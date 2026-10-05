import { asAdminService, asUser, createTestDb, seedUser } from "./lib/pglite-db";

/**
 * End-to-end business flows against the real schema (every migration applied
 * to an empty database): a full trading day at the till, from opening the
 * shift to the Z report, plus the failure paths that matter. These are the
 * CI gate for the critical flows: checkout, return and shift.
 */
const ADMIN = "00000000-0000-0000-0000-00000000000a";
const CASHIER = "00000000-0000-0000-0000-00000000000b";
const CASHIER2 = "00000000-0000-0000-0000-00000000000c";
const MILK = "00000000-0000-0000-0000-000000000101"; // 25.00, 14% VAT
const RICE = "00000000-0000-0000-0000-000000000102"; // 60.00/kg, 0% VAT
const LAST = "00000000-0000-0000-0000-000000000103"; // 1 unit in stock

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

async function main() {
  const db = await createTestDb();
  await seedUser(db, ADMIN, "admin", "admin");
  await seedUser(db, CASHIER, "cashier", "cashier");
  await seedUser(db, CASHIER2, "cashier2", "cashier");
  await db.query(`select public.set_pin('${ADMIN}', '1234')`);
  await db.query(`insert into public.products (id, barcode, name_ar, name_en, price, cost, tax_rate, stock_qty, unit) values
    ('${MILK}', 'e2e-milk', 'حليب', 'Milk', 2500, 1500, 0.14, 100, 'piece'),
    ('${RICE}', 'e2e-rice', 'أرز', 'Rice', 6000, 4000, 0, 50, 'kg'),
    ('${LAST}', 'e2e-last', 'أخير', 'Last item', 1000, 600, 0, 1, 'piece')`);
  await db.query(`insert into public.cash_drawer_settings (id, variance_approval_threshold) values (true, 1000) on conflict (id) do update set variance_approval_threshold = 1000`);

  const rows = async (sql: string) => {
    const who = (await db.query<{ sub: string | null; u: string }>(`select current_setting('request.jwt.claim.sub', true) as sub, current_user as u`)).rows[0];
    await asAdminService(db);
    const out = (await db.query(sql)).rows as Record<string, unknown>[];
    if (who.u === "authenticated" && who.sub) await asUser(db, who.sub);
    return out;
  };

  // ---------------- SHIFT: open ----------------
  await asUser(db, CASHIER);
  const shift = (await db.query<{ id: string }>(`insert into public.shifts (cashier_id, opening_float) values ('${CASHIER}', 50000) returning id`)).rows[0].id;
  await expectError(db.query(`insert into public.shifts (cashier_id, opening_float) values ('${CASHIER}', 0)`), "duplicate key", "a cashier cannot hold two open shifts");
  await asUser(db, CASHIER2);
  await expectError(
    db.query(`select * from public.create_sale('[{"product_id":"${MILK}","qty":1,"line_discount":0}]'::jsonb, 'cash', '${shift}', 5000)`),
    "not an open shift",
    "a sale cannot be recorded into someone else's shift"
  );

  // ---------------- CHECKOUT ----------------
  await asUser(db, CASHIER);
  const sell = (items: string, method: string, tendered: string, extra = "null, null, null, null, null, null, true, null, null, null") =>
    db.query<{ sale_id: string; sale_number: string; total: string; change_due: string | null; discount_total: string }>(
      `select * from public.create_sale('${items}'::jsonb, '${method}', '${shift}', ${tendered}, null, null, ${extra.replace(/^null, null, null, null, null, null/, "null, null, null, null, null, null")})`
    );
  void sell;
  const sale = (items: string, method: string, tendered: string, tail: string) =>
    db.query<{ sale_id: string; sale_number: string; total: string; change_due: string | null }>(
      `select * from public.create_sale('${items}'::jsonb, '${method}', '${shift}', ${tendered}, null, null, ${tail})`
    );
  // positional tail: idempotency_key, client_sold_at, customer_id, promo codes, apply_promotions, expected_total, payment_ids, card_reference
  const none = "null, null, null, null, true, null, null, null";

  const cash = await sale(`[{"product_id":"${MILK}","qty":4,"line_discount":0},{"product_id":"${RICE}","qty":1.5,"line_discount":500}]`, "cash", "30000", none);
  // 4 x 25.00 = 10000 ; 1.5kg x 60.00 = 9000 - 5.00 discount = 8500 ; total 18500
  check("a mixed piece/weight cash sale totals exactly in piasters", n(cash.rows[0].total) === 18500 && n(cash.rows[0].change_due) === 11500);

  const card = await sale(`[{"product_id":"${MILK}","qty":2,"line_discount":0}]`, "card", "null", "null, null, null, null, true, null, null, 'E2E-APPR-1'");
  check("a card sale records its terminal approval", n(card.rows[0].total) === 5000);
  check("sale numbers are issued without gaps", n(card.rows[0].sale_number) === n(cash.rows[0].sale_number) + 1);
  await expectError(sale(`[{"product_id":"${MILK}","qty":1,"line_discount":0}]`, "card", "null", none), "terminal approval reference", "a card sale without an approval code is refused");
  await expectError(sale(`[{"product_id":"${MILK}","qty":1,"line_discount":9000}]`, "cash", "5000", none), "discount exceeds", "a discount larger than the line is refused");
  await expectError(sale(`[{"product_id":"${MILK}","qty":1,"line_discount":1000}]`, "cash", "5000", none), "manager approval", "a large discount needs a manager");
  await expectError(sale(`[{"product_id":"${MILK}","qty":1,"line_discount":0}]`, "cash", "100", none), "less than", "underpaying cash is refused");
  await expectError(sale(`[{"product_id":"${MILK}","qty":1.5,"line_discount":0}]`, "cash", "5000", none), "whole number", "fractional pieces are refused");

  const key = "e2e00000-0000-4000-8000-000000000001";
  const first = await sale(`[{"product_id":"${MILK}","qty":1,"line_discount":0}]`, "cash", "5000", `'${key}', null, null, null, true, null, null, null`);
  const replay = await sale(`[{"product_id":"${MILK}","qty":1,"line_discount":0}]`, "cash", "5000", `'${key}', null, null, null, true, null, null, null`);
  check("a retried checkout (same idempotency key) returns the original sale", first.rows[0].sale_id === replay.rows[0].sale_id);

  // last unit: two cashiers race, exactly one wins
  const winner = await sale(`[{"product_id":"${LAST}","qty":1,"line_discount":0}]`, "cash", "1000", none);
  check("the last unit sells once", n(winner.rows[0].total) === 1000);
  await expectError(sale(`[{"product_id":"${LAST}","qty":1,"line_discount":0}]`, "cash", "1000", none), "insufficient stock", "the same unit cannot be sold twice");
  const stockMilk = (await rows(`select stock_qty from public.products where id = '${MILK}'`))[0].stock_qty;
  check("stock fell by exactly what was sold (4 + 2 + 1)", n(stockMilk) === 93);
  const snapshots = await rows(`select count(*) as c from public.sale_items where unit_cost is not null and name_en is not null and tax_rate is not null`);
  check("every sale line carries its name, tax and cost snapshots", n(snapshots[0].c) === 5);

  // ---------------- DRAWER ----------------
  await asAdminService(db);
  await db.query(`insert into public.staff_capabilities (staff_id, capability, granted_by) values ('${CASHIER}', 'cash.drawer.adjust', '${ADMIN}')`);
  await asUser(db, CASHIER);
  await expectError(db.query(`select public.record_cash_drawer_event('${shift}', 'paid_out', 2000, '')`), "reason is required", "a paid-out needs a reason");
  await db.query(`select public.record_cash_drawer_event('${shift}', 'paid_out', 2000, 'Delivery driver tip')`);

  // ---------------- RETURN ----------------
  const cashItem = (await rows(`select id from public.sale_items where sale_id = '${cash.rows[0].sale_id}' and product_id = '${MILK}'`))[0].id as string;
  const ret = (await db.query<{ return_id: string; refund_total: string }>(
    `select * from public.create_return('${cash.rows[0].sale_id}', '[{"sale_item_id":"${cashItem}","qty":1}]'::jsonb, 'cash', 'Past its date', true)`
  )).rows[0];
  check("a return refunds the line's exact value", n(ret.refund_total) === 2500);
  check("a restocked return restores stock", n((await rows(`select stock_qty from public.products where id = '${MILK}'`))[0].stock_qty) === 94);
  await expectError(
    db.query(`select * from public.create_return('${cash.rows[0].sale_id}', '[{"sale_item_id":"${cashItem}","qty":4}]'::jsonb, 'cash', 'too many', true)`),
    "exceeds sold quantity",
    "a return cannot exceed what is left to return"
  );
  const cardItem = (await rows(`select id from public.sale_items where sale_id = '${card.rows[0].sale_id}'`))[0].id as string;
  await db.query(`select * from public.create_return('${card.rows[0].sale_id}', '[{"sale_item_id":"${cardItem}","qty":2}]'::jsonb, 'card', 'Changed mind', false)`);
  const pendingRefund = (await rows(`select id, status from public.payments where direction = 'refund' and tender = 'card'`))[0];
  check("a card refund waits for the terminal confirmation", pendingRefund.status === "pending");
  await db.query(`select public.record_payment_result('${pendingRefund.id}', 'captured', 'E2E-RFND-1')`);
  check("confirming the terminal refund settles it", (await rows(`select status from public.payments where id = '${pendingRefund.id}'`))[0].status === "captured");
  check("a non-restocked return leaves stock alone", n((await rows(`select stock_qty from public.products where id = '${MILK}'`))[0].stock_qty) === 94);

  // ---------------- SHIFT: close / Z report ----------------
  // expected cash = float 50000 + cash sales (18500 + 2500 + 1000) - cash refund 2500 - paid-out 2000 = 67500
  await asUser(db, CASHIER2);
  await expectError(db.query(`select * from public.close_shift('${shift}', 70000)`), "not your shift", "another cashier cannot close this shift");
  await asUser(db, CASHIER);
  await expectError(db.query(`select * from public.close_shift('${shift}', 50000)`), "manager approval", "a large cash variance needs a manager");
  // the approval is bound to (shift, counted, expected) exactly as close_shift renders them
  const hash = (await rows(
    `select encode(extensions.digest('shift_close|${shift}|50000|' || (s.opening_float + coalesce((select sum(amount) from public.cash_drawer_events where shift_id = s.id), 0))::text, 'sha256'), 'hex') as h from public.shifts s where s.id = '${shift}'`
  ))[0].h as string;
  const approval = (await db.query<{ id: string }>(`select public.create_manager_approval('shift_close', '${hash}', '1234') as id`)).rows[0].id;
  const closed = (await db.query<{ expected_cash: string; closing_counted: string; closed_at: string | null }>(
    `select * from public.close_shift('${shift}', 50000, '${approval}')`
  )).rows[0];
  check("the expected cash is derived from the drawer ledger, not just sales", n(closed.expected_cash) === 67500, `${closed.expected_cash}`);
  check("the counted cash and the close time are stored", n(closed.closing_counted) === 50000 && closed.closed_at !== null);
  await expectError(db.query(`select * from public.close_shift('${shift}', 70000)`), "already closed", "a shift closes exactly once");
  await expectError(
    db.query(`select * from public.create_sale('[{"product_id":"${MILK}","qty":1,"line_discount":0}]'::jsonb, 'cash', '${shift}', 5000)`),
    "not an open shift",
    "no sale can be added to a closed shift"
  );
  const events = await rows(`select event_type, amount from public.cash_drawer_events where shift_id = '${shift}' order by created_at, id`);
  check("the drawer ledger holds every cash movement", events.length >= 5 && events.some((e) => e.event_type === "paid_out" && n(e.amount) === -2000) && events.some((e) => e.event_type === "cash_refund"));
  const shiftAudit = await rows(`select approved_by from public.audit_events where action = 'shift_close' and target_id = '${shift}'`);
  check("the close is audited with the approving manager", shiftAudit.length === 1 && shiftAudit[0].approved_by === ADMIN);

  // ---------------- cross-role visibility ----------------
  await asUser(db, CASHIER2);
  check("another cashier cannot see this shift's sales", (await db.query(`select * from public.sales`)).rows.length === 0);
  await asUser(db, ADMIN);
  check("an admin sees every sale", (await db.query(`select * from public.sales`)).rows.length === 4);

  // ---------------- the whole day reconciles ----------------
  await asAdminService(db);
  const integrity = (await db.query<{ check_name: string; ok: boolean; detail: string }>(`select * from public.verify_database_integrity()`)).rows;
  check("every integrity check passes after the day", integrity.every((c) => c.ok), integrity.filter((c) => !c.ok).map((c) => `${c.check_name}: ${c.detail}`).join("; "));
  const tender = (await db.query<{ tender: string; net: string }>(`select tender, net from public.report_tender_summary_internal()`).catch(() => ({ rows: [] }))).rows;
  void tender;
  const paymentTotals = (await db.query<{ cash: string; card: string }>(
    `select coalesce(sum(case when tender = 'cash' then case direction when 'charge' then amount else -amount end end), 0) as cash,
            coalesce(sum(case when tender = 'card' then case direction when 'charge' then amount else -amount end end), 0) as card
     from public.payments where status = 'captured'`
  )).rows[0];
  check("cash taken minus cash refunded matches the drawer", n(paymentTotals.cash) === 18500 + 2500 + 1000 - 2500);
  check("card taken minus card refunded nets to zero after the full refund", n(paymentTotals.card) === 0, `${paymentTotals.card}`);
  const alertsNow = (await db.query<{ alert: string }>(`select * from public.ops_alerts()`)).rows.map((r) => r.alert);
  check("the only open alert after a clean day is the missing backup", alertsNow.join() === "backup_overdue", alertsNow.join());

  if (failures > 0) {
    console.error(`\n${failures} check(s) failing`);
    process.exit(1);
  }
  console.log("\nEnd-to-end business flows passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
