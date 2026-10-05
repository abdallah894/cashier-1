import { asAdminService, asUser, createTestDb, seedUser } from "./lib/pglite-db";

const ADMIN = "00000000-0000-0000-0000-00000000000a";
const STOCKIST = "00000000-0000-0000-0000-00000000000b"; // cashier + stock.correct
const CASHIER = "00000000-0000-0000-0000-00000000000c";
const SUPPLIER = "00000000-0000-0000-0000-0000000000a1";
const P1 = "00000000-0000-0000-0000-000000000101"; // piece, cost 600, stock 10
const P2 = "00000000-0000-0000-0000-000000000102"; // kg, cost 3000, stock 5
const FROM = "2000-01-01T00:00:00Z";
const TO = "2100-01-01T00:00:00Z";
const K1 = "11111111-1111-4111-8111-111111111111";
const K2 = "22222222-2222-4222-8222-222222222222";
const K3 = "33333333-3333-4333-8333-333333333333";

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
  await seedUser(db, STOCKIST, "stockist", "cashier");
  await seedUser(db, CASHIER, "cashier", "cashier");
  await db.query(`insert into public.staff_capabilities (staff_id, capability, granted_by) values ('${STOCKIST}', 'stock.correct', '${ADMIN}')`);
  await db.query(`insert into public.products (id, barcode, name_ar, name_en, price, cost, tax_rate, stock_qty, unit) values
    ('${P1}', 'p-1', 'أ', 'P1', 1140, 600, 0.14, 10, 'piece'),
    ('${P2}', 'p-2', 'ب', 'P2', 5000, 3000, 0, 5, 'kg')`);
  await db.query(`insert into public.suppliers (id, name, phone) values ('${SUPPLIER}', 'Acme Foods', '0100')`);

  // Reads as the service role, then restores whichever user the test was acting as.
  const read = async (sql: string) => {
    const who = (await db.query<{ sub: string | null; u: string }>(`select current_setting('request.jwt.claim.sub', true) as sub, current_user as u`)).rows[0];
    await asAdminService(db);
    const rows = (await db.query(sql)).rows as Record<string, unknown>[];
    if (who.u === "authenticated" && who.sub) await asUser(db, who.sub);
    return rows;
  };
  const product = async (id: string) => (await read(`select stock_qty, cost from public.products where id = '${id}'`))[0];

  // ---- who may do what ----
  await asUser(db, CASHIER);
  const hiddenSuppliers = (await db.query(`select * from public.suppliers`)).rows.length;
  check("cashier cannot read suppliers", hiddenSuppliers === 0);
  await expectError(
    db.query(`select public.create_purchase_order('${SUPPLIER}', '[{"product_id":"${P1}","ordered_qty":5,"unit_cost":650}]'::jsonb)`),
    "admin only",
    "cashier cannot create a purchase order"
  );
  await asUser(db, STOCKIST);
  await expectError(
    db.query(`select public.create_purchase_order('${SUPPLIER}', '[{"product_id":"${P1}","ordered_qty":5,"unit_cost":650}]'::jsonb)`),
    "admin only",
    "capability holders still cannot create purchase orders"
  );

  // ---- create + place ----
  await asUser(db, ADMIN);
  const { rows: created } = await db.query<{ id: string }>(
    `select public.create_purchase_order('${SUPPLIER}',
      '[{"product_id":"${P1}","ordered_qty":20,"unit_cost":650,"tax_rate":0.14},{"product_id":"${P2}","ordered_qty":10,"unit_cost":3200,"tax_rate":0}]'::jsonb,
      null, 'First order') as id`
  );
  const po = created[0].id;
  const lines = await read(`select id, product_id from public.purchase_order_lines where po_id = '${po}' order by ordered_qty`);
  const line = (productId: string) => lines.find((l) => l.product_id === productId)!.id as string;
  check("a new order is a draft", (await read(`select status from public.purchase_orders where id = '${po}'`))[0].status === "draft");
  await asUser(db, STOCKIST);
  await expectError(
    db.query(`select public.receive_purchase_order('${po}', '[{"po_line_id":"${line(P1)}","qty":1}]'::jsonb, 'INV-0')`),
    "not open for receiving",
    "a draft cannot be received"
  );
  await asUser(db, ADMIN);
  await expectError(
    db.query(`select public.create_purchase_order('${SUPPLIER}', '[{"product_id":"${P1}","ordered_qty":1.5,"unit_cost":650}]'::jsonb)`),
    "whole number",
    "piece lines need whole quantities"
  );
  await db.query(`select public.place_purchase_order('${po}')`);
  check("placing orders the PO", (await read(`select status from public.purchase_orders where id = '${po}'`))[0].status === "ordered");

  // ---- partial receiving: stock once, moving-average cost, derived status ----
  await asUser(db, STOCKIST);
  const receive = (key: string, items: string, invoice = "INV-1") =>
    db.query<{ id: string }>(
      `select public.receive_purchase_order('${po}', '${items}'::jsonb, '${invoice}', null, '${key}'::uuid) as id`
    );
  const first = await receive(K1, `[{"po_line_id":"${line(P1)}","qty":12}]`);
  const p1 = await product(P1);
  check("receiving adds stock", n(p1.stock_qty) === 22);
  check("receiving updates the moving-average cost", n(p1.cost) === 627, `cost ${p1.cost}`);
  check("a partial receipt derives partially_received", (await read(`select status from public.purchase_orders where id = '${po}'`))[0].status === "partially_received");
  const replay = await receive(K1, `[{"po_line_id":"${line(P1)}","qty":12}]`);
  check("replaying a receipt key returns the same receipt", replay.rows[0].id === first.rows[0].id);
  check("replaying a receipt key does not add stock again", n((await product(P1)).stock_qty) === 22);

  const movements = await read(`select qty_change, reason, reference_id from public.stock_movements where reference_id = '${first.rows[0].id}'`);
  check("receiving writes one linked 'received' movement", movements.length === 1 && movements[0].reason === "received" && n(movements[0].qty_change) === 12);
  const receiptRows = await read(`select received_by, invoice_reference from public.goods_receipts where id = '${first.rows[0].id}'`);
  check("receipt records the actor and invoice reference", receiptRows[0].received_by === STOCKIST && receiptRows[0].invoice_reference === "INV-1");

  // ---- over-receipt policy ----
  await expectError(
    db.query(`select public.receive_purchase_order('${po}', '[{"po_line_id":"${line(P1)}","qty":9}]'::jsonb, 'INV-2')`),
    "exceeds the remaining",
    "over-receipt is refused by default"
  );
  await asAdminService(db);
  await db.query(`update public.purchasing_settings set over_receipt_tolerance_pct = 10 where id = true`);
  await asUser(db, STOCKIST);
  await expectError(
    db.query(`select public.receive_purchase_order('${po}', '[{"po_line_id":"${line(P1)}","qty":11}]'::jsonb, 'INV-2')`),
    "exceeds the remaining",
    "over-receipt beyond the tolerance is refused"
  );
  await expectError(
    db.query(`select public.receive_purchase_order('${po}', '[{"po_line_id":"${line(P1)}","qty":0}]'::jsonb, 'INV-2')`),
    "positive",
    "quantity must be positive"
  );
  await expectError(
    db.query(`select public.receive_purchase_order('${po}', '[{"po_line_id":"${line(P1)}","qty":1.5}]'::jsonb, 'INV-2')`),
    "whole number",
    "piece receipts need whole quantities"
  );
  await db.query(`select public.receive_purchase_order('${po}', '[{"po_line_id":"${line(P1)}","qty":10}]'::jsonb, 'INV-2', null, '${K2}'::uuid)`);
  check("over-receipt within the tolerance is accepted", n((await product(P1)).stock_qty) === 32);
  check("one complete line does not complete the order", (await read(`select status from public.purchase_orders where id = '${po}'`))[0].status === "partially_received");

  // actual invoice price differs from the order price; kg decimals
  await db.query(`select public.receive_purchase_order('${po}', '[{"po_line_id":"${line(P2)}","qty":10,"unit_cost":3300}]'::jsonb, 'INV-3', null, '${K3}'::uuid)`);
  const p2 = await product(P2);
  check("kg stock receives decimals", n(p2.stock_qty) === 15);
  check("cost follows the invoice price", n(p2.cost) === 3200, `cost ${p2.cost}`); // (5*3000 + 10*3300)/15 = 3200
  check("all lines complete: status derives to received", (await read(`select status from public.purchase_orders where id = '${po}'`))[0].status === "received");
  await expectError(
    db.query(`select public.receive_purchase_order('${po}', '[{"po_line_id":"${line(P2)}","qty":1}]'::jsonb, 'INV-4')`),
    "not open for receiving",
    "a received order is closed to further receiving"
  );

  // ---- audit + immutability ----
  const audits = await read(`select count(*) as c from public.audit_events where action = 'goods_received'`);
  check("each receipt emits exactly one audit event", n(audits[0].c) === 3);
  const placed = await read(`select count(*) as c from public.audit_events where action = 'purchase_order_placed'`);
  check("placing an order is audited", n(placed[0].c) === 1);
  await asAdminService(db);
  await expectError(db.query(`update public.goods_receipt_lines set qty = 1`), "immutable", "receipt lines cannot be edited");
  await expectError(db.query(`delete from public.goods_receipts`), "immutable", "receipts cannot be deleted");
  await expectError(
    db.query(`update public.purchase_order_lines set unit_cost = 1 where id = '${line(P1)}'`),
    "immutable",
    "ordered cost cannot be rewritten"
  );
  await expectError(
    db.query(`update public.purchase_orders set status = 'ordered' where id = '${po}'`),
    "illegal status",
    "a received order cannot be reopened"
  );

  // ---- cancel / close short ----
  await asUser(db, ADMIN);
  const { rows: second } = await db.query<{ id: string }>(
    `select public.create_purchase_order('${SUPPLIER}', '[{"product_id":"${P1}","ordered_qty":10,"unit_cost":700}]'::jsonb) as id`
  );
  const po2 = second[0].id;
  await asUser(db, ADMIN);
  await db.query(`select public.cancel_purchase_order('${po2}')`);
  check("an untouched draft can be cancelled", (await read(`select status from public.purchase_orders where id = '${po2}'`))[0].status === "cancelled");

  await asUser(db, ADMIN);
  const { rows: third } = await db.query<{ id: string }>(
    `select public.create_purchase_order('${SUPPLIER}', '[{"product_id":"${P1}","ordered_qty":10,"unit_cost":700}]'::jsonb) as id`
  );
  const po3 = third[0].id;
  const line3 = (await read(`select id from public.purchase_order_lines where po_id = '${po3}'`))[0].id as string;
  await asUser(db, ADMIN);
  await db.query(`select public.place_purchase_order('${po3}')`);
  await asUser(db, STOCKIST);
  await db.query(`select public.receive_purchase_order('${po3}', '[{"po_line_id":"${line3}","qty":4}]'::jsonb, 'INV-5')`);
  await asUser(db, ADMIN);
  await expectError(db.query(`select public.cancel_purchase_order('${po3}')`), "already received", "a partly received order cannot be cancelled");

  // outstanding report before closing short
  const { rows: outstanding } = await db.query<{ po_id: string; remaining_qty: string; remaining_value: string }>(
    `select * from public.report_outstanding_purchase_orders()`
  );
  const mine = outstanding.filter((row) => row.po_id === po3);
  check("outstanding report lists the unreceived remainder", mine.length === 1 && n(mine[0].remaining_qty) === 6 && n(mine[0].remaining_value) === 4200);
  check("fully received and cancelled orders are not outstanding", outstanding.every((row) => row.po_id !== po && row.po_id !== po2));
  await db.query(`select public.close_purchase_order('${po3}')`);
  check("closing short ends the order", (await read(`select status from public.purchase_orders where id = '${po3}'`))[0].status === "closed");
  await asUser(db, ADMIN);
  const { rows: afterClose } = await db.query(`select * from public.report_outstanding_purchase_orders()`);
  check("a short-closed order is no longer outstanding", afterClose.length === 0);

  // ---- received cost report ----
  const { rows: cost } = await db.query<{ supplier_name: string; qty: string; cost_total: string; vat_total: string }>(
    `select * from public.report_received_cost($1, $2) order by cost_total desc`,
    [FROM, TO]
  );
  // PO1: 12*650 + 10*650 + 10*3300 = 47300 ; PO3: 4*700 = 2800 ; VAT defaults to each product's rate (14% on P1)
  check("received cost totals per supplier", cost.length === 1 && n(cost[0].cost_total) === 50100, `${cost[0]?.cost_total}`);
  check("received VAT uses each line's tax rate", n(cost[0].vat_total) === Math.round(12 * 650 * 0.14) + Math.round(10 * 650 * 0.14) + Math.round(4 * 700 * 0.14), `${cost[0]?.vat_total}`);
  await asUser(db, CASHIER);
  await expectError(db.query(`select * from public.report_received_cost($1, $2)`, [FROM, TO]), "admin only", "cashier cannot read purchasing reports");

  // ---- historic profit is frozen at sale time ----
  await asAdminService(db);
  const { rows: shift } = await db.query<{ id: string }>(`insert into public.shifts (cashier_id, opening_float) values ('${CASHIER}', 0) returning id`);
  const costAtSale = n((await product(P1)).cost);
  await asUser(db, CASHIER);
  const { rows: sale } = await db.query<{ sale_id: string }>(
    `select * from public.create_sale('[{"product_id":"${P1}","qty":2,"line_discount":0}]'::jsonb, 'cash', '${shift[0].id}', 5000)`
  );
  await asAdminService(db);
  const snapshot = await read(`select unit_cost from public.sale_items where sale_id = '${sale[0].sale_id}'`);
  check("a sale snapshots the unit cost", n(snapshot[0].unit_cost) === costAtSale, `${snapshot[0].unit_cost}`);
  await asUser(db, ADMIN);
  const before = (await db.query<{ cost: string; profit: string }>(`select * from public.report_profit($1, $2)`, [FROM, TO])).rows[0];
  await asAdminService(db);
  await db.query(`update public.products set cost = 99999 where id = '${P1}'`);
  await asUser(db, ADMIN);
  const after = (await db.query<{ cost: string; profit: string }>(`select * from public.report_profit($1, $2)`, [FROM, TO])).rows[0];
  check("editing a product cost does not change historic profit", n(before.cost) === n(after.cost) && n(before.profit) === n(after.profit), `${before.cost} vs ${after.cost}`);
  check("historic cost is the snapshot", n(after.cost) === costAtSale * 2, `${after.cost}`);

  // a restocked return reverses revenue and cost
  await asUser(db, CASHIER);
  const saleItem = (await read(`select id from public.sale_items where sale_id = '${sale[0].sale_id}'`))[0].id as string;
  await asUser(db, CASHIER);
  await db.query(`select * from public.create_return('${sale[0].sale_id}', '[{"sale_item_id":"${saleItem}","qty":1}]'::jsonb, 'cash', 'changed mind', true)`);
  await asUser(db, ADMIN);
  const net = (await db.query<{ net_revenue: string; cost: string }>(`select * from public.report_profit($1, $2)`, [FROM, TO])).rows[0];
  check("a restocked return reverses cost at the snapshot", n(net.cost) === costAtSale, `${net.cost}`);
  check("a return reduces net revenue", n(net.net_revenue) === Math.round(1140 / 1.14), `${net.net_revenue}`);

  if (failures > 0) {
    console.error(`\n${failures} check(s) failing`);
    process.exit(1);
  }
  console.log("\nPurchasing tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
