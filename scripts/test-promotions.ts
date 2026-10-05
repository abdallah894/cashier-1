import { asAdminService, asUser, createTestDb, seedUser } from "./lib/pglite-db";
import { computeTotals, toCartItem, toSaleItems } from "../lib/store/cart";
import type { Tables } from "../lib/supabase/database.types";

const ADMIN = "00000000-0000-0000-0000-00000000000a";
const CASHIER = "00000000-0000-0000-0000-00000000000b";
const CAT = "00000000-0000-0000-0000-0000000000c1";
const P1 = "00000000-0000-0000-0000-000000000101"; // 10.00, 0% VAT, cat
const P2 = "00000000-0000-0000-0000-000000000102"; // 20.00, 14% VAT, no cat
const P3 = "00000000-0000-0000-0000-000000000103"; // 50.00 kg, 0% VAT

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
  await db.query(`select public.set_pin('${ADMIN}', '1234')`);
  await db.query(`insert into public.categories (id, name_ar, name_en) values ('${CAT}', 'ف', 'Cat')`);
  await db.query(`insert into public.products (id, barcode, name_ar, name_en, price, cost, tax_rate, stock_qty, unit, category_id) values
    ('${P1}', 'p-1', 'أ', 'P1', 1000, 500, 0, 100, 'piece', '${CAT}'),
    ('${P2}', 'p-2', 'ب', 'P2', 2000, 900, 0.14, 100, 'piece', null),
    ('${P3}', 'p-3', 'ج', 'P3', 5000, 3000, 0, 100, 'kg', null)`);
  const { rows: shifts } = await db.query<{ id: string }>(
    `insert into public.shifts (cashier_id, opening_float) values ('${CASHIER}', 0) returning id`
  );
  const shiftId = shifts[0].id;

  const promo = async (args: string) => {
    await asUser(db, ADMIN);
    const { rows } = await db.query<{ id: string }>(`select public.create_promotion(${args}) as id`);
    return rows[0].id;
  };
  const evalLines = (lines: string, customerId = "null", codes = "null") =>
    db.query<{ line_idx: number; promotion_id: string; discount: string }>(
      `select * from public.evaluate_promotions('${lines}'::jsonb, ${customerId}, ${codes}) order by line_idx, promotion_id`
    );
  const line = (product: string, qty: number, discount = 0) => ({ product_id: product, qty, line_discount: discount });
  const lines = (...entries: ReturnType<typeof line>[]) => JSON.stringify(entries);
  const byLine = (rows: { line_idx: number; discount: string }[]) => {
    const out: Record<number, number> = {};
    for (const row of rows) out[row.line_idx] = (out[row.line_idx] ?? 0) + n(row.discount);
    return out;
  };

  // ---- only admins define promotions; terms are validated ----
  await asUser(db, CASHIER);
  await expectError(
    db.query(`select public.create_promotion('{"name_en":"X","name_ar":"س","scope":"order","discount_kind":"percent","percent_bp":1000}'::jsonb)`),
    "admin only",
    "a cashier cannot create a promotion"
  );
  await asUser(db, ADMIN);
  await expectError(
    db.query(`select public.create_promotion('{"name_en":"Bad","name_ar":"س","scope":"order","discount_kind":"percent","percent_bp":0}'::jsonb)`),
    "percent",
    "a percent promotion needs a positive rate"
  );
  await expectError(
    db.query(`select public.create_promotion('{"name_en":"Bad","name_ar":"س","scope":"order","discount_kind":"fixed"}'::jsonb)`),
    "fixed amount",
    "a fixed promotion needs an amount"
  );
  await expectError(
    db.query(`select public.create_promotion('{"name_en":"Bad","name_ar":"س","scope":"order","discount_kind":"percent","percent_bp":1000,"starts_at":"2030-01-02T00:00:00Z","ends_at":"2030-01-01T00:00:00Z"}'::jsonb)`),
    "end must be after",
    "the window must be ordered"
  );

  // ---- automatic item promotion: category percent ----
  const catPromo = await promo(`'{"name_en":"Cat 10%","name_ar":"خصم","scope":"items","discount_kind":"percent","percent_bp":1000,"category_id":"${CAT}","priority":10}'::jsonb`);
  let r = await evalLines(lines(line(P1, 2), line(P2, 1)));
  check("an automatic promotion applies to eligible lines only", r.rows.length === 1 && r.rows[0].line_idx === 0 && n(r.rows[0].discount) === 200 && r.rows[0].promotion_id === catPromo);

  // ---- manual discounts apply first; promotions never push a line below zero ----
  r = await evalLines(lines(line(P1, 1, 900)));
  check("promotions apply to the amount left after a manual discount", n(r.rows[0].discount) === 10, `${r.rows[0]?.discount}`);

  // ---- expiry / window / active ----
  const expired = await promo(`'{"name_en":"Old","name_ar":"س","scope":"items","discount_kind":"percent","percent_bp":5000,"product_ids":["${P2}"],"starts_at":"2020-01-01T00:00:00Z","ends_at":"2020-02-01T00:00:00Z"}'::jsonb`);
  const future = await promo(`'{"name_en":"Soon","name_ar":"س","scope":"items","discount_kind":"percent","percent_bp":5000,"product_ids":["${P2}"],"starts_at":"2999-01-01T00:00:00Z"}'::jsonb`);
  r = await evalLines(lines(line(P2, 1)));
  check("expired and not-yet-started promotions do not apply", r.rows.length === 0);
  void expired;
  void future;

  // ---- coupon codes ----
  await promo(`'{"name_en":"Code","name_ar":"كود","scope":"items","discount_kind":"fixed","fixed_amount":300,"product_ids":["${P2}"],"code":"SAVE3","priority":20}'::jsonb`);
  r = await evalLines(lines(line(P2, 2)));
  check("a coupon promotion needs its code", r.rows.length === 0);
  r = await evalLines(lines(line(P2, 2)), "null", `array[' save3 ']`);
  check("a code matches case-insensitively; fixed is per unit", r.rows.length === 1 && n(r.rows[0].discount) === 600, `${r.rows[0]?.discount}`);
  await expectError(evalLines(lines(line(P2, 1)), "null", `array['NOPE']`), "promotion code not valid", "an unknown code is rejected, not ignored");
  await asUser(db, ADMIN);
  await expectError(
    db.query(`select public.create_promotion('{"name_en":"Dup","name_ar":"س","scope":"order","discount_kind":"percent","percent_bp":100,"code":"save3"}'::jsonb)`),
    "already exists",
    "codes are unique"
  );

  // ---- minimum spend, customer requirement ----
  await promo(`'{"name_en":"Big basket","name_ar":"س","scope":"order","discount_kind":"fixed","fixed_amount":500,"min_spend":10000,"code":"BIG","priority":30}'::jsonb`);
  await expectError(evalLines(lines(line(P3, 1)), "null", `array['BIG']`), "minimum spend", "a coupon below its minimum spend is explained");
  r = await evalLines(lines(line(P3, 2)), "null", `array['BIG']`); // 10000 gross
  check("a coupon at its minimum spend applies", n(r.rows[0].discount) === 500);

  await promo(`'{"name_en":"Members","name_ar":"س","scope":"order","discount_kind":"percent","percent_bp":500,"customer_required":true,"code":"MEMBER","priority":40}'::jsonb`);
  await expectError(evalLines(lines(line(P3, 1)), "null", `array['MEMBER']`), "needs a customer", "a member promotion needs a customer");

  // ---- stacking and exclusivity ----
  await asAdminService(db);
  await db.query(`update public.promotions set active = false where code is null or code in ('SAVE3', 'BIG', 'MEMBER')`);
  await asUser(db, ADMIN);
  const a = await promo(`'{"name_en":"A 10%","name_ar":"س","scope":"items","discount_kind":"percent","percent_bp":1000,"product_ids":["${P3}"],"stackable":true,"priority":1}'::jsonb`);
  const b = await promo(`'{"name_en":"B 10%","name_ar":"س","scope":"items","discount_kind":"percent","percent_bp":1000,"product_ids":["${P3}"],"stackable":true,"priority":2}'::jsonb`);
  r = await evalLines(lines(line(P3, 2))); // 10000
  check("stackable promotions compound on the remaining amount", n(byLine(r.rows)[0]) === 1900, `${JSON.stringify(byLine(r.rows))}`);
  check("each applied promotion is reported separately", r.rows.length === 2 && r.rows.some((row) => row.promotion_id === a) && r.rows.some((row) => row.promotion_id === b));
  const exclusive = await promo(`'{"name_en":"Exclusive 30%","name_ar":"س","scope":"items","discount_kind":"percent","percent_bp":3000,"product_ids":["${P3}"],"stackable":false,"priority":3}'::jsonb`);
  r = await evalLines(lines(line(P3, 2)));
  check("an exclusive promotion skips lines that already have a promotion", r.rows.length === 2 && r.rows.every((row) => row.promotion_id !== exclusive));
  await asAdminService(db);
  await db.query(`update public.promotions set active = false where id in ('${a}', '${b}')`);
  r = await evalLines(lines(line(P3, 2)));
  check("an exclusive promotion applies on its own", r.rows.length === 1 && n(r.rows[0].discount) === 3000);
  await db.query(`update public.promotions set active = false where id = '${exclusive}'`);

  // ---- order-level discount allocation is exact ----
  await asAdminService(db);
  await db.query(`update public.promotions set active = false`);
  const order = await promo(`'{"name_en":"Order 7%","name_ar":"س","scope":"order","discount_kind":"percent","percent_bp":700,"priority":5}'::jsonb`);
  r = await evalLines(lines(line(P1, 3), line(P2, 1), line(P3, 1)));
  const allocated = Object.values(byLine(r.rows)).reduce((sum, value) => sum + value, 0);
  // gross = 3000 + 2000 + 5000 = 10000 -> 7% = 700
  check("an order promotion allocates its exact total across lines", allocated === 700 && r.rows.length === 3, `${allocated}`);
  void order;

  // ---- redemption limits ----
  await asAdminService(db);
  await db.query(`update public.promotions set active = false`);
  const limited = await promo(`'{"name_en":"Limited","name_ar":"س","scope":"order","discount_kind":"fixed","fixed_amount":100,"max_redemptions":1,"code":"ONCE","priority":1}'::jsonb`);
  void limited;
  await asUser(db, CASHIER);
  const sell = (items: string, extra: string) =>
    db.query<{ sale_id: string; sale_number: string; total: string; discount_total: string }>(
      `select * from public.create_sale('${items}'::jsonb, 'cash', '${shiftId}', 50000, null, null, null, null, ${extra})`
    );
  const first = await sell(lines(line(P1, 1)), `null, array['ONCE']`);
  check("a redeemed promotion reduces the sale total", n(first.rows[0].total) === 900 && n(first.rows[0].discount_total) === 100, `${first.rows[0].total}`);
  await expectError(sell(lines(line(P1, 1)), `null, array['ONCE']`), "limit", "a redemption limit stops further use");

  await asAdminService(db);
  const items = await db.query<{ line_discount: string }>(`select line_discount from public.sale_items`);
  check("the promotion discount is snapshotted on the sale item", n(items.rows[0].line_discount) === 100);
  const snap = await db.query<{ name_en: string; code: string; discount: string; promotion_id: string }>(
    `select name_en, code, discount, promotion_id from public.sale_item_promotions`
  );
  check("the applied promotion is snapshotted with its name and code", snap.rows.length === 1 && snap.rows[0].name_en === "Limited" && snap.rows[0].code === "ONCE" && n(snap.rows[0].discount) === 100);
  const redemptions = await db.query<{ count: string }>(`select count(*) from public.promotion_redemptions`);
  check("a redemption is recorded", n(redemptions.rows[0].count) === 1);
  const applied = await db.query<{ count: string }>(`select count(*) from public.audit_events where action = 'promotion_applied'`);
  check("promotion use emits one audit event per sale", n(applied.rows[0].count) === 1);
  await expectError(db.query(`update public.sale_item_promotions set discount = 0`), "immutable", "applied promotions cannot be edited");
  await expectError(db.query(`delete from public.promotion_redemptions`), "immutable", "redemptions cannot be deleted");

  // editing history: deactivating the promotion leaves the sale untouched
  await db.query(`update public.promotions set name_en = 'Renamed' where id = '${limited}'`).catch(() => undefined);
  const stillSnap = await db.query<{ name_en: string }>(`select name_en from public.sale_item_promotions`);
  check("renaming a promotion does not rewrite history", stillSnap.rows[0].name_en === "Limited");

  // ---- per-customer limit ----
  await asUser(db, CASHIER);
  const { rows: cust } = await db.query<{ id: string }>(`select public.create_customer('Repeat', '01000000002') as id`);
  await asUser(db, ADMIN);
  await promo(`'{"name_en":"Per customer","name_ar":"س","scope":"order","discount_kind":"fixed","fixed_amount":100,"max_per_customer":1,"customer_required":true,"code":"PERCUST","priority":2}'::jsonb`);
  await asUser(db, CASHIER);
  await sell(lines(line(P1, 1)), `'${cust[0].id}'::uuid, array['PERCUST']`);
  await expectError(sell(lines(line(P1, 1)), `'${cust[0].id}'::uuid, array['PERCUST']`), "limit", "the per-customer limit is enforced");

  // ---- offline sales opt out of promotions; stale totals are caught ----
  await asAdminService(db);
  await db.query(`update public.promotions set active = false`);
  await asUser(db, ADMIN);
  await promo(`'{"name_en":"Auto 10%","name_ar":"س","scope":"items","discount_kind":"percent","percent_bp":1000,"product_ids":["${P3}"],"priority":1}'::jsonb`);
  await asUser(db, CASHIER);
  const offline = await db.query<{ total: string }>(
    `select * from public.create_sale('${lines(line(P3, 1))}'::jsonb, 'cash', '${shiftId}', 50000, null, null, null, null, null, null, false)`
  );
  check("a sale can opt out of automatic promotions (offline queue)", n(offline.rows[0].total) === 5000);
  await expectError(
    db.query(`select * from public.create_sale('${lines(line(P3, 1))}'::jsonb, 'cash', '${shiftId}', 50000, null, null, null, null, null, null, true, 5000)`),
    "total changed",
    "a total that changed since the preview is refused"
  );
  const matched = await db.query<{ total: string }>(
    `select * from public.create_sale('${lines(line(P3, 1))}'::jsonb, 'cash', '${shiftId}', 50000, null, null, null, null, null, null, true, 4500)`
  );
  check("a matching expected total goes through", n(matched.rows[0].total) === 4500);

  // ---- promotions never trigger the manager-approval rule for manual discounts ----
  await asAdminService(db);
  await db.query(`update public.promotions set active = false`);
  await asUser(db, ADMIN);
  await promo(`'{"name_en":"Huge","name_ar":"س","scope":"items","discount_kind":"percent","percent_bp":5000,"product_ids":["${P1}"],"priority":1}'::jsonb`);
  await asUser(db, CASHIER);
  const huge = await sell(lines(line(P1, 2)), `null, null`);
  check("a 50% promotion needs no manager approval", n(huge.rows[0].total) === 1000);

  // ---- client/server parity ----
  await asAdminService(db);
  await db.query(`update public.promotions set active = false`);
  await asUser(db, ADMIN);
  await promo(`'{"name_en":"Parity","name_ar":"س","scope":"order","discount_kind":"percent","percent_bp":700,"priority":1}'::jsonb`);
  const product = (id: string, price: number, rate: number, unit: "piece" | "kg") =>
    ({ id, barcode: id.slice(-3), name_ar: "x", name_en: "x", price, tax_rate: rate, stock_qty: 100, unit }) as Tables<"products">;
  const cart = [
    { ...toCartItem(product(P1, 1000, 0, "piece")), qty: 3, discount: null },
    { ...toCartItem(product(P2, 2000, 0.14, "piece")), qty: 1, discount: null },
    { ...toCartItem(product(P3, 5000, 0, "kg")), qty: 1.5, discount: null },
  ];
  const plain = computeTotals(cart, null);
  await asUser(db, CASHIER);
  const preview = await evalLines(JSON.stringify(toSaleItems(plain)));
  const promoByLine = plain.lines.map((_, index) => byLine(preview.rows)[index] ?? 0);
  const withPromo = computeTotals(cart, null, promoByLine);
  const real = await sell(JSON.stringify(toSaleItems(plain)), `null, null`);
  check("the client total with promotions equals the server total", n(real.rows[0].total) === withPromo.total, `${real.rows[0].total} vs ${withPromo.total}`);
  await asAdminService(db);
  const tax = await db.query<{ tax_total: string; subtotal: string }>(`select tax_total, subtotal from public.sales order by sale_number desc limit 1`);
  check("client VAT and net match the server after promotions", n(tax.rows[0].tax_total) === withPromo.taxTotal && n(tax.rows[0].subtotal) === withPromo.subtotal, `${tax.rows[0].tax_total}/${tax.rows[0].subtotal} vs ${withPromo.taxTotal}/${withPromo.subtotal}`);

  await asUser(db, CASHIER);
  const named = await db.query<{ name_en: string; discount: string }>(`select * from public.preview_promotions('${JSON.stringify(toSaleItems(plain))}'::jsonb, null, null)`);
  check("the register preview names each applied promotion", named.rows.length === 3 && named.rows.every((row) => row.name_en === "Parity"));

  if (failures > 0) {
    console.error(`\n${failures} check(s) failing`);
    process.exit(1);
  }
  console.log("\nPromotion tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
