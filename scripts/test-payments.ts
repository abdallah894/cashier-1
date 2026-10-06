import { asAdminService, asUser, createTestDb, seedUser } from "./lib/pglite-db";

const ADMIN = "00000000-0000-0000-0000-00000000000a";
const CASHIER = "00000000-0000-0000-0000-00000000000b";
const OTHER = "00000000-0000-0000-0000-00000000000c";
const P = "00000000-0000-0000-0000-000000000101"; // price 5000, no VAT
const FROM = "2000-01-01T00:00:00Z";
const TO = "2100-01-01T00:00:00Z";
const key = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

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
  await seedUser(db, OTHER, "other", "cashier");
  await db.query(`insert into public.products (id, barcode, name_ar, name_en, price, cost, tax_rate, stock_qty, unit)
    values ('${P}', 'pay-1', 'منتج', 'Product', 5000, 3000, 0, 1000, 'piece')`);
  const { rows: shifts } = await db.query<{ id: string }>(
    `insert into public.shifts (cashier_id, opening_float) values ('${CASHIER}', 0) returning id`
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
  const sell = (qty: number, method: string, tendered: string, extra: string) =>
    db.query<{ sale_id: string; total: string; change_due: string | null }>(
      `select * from public.create_sale('[{"product_id":"${P}","qty":${qty},"line_discount":0}]'::jsonb, '${method}', '${shiftId}', ${tendered}, null, null, null, null, null, null, true, null, ${extra})`
    );

  // ---- cash sale: one captured cash payment equal to the total (not the tendered amount) ----
  await asUser(db, CASHIER);
  const cash = await sell(1, "cash", "10000", "null, null");
  const cashPay = await read(`select tender, provider, status, amount, direction, sale_id from public.payments where sale_id = '${cash.rows[0].sale_id}'`);
  check("a cash sale records one captured cash payment", cashPay.length === 1 && cashPay[0].tender === "cash" && cashPay[0].provider === "cash" && cashPay[0].status === "captured");
  check("the payment equals the sale total, not the cash handed over", n(cashPay[0].amount) === 5000 && n(cash.rows[0].change_due) === 5000);

  // ---- card sale needs a verifiable reference; card data never enters ----
  await expectError(sell(1, "card", "null", "null, null"), "terminal approval reference", "a card sale without a reference is refused");
  await expectError(sell(1, "card", "null", "null, '4111111111111111'"), "invalid reference", "a card-number-shaped reference is refused");
  await expectError(sell(1, "card", "null", "null, 'x'"), "invalid reference", "a too-short reference is refused");
  const card = await sell(1, "card", "null", "null, 'APPR-1001'");
  const cardPay = await read(`select tender, provider, provider_reference, status, amount from public.payments where sale_id = '${card.rows[0].sale_id}'`);
  check("a card sale records the terminal approval reference", cardPay.length === 1 && cardPay[0].provider === "manual_terminal" && cardPay[0].provider_reference === "APPR-1001" && cardPay[0].status === "captured");
  await expectError(sell(1, "card", "null", "null, 'APPR-1001'"), "reference already used", "an approval reference cannot be reused");

  // ---- explicit lifecycle: begin -> capture, idempotent ----
  const begin = (k: string, amount = 5000, ref = "null") =>
    db.query<{ id: string }>(`select public.begin_payment(${amount}, 'card', 'manual_terminal', '${k}'::uuid, ${ref}) as id`);
  const a = await begin(key(1));
  const again = await begin(key(1));
  check("beginning a payment twice with one key returns the same payment", a.rows[0].id === again.rows[0].id);
  check("replaying a begin key creates one payment only", n((await read(`select count(*) as c from public.payments where idempotency_key = '${key(1)}'`))[0].c) === 1);
  await expectError(begin(key(2), 0), "amount must be positive", "a payment amount must be positive");
  check("a new payment starts pending", (await read(`select status from public.payments where id = '${a.rows[0].id}'`))[0].status === "pending");

  await expectError(
    db.query(`select public.record_payment_result('${a.rows[0].id}', 'captured', null)`),
    "reference is required",
    "capturing a terminal payment needs the approval reference"
  );
  await db.query(`select public.record_payment_result('${a.rows[0].id}', 'captured', 'APPR-2001')`);
  check("staff capture moves the payment to captured", (await read(`select status from public.payments where id = '${a.rows[0].id}'`))[0].status === "captured");
  await expectError(
    db.query(`select public.record_payment_result('${a.rows[0].id}', 'declined', null, 'oops')`),
    "illegal status",
    "a captured payment cannot be declined"
  );
  const events = await read(`select from_status, to_status, source from public.payment_events where payment_id = '${a.rows[0].id}' order by created_at, id`);
  check("every transition is an event", events.length === 2 && events[0].to_status === "pending" && events[1].from_status === "pending" && events[1].to_status === "captured");
  const staffAudit = await read(`select count(*) as c from public.audit_events where action = 'payment_status_changed' and target_id = '${a.rows[0].id}'`);
  check("a staff-driven transition emits an audit event", n(staffAudit[0].c) === 1);
  await asAdminService(db);
  await expectError(db.query(`update public.payments set amount = 1`), "immutable", "a payment amount cannot be edited");
  await expectError(db.query(`delete from public.payments`), "immutable", "payments cannot be deleted");
  await expectError(db.query(`update public.payment_events set note = 'x'`), "immutable", "payment events cannot be edited");
  await asUser(db, CASHIER);

  // ---- linking captured payments to a sale: exact totals only ----
  const linked = await sell(1, "card", "null", `array['${a.rows[0].id}']::uuid[], null`);
  check("a captured payment pays the sale it is linked to", n(linked.rows[0].total) === 5000);
  check("the linked payment now belongs to the sale", (await read(`select sale_id from public.payments where id = '${a.rows[0].id}'`))[0].sale_id === linked.rows[0].sale_id);
  await expectError(sell(1, "card", "null", `array['${a.rows[0].id}']::uuid[], null`), "payment already used", "a payment cannot pay two sales");

  const wrongAmount = await begin(key(3), 4000);
  await db.query(`select public.record_payment_result('${wrongAmount.rows[0].id}', 'captured', 'APPR-3001')`);
  await expectError(sell(1, "card", "null", `array['${wrongAmount.rows[0].id}']::uuid[], null`), "must equal the sale total", "card payments must equal the total exactly");
  const pending = await begin(key(4));
  await expectError(sell(1, "card", "null", `array['${pending.rows[0].id}']::uuid[], null`), "not captured", "a pending payment cannot pay a sale");
  await asUser(db, OTHER);
  await expectError(
    db.query(`select * from public.create_sale('[{"product_id":"${P}","qty":1,"line_discount":0}]'::jsonb, 'card', null, null, null, null, null, null, null, null, true, null, array['${wrongAmount.rows[0].id}']::uuid[], null)`),
    "not yours",
    "someone else's payment cannot be used"
  );
  await asUser(db, CASHIER);

  // ---- split tender: card part + cash remainder ----
  const part = await begin(key(5), 6000);
  await db.query(`select public.record_payment_result('${part.rows[0].id}', 'captured', 'APPR-5001')`);
  await expectError(sell(2, "cash", "3000", `array['${part.rows[0].id}']::uuid[], null`), "less than", "the cash remainder must be covered");
  const split = await sell(2, "cash", "5000", `array['${part.rows[0].id}']::uuid[], null`);
  const splitSale = await read(`select payment_method, total, amount_tendered, change_due from public.sales where id = '${split.rows[0].sale_id}'`);
  check("a split sale is recorded as split", splitSale[0].payment_method === "split" && n(splitSale[0].total) === 10000);
  check("split change is computed on the cash remainder", n(splitSale[0].amount_tendered) === 5000 && n(splitSale[0].change_due) === 1000);
  const splitPays = await read(`select tender, amount from public.payments where sale_id = '${split.rows[0].sale_id}' order by tender`);
  check("split tenders add up to the total exactly", splitPays.length === 2 && splitPays.reduce((s, p) => s + n(p.amount), 0) === 10000 && n(splitPays.find((p) => p.tender === "card")?.amount) === 6000 && n(splitPays.find((p) => p.tender === "cash")?.amount) === 4000);

  // ---- refunds follow the tender actually paid ----
  const soldItem = (await read(`select id from public.sale_items where sale_id = '${split.rows[0].sale_id}'`))[0].id as string;
  const refund = (saleId: string, itemId: string, qty: number, tender: string) =>
    db.query(`select * from public.create_return('${saleId}', '[{"sale_item_id":"${itemId}","qty":${qty}}]'::jsonb, '${tender}', 'customer returned', true)`);
  await asUser(db, CASHIER);
  await expectError(refund(cash.rows[0].sale_id, (await read(`select id from public.sale_items where sale_id = '${cash.rows[0].sale_id}'`))[0].id as string, 1, "card"), "must match the original payment tender", "a refund cannot use a tender the customer did not pay with");
  await refund(split.rows[0].sale_id, soldItem, 1, "card"); // 5000 > ... card paid 6000
  const cardRefund = await read(`select tender, provider, status, amount, direction from public.payments where direction = 'refund' and return_id is not null order by created_at desc limit 1`);
  check("a card refund starts pending until the terminal refund is confirmed", cardRefund[0].status === "pending" && cardRefund[0].provider === "manual_terminal" && n(cardRefund[0].amount) === 5000);
  await expectError(refund(split.rows[0].sale_id, soldItem, 1, "card"), "refund exceeds the original paid amount", "refunds are capped per tender (card paid 6000, 5000 already refunded)");
  const cashItem = (await read(`select id from public.sale_items where sale_id = '${cash.rows[0].sale_id}'`))[0].id as string;
  await refund(cash.rows[0].sale_id, cashItem, 1, "cash");
  const cashRefund = await read(`select status, provider from public.payments where direction = 'refund' and tender = 'cash' limit 1`);
  check("a cash refund is captured immediately", cashRefund[0].status === "captured" && cashRefund[0].provider === "cash");

  // ---- staff-visible recovery: confirm the terminal refund ----
  const refundId = (await read(`select id from public.payments where direction = 'refund' and tender = 'card'`))[0].id as string;
  await db.query(`select public.record_payment_result('${refundId}', 'captured', 'RFND-7001')`);
  check("confirming the terminal refund captures it", (await read(`select status from public.payments where id = '${refundId}'`))[0].status === "captured");

  // ---- provider callbacks: idempotent, amount-checked, ordered ----
  const sandbox = await db.query<{ id: string }>(`select public.begin_payment(5000, 'card', 'sandbox', '${key(6)}'::uuid, 'SBX-1') as id`);
  // Phase 0 (P1-4): staff cannot confirm a gateway payment themselves; only the provider's callback can.
  await expectError(
    db.query(`select public.record_payment_result('${sandbox.rows[0].id}', 'captured', 'SBX-1')`),
    "confirmed by the provider",
    "staff cannot mark a gateway payment captured"
  );
  await asAdminService(db);
  const salesBefore = n((await db.query<{ c: string }>(`select count(*) as c from public.sales`)).rows[0].c);
  const returnsBefore = n((await db.query<{ c: string }>(`select count(*) as c from public.returns`)).rows[0].c);
  const apply = (event: string, ref: string, status: string, amount: number) =>
    db.query<{ r: string }>(`select public.apply_provider_event('sandbox', '${event}', '${ref}', '${status}', ${amount}) as r`);
  check("a provider authorisation is applied", (await apply("evt-1", "SBX-1", "authorized", 5000)).rows[0].r === "applied");
  check("a provider capture is applied", (await apply("evt-2", "SBX-1", "captured", 5000)).rows[0].r === "applied");
  check("a duplicate callback is recognised", (await apply("evt-2", "SBX-1", "captured", 5000)).rows[0].r === "duplicate");
  check("a late stale callback cannot move a captured payment back", (await apply("evt-3", "SBX-1", "authorized", 5000)).rows[0].r === "ignored");
  await expectError(apply("evt-4", "SBX-1", "captured", 4999), "amount mismatch", "a callback with a different amount is refused");
  await expectError(apply("evt-5", "NOPE", "captured", 5000), "unknown payment", "a callback for an unknown payment is refused");
  const sandboxEvents = await db.query<{ c: string }>(`select count(*) as c from public.payment_events where payment_id = '${sandbox.rows[0].id}'`);
  check("each callback is recorded once", n(sandboxEvents.rows[0].c) === 4, `${sandboxEvents.rows[0].c}`); // pending + evt-1 + evt-2 + evt-3 (ignored)
  const salesAfter = n((await db.query<{ c: string }>(`select count(*) as c from public.sales`)).rows[0].c);
  const returnsAfter = n((await db.query<{ c: string }>(`select count(*) as c from public.returns`)).rows[0].c);
  check("provider callbacks never create a sale or a refund", salesBefore === salesAfter && returnsBefore === returnsAfter);
  await asUser(db, CASHIER);
  await expectError(db.query(`select public.apply_provider_event('sandbox', 'evt-9', 'SBX-1', 'voided', 5000)`), "permission denied", "only the service role may apply provider events");

  // ---- failure / recovery states ----
  const doomed = await begin(key(7), 1200);
  await db.query(`select public.record_payment_result('${doomed.rows[0].id}', 'declined', null, 'card declined')`);
  check("a declined payment is recorded with its reason", (await read(`select status, failure_reason from public.payments where id = '${doomed.rows[0].id}'`))[0].failure_reason === "card declined");

  // ---- reconciliation ----
  await asAdminService(db);
  await db.query(`set session_replication_role = replica`);
  const stale = await db.query<{ id: string }>(`insert into public.payments (direction, tender, provider, amount, status, idempotency_key, created_by, created_at) values ('charge', 'card', 'manual_terminal', 900, 'pending', '${key(8)}', '${CASHIER}', now() - interval '2 hours') returning id`);
  await db.query(`set session_replication_role = origin`);
  await asUser(db, ADMIN);
  const { rows: issues } = await db.query<{ issue: string; payment_id: string | null }>(`select issue, payment_id from public.report_payment_reconciliation($1, $2)`, [FROM, TO]);
  const kinds = new Set(issues.map((row) => row.issue));
  check("an unlinked captured payment is reported as an orphan", kinds.has("orphan_payment") && issues.some((row) => row.issue === "orphan_payment" && row.payment_id === wrongAmount.rows[0].id));
  check("a stuck pending payment is reported as stale", issues.some((row) => row.issue === "stale_pending" && row.payment_id === stale.rows[0].id));
  check("a healthy sale is never reported", !kinds.has("sale_mismatch"));
  const { rows: summary } = await db.query<{ tender: string; provider: string; charges: string; refunds: string; net: string }>(`select * from public.report_tender_summary($1, $2) order by tender, provider`, [FROM, TO]);
  const cashRow = summary.find((row) => row.tender === "cash");
  check("the tender summary nets refunds off charges", cashRow !== undefined && n(cashRow.net) === n(cashRow.charges) - n(cashRow.refunds));
  await asUser(db, CASHIER);
  await expectError(db.query(`select * from public.report_payment_reconciliation($1, $2)`, [FROM, TO]), "admin only", "cashiers cannot read reconciliation");

  await asUser(db, ADMIN);
  await expectError(db.query(`select public.resolve_payment('${wrongAmount.rows[0].id}', '  ')`), "note is required", "resolving an orphan needs a note");
  await db.query(`select public.resolve_payment('${wrongAmount.rows[0].id}', 'Customer was refunded on the terminal')`);
  const { rows: afterResolve } = await db.query<{ payment_id: string }>(`select payment_id from public.report_payment_reconciliation($1, $2) where issue = 'orphan_payment'`, [FROM, TO]);
  check("a resolved orphan leaves the report but stays on record", afterResolve.every((row) => row.payment_id !== wrongAmount.rows[0].id) && (await read(`select resolution_note from public.payments where id = '${wrongAmount.rows[0].id}'`))[0].resolution_note !== null);
  await asUser(db, CASHIER);
  await expectError(db.query(`select public.resolve_payment('${wrongAmount.rows[0].id}', 'again')`), "admin only", "only admins resolve payments");

  // ---- RLS ----
  await asUser(db, OTHER);
  check("a cashier sees only their own payments", (await db.query(`select * from public.payments`)).rows.length === 0);
  await asUser(db, CASHIER);
  const own = await db.query<{ created_by: string }>(`select created_by from public.payments`);
  check("a cashier sees their own payments", own.rows.length > 0 && own.rows.every((row) => row.created_by === CASHIER));
  await expectError(db.query(`insert into public.payments (direction, tender, provider, amount, status, idempotency_key, created_by) values ('charge', 'card', 'manual_terminal', 1, 'captured', '${key(99)}', '${CASHIER}')`), "row-level security", "payments cannot be written around the RPCs");
  await asUser(db, ADMIN);
  const adminCount = (await db.query(`select * from public.payments`)).rows.length;
  check("an admin sees every payment", adminCount === n((await read(`select count(*) as c from public.payments`))[0].c));

  // ---- shift tender totals count each tender of a split sale ----
  await asUser(db, CASHIER);
  const totals = await db.query<{ tender: string; amount: string }>(`select * from public.shift_tender_totals('${shiftId}')`);
  const byTender = Object.fromEntries(totals.rows.map((r) => [r.tender, n(r.amount)]));
  check("the shift reports cash and card taken, split sales included", byTender.cash === 5000 + 4000 && byTender.card === 5000 + 5000 + 6000, JSON.stringify(byTender));

  // ---- every historic and new sale reconciles exactly ----
  await asAdminService(db);
  const mismatch = await db.query<{ c: string }>(
    `select count(*) as c from public.sales s where s.total <> (select coalesce(sum(p.amount), 0) from public.payments p where p.sale_id = s.id and p.direction = 'charge' and p.status = 'captured')`
  );
  check("tender totals equal the sale total for every sale", n(mismatch.rows[0].c) === 0);

  if (failures > 0) {
    console.error(`\n${failures} check(s) failing`);
    process.exit(1);
  }
  console.log("\nPayment lifecycle tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
