import { asAdminService, asUser, createTestDb, seedUser } from "./lib/pglite-db";

const ADMIN = "00000000-0000-0000-0000-00000000000a";
const CASHIER = "00000000-0000-0000-0000-00000000000b";
const A = "00000000-0000-0000-0000-000000000101"; // 114.00 gross, 14% VAT, cost 60.00
const B = "00000000-0000-0000-0000-000000000102"; // 50.00, 0% VAT
const C = "00000000-0000-0000-0000-000000000103"; // never sold
const D = "00000000-0000-0000-0000-000000000104"; // last sold long ago
const R = "00000000-0000-0000-0000-000000000105"; // reorder candidate
const SUP = "00000000-0000-0000-0000-0000000000a1";

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
const day = (value: unknown) => (value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10));

async function main() {
  const db = await createTestDb();
  await seedUser(db, ADMIN, "admin", "admin");
  await seedUser(db, CASHIER, "cashier", "cashier");
  await db.query(`select public.set_pin('${ADMIN}', '1234')`);
  await db.query(`insert into public.categories (id, name_ar, name_en) values ('00000000-0000-0000-0000-0000000000c1', 'ف', 'Cat')`);
  await db.query(`insert into public.products (id, barcode, name_ar, name_en, price, cost, tax_rate, stock_qty, low_stock_threshold, unit, category_id) values
    ('${A}', 'o-a', 'أ', 'A', 11400, 6000, 0.14, 100, 5, 'piece', '00000000-0000-0000-0000-0000000000c1'),
    ('${B}', 'o-b', 'ب', 'B', 5000, 3000, 0, 100, 5, 'piece', null),
    ('${C}', 'o-c', 'ج', 'C', 2000, 1000, 0, 40, 5, 'piece', null),
    ('${D}', 'o-d', 'د', 'D', 2000, 1000, 0, 10, 5, 'piece', null),
    ('${R}', 'o-r', 'ر', 'R', 1000, 500, 0, 40, 5, 'piece', null)`);
  await db.query(`insert into public.suppliers (id, name) values ('${SUP}', 'Acme')`);
  await db.query(`insert into public.staff_capabilities (staff_id, capability, granted_by) values ('${CASHIER}', 'cart.void', '${ADMIN}')`);
  const { rows: shiftRows } = await db.query<{ id: string }>(
    `insert into public.shifts (cashier_id, opening_float, opened_at) values ('${CASHIER}', 0, '2026-07-10T08:00:00Z') returning id`
  );
  const shiftId = shiftRows[0].id;

  const rows = async (sql: string, params: unknown[] = []) => {
    const who = (await db.query<{ sub: string | null; u: string }>(`select current_setting('request.jwt.claim.sub', true) as sub, current_user as u`)).rows[0];
    await asAdminService(db);
    const out = (await db.query(sql, params)).rows as Record<string, unknown>[];
    if (who.u === "authenticated" && who.sub) await asUser(db, who.sub);
    return out;
  };

  // ---- store timezone and the Cairo business day ----
  await asUser(db, ADMIN);
  const tz = await db.query<{ tz: string }>(`select public.store_tz() as tz`);
  check("the store timezone defaults to Africa/Cairo", tz.rows[0].tz === "Africa/Cairo");
  const bd = async (ts: string) => day((await db.query<{ d: unknown }>(`select public.business_day('${ts}'::timestamptz) as d`)).rows[0].d);
  check("23:30 Cairo summer time is still the same business day", (await bd("2026-07-10T20:30:00Z")) === "2026-07-10");
  check("00:30 Cairo summer time is the next business day", (await bd("2026-07-10T21:30:00Z")) === "2026-07-11");
  check("winter time uses UTC+2: 22:30Z is already the next day", (await bd("2026-01-10T22:30:00Z")) === "2026-01-11");
  check("winter time: 21:30Z is still the same day", (await bd("2026-01-10T21:30:00Z")) === "2026-01-10");

  const range = async (d: string) =>
    (await db.query<{ range_start: Date; range_end: Date }>(`select * from public.business_day_range('${d}', '${d}')`)).rows[0];
  const hours = async (d: string) => {
    const r = await range(d);
    return Math.round((r.range_end.getTime() + 1 / 1000 - r.range_start.getTime()) / 3_600_000);
  };
  check("an ordinary day is 24 hours", (await hours("2026-07-10")) === 24);
  check("the DST start day (2026-04-24) is 23 hours", (await hours("2026-04-24")) === 23);
  check("the DST end day (2026-10-29) is 25 hours", (await hours("2026-10-29")) === 25);
  const gaps = await db.query<{ bad: string }>(
    `select count(*) as bad from generate_series('2026-01-01'::date, '2026-12-30'::date, interval '1 day') g(d)
     where (select range_end from public.business_day_range(g.d::date, g.d::date)) + interval '1 microsecond'
        <> (select range_start from public.business_day_range(g.d::date + 1, g.d::date + 1))`
  );
  check("business days tile the year with no gap or overlap across both DST changes", n(gaps.rows[0].bad) === 0);
  const wholeYear = await db.query<{ ok: boolean }>(
    `select bool_and(public.business_day(r.range_start) = g.d::date and public.business_day(r.range_end) = g.d::date) as ok
     from generate_series('2026-01-01'::date, '2026-12-31'::date, interval '1 day') g(d),
     lateral public.business_day_range(g.d::date, g.d::date) r`
  );
  check("the first and last instant of every day map back to that day", wholeYear.rows[0].ok === true);

  await asUser(db, CASHIER);
  await expectError(db.query(`select public.update_store_settings('{"business_day_cutoff_minutes":240}'::jsonb)`), "admin only", "a cashier cannot change store settings");
  await asUser(db, ADMIN);
  await expectError(db.query(`select public.update_store_settings('{"timezone":"Mars/Base"}'::jsonb)`), "unknown timezone", "an invalid timezone is refused");
  await db.query(`select public.update_store_settings('{"business_day_cutoff_minutes":240}'::jsonb)`);
  check("a 04:00 cutoff keeps late-night sales on the previous day", (await bd("2026-07-10T00:59:00Z")) === "2026-07-09" && (await bd("2026-07-10T01:00:00Z")) === "2026-07-10");
  await db.query(`select public.update_store_settings('{"business_day_cutoff_minutes":0}'::jsonb)`);
  const settingAudits = await rows(`select count(*) as c from public.audit_events where action = 'store_settings_changed'`);
  check("each settings change emits an audit event", n(settingAudits[0].c) === 2);

  // Phase 0: the store identity printed on receipts lives in store_settings.
  const blankStore = await rows(`select store_name_en, tax_registration_number from public.store_settings`);
  check("a fresh database prints no demo store identity", blankStore[0].store_name_en === "" && blankStore[0].tax_registration_number === "");
  await db.query(`select public.update_store_settings('{"store_name_en":"  Green Market ","tax_registration_number":"555-111-222","phone":"0102 000 0000"}'::jsonb)`);
  const savedStore = await rows(`select store_name_en, tax_registration_number, phone, store_name_ar from public.store_settings`);
  check("store identity is saved trimmed and other fields untouched", savedStore[0].store_name_en === "Green Market" && savedStore[0].tax_registration_number === "555-111-222" && savedStore[0].phone === "0102 000 0000" && savedStore[0].store_name_ar === "");
  await expectError(db.query(`select public.update_store_settings('{"phone":"${"9".repeat(41)}"}'::jsonb)`), "store_settings_phone_check", "an over-long phone number is refused");
  // Phase 1: scale-label layout + product PLU codes.
  const defaults = await rows(`select weighed_barcode_enabled, weighed_prefix_min, weighed_prefix_max, weighed_item_code_length, weighed_value_kind from public.store_settings`);
  check("scale labels are off by default with the common layout", defaults[0].weighed_barcode_enabled === false && n(defaults[0].weighed_prefix_min) === 20 && n(defaults[0].weighed_prefix_max) === 29 && n(defaults[0].weighed_item_code_length) === 5 && defaults[0].weighed_value_kind === "weight_grams");
  await db.query(`select public.update_store_settings('{"weighed_barcode_enabled":true,"weighed_prefix_min":21,"weighed_prefix_max":23,"weighed_item_code_length":6,"weighed_value_kind":"price_piasters"}'::jsonb)`);
  const layout = await rows(`select weighed_barcode_enabled, weighed_prefix_min, weighed_item_code_length, weighed_value_kind from public.store_settings`);
  check("the admin can set the label layout", layout[0].weighed_barcode_enabled === true && n(layout[0].weighed_prefix_min) === 21 && n(layout[0].weighed_item_code_length) === 6 && layout[0].weighed_value_kind === "price_piasters");
  await expectError(db.query(`select public.update_store_settings('{"weighed_prefix_min":30}'::jsonb)`), "weighed_prefix_min_check", "a prefix outside 20-29 is refused");
  await expectError(db.query(`select public.update_store_settings('{"weighed_prefix_min":25,"weighed_prefix_max":22}'::jsonb)`), "store_settings_weighed_prefix_order", "a reversed prefix range is refused");
  await expectError(db.query(`select public.update_store_settings('{"weighed_value_kind":"volume"}'::jsonb)`), "weighed_value_kind_check", "an unknown label value kind is refused");
  await db.query(`insert into public.products (barcode, name_ar, name_en, price, unit, plu_code) values ('plu-1', 'طماطم', 'Tomatoes', 2500, 'kg', '123')`);
  await expectError(db.query(`insert into public.products (barcode, name_ar, name_en, price, unit, plu_code) values ('plu-2', 'خيار', 'Cucumber', 2000, 'kg', '123')`), "products_plu_code_key", "two products cannot share a PLU");
  await expectError(db.query(`insert into public.products (barcode, name_ar, name_en, price, unit, plu_code) values ('plu-3', 'جزر', 'Carrots', 1500, 'kg', '0123')`), "products_plu_code_check", "a PLU with a leading zero is refused");
  await expectError(db.query(`insert into public.products (barcode, name_ar, name_en, price, unit, plu_code) values ('plu-4', 'بصل', 'Onion', 1500, 'kg', '1234567')`), "products_plu_code_check", "a PLU longer than 6 digits is refused");
  await db.query(`insert into public.products (barcode, name_ar, name_en, price, unit) values ('plu-5', 'أ', 'A', 1, 'piece'), ('plu-6', 'ب', 'B', 1, 'piece')`);
  check("many products may have no PLU", n((await rows(`select count(*) as c from public.products where plu_code is null and barcode in ('plu-5','plu-6')`))[0].c) === 2);
  await asUser(db, CASHIER);
  const cashierSees = await rows(`select store_name_en from public.store_settings`);
  check("any signed-in staff can read the store identity for receipts", cashierSees[0].store_name_en === "Green Market");
  await asUser(db, ADMIN);

  // ---- data: sales on both sides of Cairo midnight ----
  await asUser(db, CASHIER);
  const sell = (items: string, method: string, tendered: string, ref: string) =>
    db.query<{ sale_id: string }>(
      `select * from public.create_sale('${items}'::jsonb, '${method}', '${shiftId}', ${tendered}, null, null, null, null, null, null, true, null, null, ${ref})`
    );
  const s1 = await sell(`[{"product_id":"${A}","qty":2,"line_discount":0}]`, "cash", "50000", "null");
  const s2 = await sell(`[{"product_id":"${B}","qty":1,"line_discount":0}]`, "card", "null", "'OPS-APPR-1'");
  const s3 = await sell(`[{"product_id":"${A}","qty":1,"line_discount":1000}]`, "cash", "50000", "null");
  const s1Item = (await rows(`select id from public.sale_items where sale_id = '${s1.rows[0].sale_id}'`))[0].id as string;
  await db.query(`select * from public.create_return('${s1.rows[0].sale_id}', '[{"sale_item_id":"${s1Item}","qty":1}]'::jsonb, 'cash', 'damaged on arrival', true)`);
  await db.query(`select public.record_cart_void(3, 4500, null)`);

  // receive stock on 2026-07-11 so purchase VAT shows up
  await asUser(db, ADMIN);
  const po = (await db.query<{ id: string }>(`select public.create_purchase_order('${SUP}', '[{"product_id":"${A}","ordered_qty":10,"unit_cost":6000,"tax_rate":0.14}]'::jsonb) as id`)).rows[0].id;
  await db.query(`select public.place_purchase_order('${po}')`);
  const poLine = (await rows(`select id from public.purchase_order_lines where po_id = '${po}'`))[0].id as string;
  await db.query(`select public.receive_purchase_order('${po}', '[{"po_line_id":"${poLine}","qty":10}]'::jsonb, 'INV-OPS')`);

  // move every fact to a known instant (the ledgers are immutable; replica mode is the test-only escape hatch)
  const T = { s1: "2026-07-10T20:30:00Z", s2: "2026-07-10T21:30:00Z", s3: "2026-07-11T10:00:00Z", ret: "2026-07-11T09:00:00Z", rec: "2026-07-11T07:00:00Z", voidAt: "2026-07-10T22:30:00Z" };
  await asAdminService(db);
  await db.exec(`set session_replication_role = replica`);
  const at = (table: string, id: string, ts: string, col = "created_at") => db.query(`update public.${table} set ${col} = '${ts}' where id = '${id}'`);
  await at("sales", s1.rows[0].sale_id, T.s1);
  await at("sales", s2.rows[0].sale_id, T.s2);
  await at("sales", s3.rows[0].sale_id, T.s3);
  const retId = (await db.query<{ id: string }>(`select id from public.returns`)).rows[0].id;
  await at("returns", retId, T.ret);
  await at("goods_receipts", (await db.query<{ id: string }>(`select id from public.goods_receipts`)).rows[0].id, T.rec, "received_at");
  await db.query(`update public.payments p set created_at = s.created_at from public.sales s where p.sale_id = s.id`);
  await db.query(`update public.payments p set created_at = r.created_at from public.returns r where p.return_id = r.id`);
  await db.query(`update public.stock_movements m set created_at = s.created_at from public.sales s where m.reference_id = s.id`);
  await db.query(`update public.stock_movements m set created_at = r.created_at from public.returns r where m.reference_id = r.id`);
  await db.query(`update public.stock_movements m set created_at = g.received_at from public.goods_receipts g where m.reference_id = g.id`);
  await db.query(`update public.audit_events set created_at = '${T.voidAt}' where action = 'cart_void'`);
  await db.exec(`set session_replication_role = origin`);

  // ---- daily summary on Cairo business days ----
  await asUser(db, ADMIN);
  const { rows: summary } = await db.query<Record<string, unknown>>(`select * from public.report_daily_summary('2026-07-10', '2026-07-11') order by day`);
  const d10 = summary.find((r) => day(r.day) === "2026-07-10")!;
  const d11 = summary.find((r) => day(r.day) === "2026-07-11")!;
  check("a sale at 23:30 Cairo belongs to its own business day", n(d10.sale_count) === 1 && n(d10.gross_sales) === 22800);
  check("a sale at 00:30 Cairo belongs to the next business day", n(d11.sale_count) === 2 && n(d11.gross_sales) === 15400);
  check("net-of-VAT and VAT are explicit and add to gross", n(d10.net_sales_ex_vat) === 20000 && n(d10.vat_on_sales) === 2800 && n(d10.net_sales_ex_vat) + n(d10.vat_on_sales) === n(d10.gross_sales));
  check("manual discounts are reported", n(d11.discount_total) === 1000 && n(d11.promo_discount) === 0);
  check("refunds are reported separately from sales", n(d11.refund_count) === 1 && n(d11.refunds_gross) === 11400 && n(d10.refunds_gross) === 0);
  check("net after refunds is gross minus refunds", n(d11.net_after_refunds_gross) === 15400 - 11400);
  check("cash and card are netted per day", n(d10.cash_net) === 22800 && n(d11.cash_net) === 10400 - 11400 && n(d11.card_net) === 5000);
  check("cart voids are counted with their value", n(d11.void_count) === 1 && n(d11.void_value) === 4500 && n(d10.void_count) === 0);

  // ---- VAT report ----
  const { rows: vat } = await db.query<Record<string, unknown>>(`select * from public.report_vat('2026-07-10', '2026-07-11') order by rate_bp`);
  const v14 = vat.find((r) => n(r.rate_bp) === 1400)!;
  const v0 = vat.find((r) => n(r.rate_bp) === 0)!;
  check("VAT output is split by rate with gross, net and tax", n(v14.gross_sales) === 33200 && n(v14.net_sales) === 29123 && n(v14.vat_sales) === 4077);
  check("refunds reduce VAT at the original rate", n(v14.refund_gross) === 11400 && n(v14.refund_net) === 10000 && n(v14.refund_vat) === 1400 && n(v14.net_vat) === 4077 - 1400);
  check("a zero-rated line carries no VAT", n(v0.gross_sales) === 5000 && n(v0.vat_sales) === 0);
  check("purchase (input) VAT is shown from receipts", n(v14.input_vat_purchases) === 8400);

  // ---- refunds and voids detail ----
  const { rows: refunds } = await db.query<Record<string, unknown>>(`select * from public.report_refunds_detail('2026-07-10', '2026-07-11')`);
  check("the refund list shows tender, reason and restock", refunds.length === 1 && refunds[0].tender === "cash" && refunds[0].reason === "damaged on arrival" && refunds[0].restock === true && n(refunds[0].sale_number) > 0);
  const { rows: voids } = await db.query<Record<string, unknown>>(`select * from public.report_voids_detail('2026-07-10', '2026-07-11')`);
  check("the void list names the cashier and the value", voids.length === 1 && voids[0].actor_name === "cashier" && n(voids[0].amount) === 4500 && n(voids[0].item_count) === 3);

  // ---- stock movements, valuation, aging ----
  const { rows: movement } = await db.query<Record<string, unknown>>(`select * from public.report_stock_movements('2026-07-10', '2026-07-11') where product_id = '${A}'`);
  check("movements show received, sold and returned stock", n(movement[0].received_qty) === 10 && n(movement[0].sold_qty) === 3 && n(movement[0].returned_qty) === 1);
  check("opening + received - sold + returned = closing", n(movement[0].opening_qty) + 10 - 3 + 1 === n(movement[0].closing_qty) && n(movement[0].opening_qty) === 100);

  const { rows: valuation } = await db.query<Record<string, unknown>>(`select * from public.report_stock_valuation()`);
  const valA = valuation.find((r) => r.product_id === A)!;
  check("valuation is quantity times the moving-average cost", n(valA.qty) === 108 && n(valA.unit_cost) === 6000 && n(valA.value_at_cost) === 108 * 6000);
  check("retail value is stated both gross and net of VAT", n(valA.retail_value_gross) === 108 * 11400 && n(valA.retail_value_net) === Math.round((108 * 11400) / 1.14));

  await asAdminService(db);
  await db.query(`insert into public.stock_movements (product_id, qty_change, reason, created_at, note) values ('${D}', -1, 'sale', '2026-03-01T10:00:00Z', 'ancient sale')`);
  await asUser(db, ADMIN);
  const { rows: aging } = await db.query<Record<string, unknown>>(`select * from public.report_stock_aging('2026-07-12')`);
  const ageOf = (id: string) => aging.find((r) => r.product_id === id)!;
  check("recently sold stock is in the 0-30 day bucket", ageOf(A).bucket === "0-30" && n(ageOf(A).days_since_last_sale) === 1);
  check("stock not sold for months is in the 90+ bucket", ageOf(D).bucket === "90+" && n(ageOf(D).days_since_last_sale) >= 120);
  check("stock that never sold is flagged separately", ageOf(C).bucket === "never_sold" && ageOf(C).last_sold_at === null);

  // ---- permissions: every report is admin-only ----
  await asUser(db, CASHIER);
  const guarded = [
    `select * from public.report_daily_summary('2026-07-10', '2026-07-11')`,
    `select * from public.report_vat('2026-07-10', '2026-07-11')`,
    `select * from public.report_refunds_detail('2026-07-10', '2026-07-11')`,
    `select * from public.report_voids_detail('2026-07-10', '2026-07-11')`,
    `select * from public.report_stock_movements('2026-07-10', '2026-07-11')`,
    `select * from public.report_stock_valuation()`,
    `select * from public.report_stock_aging('2026-07-12')`,
    `select * from public.report_reorder_suggestions()`,
  ];
  for (const sql of guarded) {
    await expectError(db.query(sql), "admin only", `a cashier is refused: ${sql.slice(21, sql.indexOf("("))}`);
  }

  // ---- closing the business day ----
  await expectError(db.query(`select public.close_business_day('2026-07-10')`), "admin only", "a cashier cannot close a business day");
  await asUser(db, ADMIN);
  await expectError(db.query(`select public.close_business_day(public.business_day(now())::date)`), "has not ended", "today cannot be closed");
  await expectError(db.query(`select public.close_business_day('2026-07-10')`), "shifts are still open", "a day with an open shift cannot be closed");
  await asAdminService(db);
  await db.query(`update public.shifts set closed_at = '2026-07-11T18:00:00Z', closing_counted = 0, expected_cash = 0 where id = '${shiftId}'`);
  await asUser(db, ADMIN);
  await db.query(`select public.close_business_day('2026-07-10')`);
  const closed = await rows(`select * from public.business_days where day = '2026-07-10'`);
  check("a closed day stores an immutable snapshot", closed.length === 1 && n(closed[0].gross_sales) === 22800 && n(closed[0].sale_count) === 1 && n(closed[0].net_sales_ex_vat) === 20000);
  await expectError(db.query(`select public.close_business_day('2026-07-10')`), "already closed", "a day is closed once");
  await asAdminService(db);
  await expectError(db.query(`update public.business_days set gross_sales = 1`), "immutable", "a closed day cannot be edited");
  await expectError(db.query(`delete from public.business_days`), "immutable", "a closed day cannot be deleted");
  const closeAudit = await db.query<{ c: string }>(`select count(*) as c from public.audit_events where action = 'business_day_closed'`);
  check("closing a day emits one audit event", n(closeAudit.rows[0].c) === 1);
  await asUser(db, ADMIN);
  const { rows: afterClose } = await db.query<Record<string, unknown>>(`select closed from public.report_daily_summary('2026-07-10', '2026-07-11') order by day`);
  check("the daily summary shows which days are closed", afterClose[0].closed === true && afterClose[1].closed === false);

  // ---- low-stock alerts ----
  await asAdminService(db);
  await db.query(`update public.products set stock_qty = 6 where id = '${R}'`);
  const { rows: nowShift } = await db.query<{ id: string }>(`insert into public.shifts (cashier_id, opening_float) values ('${CASHIER}', 0) returning id`);
  const shiftNow = nowShift[0].id;
  await asUser(db, CASHIER);
  const sellR = (qty: number) =>
    db.query(`select * from public.create_sale('[{"product_id":"${R}","qty":${qty},"line_discount":0}]'::jsonb, 'cash', '${shiftNow}', 50000)`);
  await sellR(2); // 6 -> 4, crossing the threshold of 5
  const alerts = await rows(`select status, stock_qty_at_alert, threshold from public.reorder_alerts where product_id = '${R}'`);
  check("falling to the threshold opens one alert", alerts.length === 1 && alerts[0].status === "open" && n(alerts[0].stock_qty_at_alert) <= 5 && n(alerts[0].threshold) === 5);
  await sellR(1);
  check("further sales do not duplicate the alert", n((await rows(`select count(*) as c from public.reorder_alerts where product_id = '${R}'`))[0].c) === 1);
  const alertId = (await rows(`select id from public.reorder_alerts where product_id = '${R}'`))[0].id as string;
  await expectError(db.query(`select public.handle_reorder_alert('${alertId}', 'acknowledge', null, null)`), "capability required", "a cashier cannot handle alerts");
  await asAdminService(db);
  await db.query(`insert into public.staff_capabilities (staff_id, capability, granted_by) values ('${CASHIER}', 'stock.correct', '${ADMIN}')`);
  await asUser(db, CASHIER);
  await db.query(`select public.handle_reorder_alert('${alertId}', 'acknowledge', null, null)`);
  check("stock staff can acknowledge an alert", (await rows(`select status from public.reorder_alerts where id = '${alertId}'`))[0].status === "acknowledged");
  await expectError(db.query(`select public.handle_reorder_alert('${alertId}', 'dismiss', ' ', null)`), "note is required", "dismissing needs a note");

  // ---- reorder suggestions explain their inputs ----
  await asAdminService(db);
  await db.query(`insert into public.stock_movements (product_id, qty_change, reason, created_at, note) values ('${R}', -28, 'sale', now() - interval '10 days', 'history')`);
  await asUser(db, ADMIN);
  await db.query(`select public.set_product_supplier('{"product_id":"${R}","supplier_id":"${SUP}","is_preferred":true,"lead_time_days":5,"pack_size":6,"min_order_qty":12,"unit_cost":500}'::jsonb)`);
  const { rows: sug } = await db.query<Record<string, unknown>>(`select * from public.report_reorder_suggestions() where product_id = '${R}'`);
  const s = sug[0];
  check("a low product with demand history is suggested", sug.length === 1);
  check("the suggestion shows its inputs", n(s.stock_qty) === 3 && n(s.low_stock_threshold) === 5 && n(s.lookback_days) === 28 && n(s.lead_time_days) === 5 && n(s.cover_days) === 14 && n(s.pack_size) === 6);
  check("average daily demand comes from net sales in the lookback", Math.abs(n(s.avg_daily_sales) - (28 + 3) / 28) < 0.01, `${s.avg_daily_sales}`);
  check("the quantity follows the stated formula and pack size", n(s.suggested_qty) % 6 === 0 && n(s.suggested_qty) >= 12, `${s.suggested_qty}`);
  check("the preferred supplier and cost are attached", s.supplier_name === "Acme" && n(s.unit_cost) === 500);
  check("an explanation spells out the numbers", typeof s.explanation === "string" && (s.explanation as string).includes("5 days") && (s.explanation as string).includes("14") && (s.explanation as string).includes(String(n(s.suggested_qty))));
  const poR = (await db.query<{ id: string }>(`select public.create_purchase_order('${SUP}', '[{"product_id":"${R}","ordered_qty":12,"unit_cost":500}]'::jsonb) as id`)).rows[0].id;
  await db.query(`select public.place_purchase_order('${poR}')`);
  const { rows: sug2 } = await db.query<Record<string, unknown>>(`select * from public.report_reorder_suggestions() where product_id = '${R}'`);
  check("stock already on order reduces the suggestion", n(sug2[0].on_order_qty) === 12 && n(sug2[0].suggested_qty) < n(s.suggested_qty));

  // ---- the alert clears itself once stock recovers ----
  await asAdminService(db);
  await db.query(`update public.products set stock_qty = 50 where id = '${R}'`);
  check("an alert resolves when stock is back above the threshold", (await rows(`select status from public.reorder_alerts where id = '${alertId}'`))[0].status === "resolved");

  if (failures > 0) {
    console.error(`\n${failures} check(s) failing`);
    process.exit(1);
  }
  console.log("\nOperational report tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
