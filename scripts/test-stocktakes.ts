import { asAdminService, asUser, createTestDb, seedUser } from "./lib/pglite-db";

const ADMIN = "00000000-0000-0000-0000-00000000000a";
const COUNTER = "00000000-0000-0000-0000-00000000000b"; // cashier with stock.correct
const CASHIER = "00000000-0000-0000-0000-00000000000c"; // no capability
const CAT1 = "00000000-0000-0000-0000-0000000000c1";
const CAT2 = "00000000-0000-0000-0000-0000000000c2";
const A = "00000000-0000-0000-0000-000000000101"; // piece, 10
const B = "00000000-0000-0000-0000-000000000102"; // kg, 5.500
const C = "00000000-0000-0000-0000-000000000103"; // piece, 3 (other category)

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
  await seedUser(db, COUNTER, "counter", "cashier");
  await seedUser(db, CASHIER, "cashier", "cashier");
  await db.query(`insert into public.categories (id, name_ar, name_en) values
    ('${CAT1}', 'ف1', 'Cat1'), ('${CAT2}', 'ف2', 'Cat2')`);
  await db.query(`insert into public.products (id, barcode, name_ar, name_en, price, cost, tax_rate, stock_qty, unit, category_id) values
    ('${A}', 'a-1', 'أ', 'A', 1000, 600, 0, 10, 'piece', '${CAT1}'),
    ('${B}', 'b-1', 'ب', 'B', 5000, 3000, 0, 5.5, 'kg', '${CAT1}'),
    ('${C}', 'c-1', 'ج', 'C', 2000, 1000, 0, 3, 'piece', '${CAT2}')`);
  await db.query(`insert into public.staff_capabilities (staff_id, capability, granted_by)
    values ('${COUNTER}', 'stock.correct', '${ADMIN}')`);

  const stock = async (id: string) => {
    await asAdminService(db);
    const { rows } = await db.query<{ stock_qty: string }>(`select stock_qty from public.products where id = '${id}'`);
    return Number(rows[0].stock_qty);
  };

  // ---- permissions ----
  await asUser(db, CASHIER);
  await expectError(
    db.query(`select public.create_stocktake('full')`),
    "capability required",
    "cashier without the capability cannot start a count"
  );
  const { rows: hidden } = await db.query(`select * from public.stocktakes`);
  check("cashier without the capability sees no counts", hidden.length === 0);

  // ---- scope + frozen expected quantity ----
  await asUser(db, COUNTER);
  const { rows: cycle } = await db.query<{ id: string }>(
    `select public.create_stocktake('cycle', '${CAT1}') as id`
  );
  const cycleId = cycle[0].id;
  const { rows: scoped } = await db.query<{ product_id: string; expected_qty: string }>(
    `select product_id, expected_qty from public.stocktake_items where stocktake_id = '${cycleId}' order by barcode`
  );
  check("cycle count covers only the category", scoped.length === 2 && scoped.every((r) => r.product_id !== C));
  await expectError(db.query(`select public.create_stocktake('cycle')`), "cycle count needs", "cycle count needs a scope");

  // stock moves after the freeze (a sale)
  await asAdminService(db);
  await db.query(`update public.products set stock_qty = 8 where id = '${A}'`);
  await db.query(`insert into public.stock_movements (product_id, qty_change, reason, note) values ('${A}', -2, 'sale', 'after freeze')`);
  await asUser(db, COUNTER);
  const { rows: frozen } = await db.query<{ expected_qty: string }>(
    `select expected_qty from public.stocktake_items where stocktake_id = '${cycleId}' and product_id = '${A}'`
  );
  check("expected quantity stays frozen at creation", Number(frozen[0].expected_qty) === 10);

  // ---- entry validation ----
  await expectError(
    db.query(`select public.record_stocktake_counts('${cycleId}', '[{"product_id":"${A}","counted_qty":2.5}]'::jsonb)`),
    "whole number",
    "piece items need whole counts"
  );
  await expectError(
    db.query(`select public.record_stocktake_counts('${cycleId}', '[{"product_id":"${A}","counted_qty":-1}]'::jsonb)`),
    "cannot be negative",
    "negative counts are rejected"
  );
  await expectError(
    db.query(`select public.record_stocktake_counts('${cycleId}', '[{"product_id":"${C}","counted_qty":1}]'::jsonb)`),
    "not part of this count",
    "products outside the scope are rejected"
  );
  await expectError(
    db.query(`select public.record_stocktake_counts('${cycleId}', '[{"product_id":"${B}","counted_qty":1.2345}]'::jsonb)`),
    "three decimal",
    "more than three decimals are rejected"
  );

  // ---- entry never changes stock; pause / resume ----
  await db.query(`select public.record_stocktake_counts('${cycleId}', '[{"product_id":"${A}","counted_qty":7,"reason":"damaged on shelf"}]'::jsonb)`);
  check("entering a count does not change stock", (await stock(A)) === 8);
  await asUser(db, COUNTER);
  const { rows: resumed } = await db.query<{ counted_qty: string | null }>(
    `select counted_qty from public.stocktake_items where stocktake_id = '${cycleId}' and product_id = '${A}'`
  );
  check("a paused count resumes with its entries", Number(resumed[0].counted_qty) === 7);
  await db.query(`select public.record_stocktake_counts('${cycleId}', '[{"product_id":"${A}","counted_qty":9,"reason":"recount"}]'::jsonb)`);
  const { rows: edited } = await db.query<{ counted_qty: string }>(
    `select counted_qty from public.stocktake_items where stocktake_id = '${cycleId}' and product_id = '${A}'`
  );
  check("entries can be corrected while open", Number(edited[0].counted_qty) === 9);

  // ---- submission rules ----
  await db.query(`select public.record_stocktake_counts('${cycleId}', '[{"product_id":"${B}","counted_qty":5.25}]'::jsonb)`);
  await expectError(db.query(`select public.submit_stocktake('${cycleId}')`), "reason is required", "a variance needs a reason");
  await db.query(`select public.record_stocktake_counts('${cycleId}', '[{"product_id":"${B}","counted_qty":5.25,"reason":"trimming loss"}]'::jsonb)`);
  await db.query(`select public.submit_stocktake('${cycleId}')`);
  await expectError(
    db.query(`select public.record_stocktake_counts('${cycleId}', '[{"product_id":"${A}","counted_qty":1}]'::jsonb)`),
    "not open",
    "a submitted count is locked for entry"
  );

  // ---- approval is the only thing that changes stock ----
  await expectError(db.query(`select public.approve_stocktake('${cycleId}')`), "admin only", "the counter cannot approve their own count");
  await asUser(db, ADMIN);
  const { rows: conflicts } = await db.query<{ product_id: string; expected_qty: string; current_qty: string }>(
    `select * from public.stocktake_conflicts('${cycleId}')`
  );
  check("a concurrent movement is surfaced as a conflict", conflicts.length === 1 && conflicts[0].product_id === A);
  check("the conflict shows frozen and current quantity", Number(conflicts[0].expected_qty) === 10 && Number(conflicts[0].current_qty) === 8);
  await expectError(db.query(`select public.approve_stocktake('${cycleId}')`), "unresolved conflicts", "approval is blocked until conflicts are resolved");
  check("a blocked approval changes nothing", (await stock(A)) === 8 && (await stock(B)) === 5.5);
  await asUser(db, ADMIN);
  await expectError(
    db.query(`select public.approve_stocktake('${cycleId}', '{"${A}":"guess"}'::jsonb)`),
    "invalid resolution",
    "only known resolutions are accepted"
  );
  await db.query(`select public.approve_stocktake('${cycleId}', '{"${A}":"use_count"}'::jsonb)`);
  check("use_count sets stock to the counted quantity", (await stock(A)) === 9);
  check("kg stock keeps decimals", (await stock(B)) === 5.25);
  check("products outside the count are untouched", (await stock(C)) === 3);

  await asAdminService(db);
  const { rows: moves } = await db.query<{ product_id: string; qty_change: string; reference_id: string }>(
    `select product_id, qty_change, reference_id from public.stock_movements where reference_id = '${cycleId}' order by qty_change`
  );
  check("approval writes one movement per adjusted product", moves.length === 2);
  check("movements are linked to the stocktake", moves.every((m) => m.reference_id === cycleId));
  check("movement quantities are the applied deltas", Number(moves[0].qty_change) === -0.25 && Number(moves[1].qty_change) === 1);
  const { rows: audits } = await db.query<{ count: string }>(
    `select count(*) from public.audit_events where action = 'stocktake_approved' and target_id = '${cycleId}'`
  );
  check("approval emits exactly one audit event", Number(audits[0].count) === 1);

  // ---- terminal state ----
  await asUser(db, ADMIN);
  await expectError(db.query(`select public.approve_stocktake('${cycleId}')`), "not submitted", "an approved count cannot be approved twice");
  await asAdminService(db);
  await expectError(
    db.query(`update public.stocktake_items set counted_qty = 0 where stocktake_id = '${cycleId}'`),
    "immutable",
    "approved counts are immutable"
  );
  await expectError(db.query(`delete from public.stocktakes`), "immutable", "counts cannot be deleted");

  // ---- variance report ----
  await asUser(db, ADMIN);
  const { rows: report } = await db.query<{ barcode: string; variance_qty: string; variance_value: string; conflict: boolean }>(
    `select * from public.stocktake_variance_report('${cycleId}') order by barcode`
  );
  check("report lists every counted line", report.length === 2);
  check("report variance is counted minus frozen expected", Number(report[0].variance_qty) === -1 && Number(report[1].variance_qty) === -0.25);
  check("report values variance at the frozen cost", Number(report[0].variance_value) === -600 && Number(report[1].variance_value) === -750);

  // ---- full count: keep_current, no conflict path, uncounted lines ----
  await asUser(db, COUNTER);
  const { rows: full } = await db.query<{ id: string }>(`select public.create_stocktake('full', null, null, 'Annual') as id`);
  const fullId = full[0].id;
  const { rows: fullItems } = await db.query(`select * from public.stocktake_items where stocktake_id = '${fullId}'`);
  check("a full count covers every active product", fullItems.length === 3);
  await db.query(`select public.record_stocktake_counts('${fullId}', '[{"product_id":"${C}","counted_qty":3}]'::jsonb)`);
  await db.query(`select public.submit_stocktake('${fullId}')`);
  await asUser(db, ADMIN);
  await db.query(`select public.approve_stocktake('${fullId}')`);
  check("matching counts and uncounted lines change nothing", (await stock(A)) === 9 && (await stock(B)) === 5.25 && (await stock(C)) === 3);

  // ---- recount + keep_current + cancel ----
  await asUser(db, COUNTER);
  const { rows: second } = await db.query<{ id: string }>(`select public.create_stocktake('cycle', null, array['${A}']::uuid[]) as id`);
  const secondId = second[0].id;
  await db.query(`select public.record_stocktake_counts('${secondId}', '[{"product_id":"${A}","counted_qty":4,"reason":"short"}]'::jsonb)`);
  await db.query(`select public.submit_stocktake('${secondId}')`);
  await asUser(db, ADMIN);
  await db.query(`select public.reopen_stocktake('${secondId}')`);
  await asUser(db, COUNTER);
  await db.query(`select public.record_stocktake_counts('${secondId}', '[{"product_id":"${A}","counted_qty":9,"reason":"recounted, was fine"}]'::jsonb)`);
  await db.query(`select public.submit_stocktake('${secondId}')`);
  await asAdminService(db);
  await db.query(`update public.products set stock_qty = 12 where id = '${A}'`); // concurrent receipt
  await asUser(db, ADMIN);
  await db.query(`select public.approve_stocktake('${secondId}', '{"${A}":"keep_current"}'::jsonb)`);
  check("keep_current leaves stock alone", (await stock(A)) === 12);
  await asAdminService(db);
  const { rows: kept } = await db.query<{ resolution: string; applied_delta: string }>(
    `select resolution, applied_delta from public.stocktake_items where stocktake_id = '${secondId}'`
  );
  check("the resolution is recorded on the line", kept[0].resolution === "keep_current" && Number(kept[0].applied_delta) === 0);

  await asUser(db, COUNTER);
  const { rows: third } = await db.query<{ id: string }>(`select public.create_stocktake('full') as id`);
  await db.query(`select public.cancel_stocktake('${third[0].id}')`);
  await expectError(db.query(`select public.submit_stocktake('${third[0].id}')`), "not open", "a cancelled count cannot be submitted");

  // ---- RLS: counts are only readable with the capability ----
  await asUser(db, CASHIER);
  const { rows: items } = await db.query(`select * from public.stocktake_items`);
  check("cashier without the capability cannot read count lines", items.length === 0);
  await expectError(
    db.query(`insert into public.stocktakes (scope, created_by) values ('full', '${CASHIER}')`),
    "row-level security",
    "counts cannot be written around the RPCs"
  );

  if (failures > 0) {
    console.error(`\n${failures} check(s) failing`);
    process.exit(1);
  }
  console.log("\nStocktake tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
