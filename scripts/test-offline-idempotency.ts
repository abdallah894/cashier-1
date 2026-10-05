import { asAdminService, asUser, createTestDb, seedUser } from "./lib/pglite-db";

const CASHIER = "00000000-0000-0000-0000-00000000000b";
const OTHER = "00000000-0000-0000-0000-00000000000c";
const PRODUCT = "00000000-0000-0000-0000-000000000101";
const KEY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const KEY2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

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
  await seedUser(db, CASHIER, "cashier", "cashier");
  await seedUser(db, OTHER, "other", "cashier");
  await db.query(`insert into public.products (id, barcode, name_ar, name_en, price, tax_rate, stock_qty, unit)
    values ('${PRODUCT}', 'off-100', 'منتج', 'Product', 1000, 0, 5, 'piece')`);
  const { rows: shifts } = await db.query<{ id: string }>(
    `insert into public.shifts (cashier_id, opening_float) values ('${CASHIER}', 0) returning id`
  );
  const shiftId = shifts[0].id;
  await db.query(`insert into public.shifts (cashier_id, opening_float) values ('${OTHER}', 0)`);

  await asUser(db, CASHIER);
  const sell = (key: string, qty = 1, soldAt = "null") =>
    db.query<{ sale_id: string; sale_number: string }>(
      `select * from public.create_sale(
        '[{"product_id":"${PRODUCT}","qty":${qty},"line_discount":0}]'::jsonb,
        'cash', '${shiftId}', 5000, null, null, '${key}'::uuid, ${soldAt})`
    );

  const first = await sell(KEY);
  const replay = await sell(KEY);
  check("replaying a key returns the same sale", first.rows[0].sale_id === replay.rows[0].sale_id);
  check("replaying a key returns the same sale number", first.rows[0].sale_number === replay.rows[0].sale_number);

  await asAdminService(db);
  const { rows: counts } = await db.query<{ sales: string; stock: string; movements: string; drawer: string }>(
    `select (select count(*) from public.sales) as sales,
            (select stock_qty from public.products where id = '${PRODUCT}') as stock,
            (select count(*) from public.stock_movements where reason = 'sale') as movements,
            (select count(*) from public.cash_drawer_events where event_type = 'cash_sale') as drawer`
  );
  check("a replayed key creates one sale", Number(counts[0].sales) === 1);
  check("a replayed key decrements stock once", Number(counts[0].stock) === 4);
  check("a replayed key logs one stock movement", Number(counts[0].movements) === 1);
  check("a replayed key records one drawer event", Number(counts[0].drawer) === 1);

  await asUser(db, CASHIER);
  const second = await sell(KEY2);
  check("a new key creates a new sale", second.rows[0].sale_id !== first.rows[0].sale_id);
  check("sale numbers stay gapless across replays", Number(second.rows[0].sale_number) === Number(first.rows[0].sale_number) + 1);

  await asUser(db, OTHER);
  await expectError(
    db.query(`select * from public.create_sale(
      '[{"product_id":"${PRODUCT}","qty":1,"line_discount":0}]'::jsonb,
      'cash', null, 5000, null, null, '${KEY}'::uuid, null)`),
    "idempotency key belongs to another cashier",
    "another cashier cannot replay a key"
  );

  // stale offline stock: the server stays authoritative and rejects without side effects
  await asUser(db, CASHIER);
  await expectError(sell("cccccccc-cccc-4ccc-8ccc-cccccccccccc", 99), "insufficient stock", "stale stock is rejected");
  await asAdminService(db);
  const { rows: afterReject } = await db.query<{ sales: string }>(`select count(*) as sales from public.sales`);
  check("a rejected sync leaves no sale behind", Number(afterReject[0].sales) === 2);
  await asUser(db, CASHIER);
  const retry = await sell("cccccccc-cccc-4ccc-8ccc-cccccccccccc", 1);
  check("the same key can be retried after a rejection", retry.rows.length === 1);

  // the time the cashier actually rang the sale is kept, but bounded
  const soldAt = new Date(Date.now() - 3600_000).toISOString();
  const stamped = await sell("dddddddd-dddd-4ddd-8ddd-dddddddddddd", 1, `'${soldAt}'::timestamptz`);
  await asAdminService(db);
  const { rows: stampedRows } = await db.query<{ client_sold_at: string }>(
    `select client_sold_at::text from public.sales where id = '${stamped.rows[0].sale_id}'`
  );
  check("client sale time is stored", stampedRows[0].client_sold_at !== null);
  await asUser(db, CASHIER);
  await expectError(
    sell("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", 1, `'${new Date(Date.now() + 3600_000).toISOString()}'::timestamptz`),
    "sold_at",
    "a future client sale time is rejected"
  );

  if (failures > 0) {
    console.error(`\n${failures} check(s) failing`);
    process.exit(1);
  }
  console.log("\nOffline idempotency tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
