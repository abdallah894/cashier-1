import { asAdminService, asUser, createTestDb, seedUser } from "./lib/pglite-db";

const ADMIN = "00000000-0000-0000-0000-00000000000a";
const CASHIER = "00000000-0000-0000-0000-00000000000b";
const MANAGER = "00000000-0000-0000-0000-00000000000c"; // cashier + customer.manage
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
const n = (value: unknown) => Number(value);

async function main() {
  const db = await createTestDb();
  await seedUser(db, ADMIN, "admin", "admin");
  await seedUser(db, CASHIER, "cashier", "cashier");
  await seedUser(db, MANAGER, "manager", "cashier");
  await db.query(`insert into public.staff_capabilities (staff_id, capability, granted_by) values ('${MANAGER}', 'customer.manage', '${ADMIN}')`);
  await db.query(`insert into public.products (id, barcode, name_ar, name_en, price, tax_rate, stock_qty, unit)
    values ('${PRODUCT}', 'c-1', 'منتج', 'Product', 1000, 0, 50, 'piece')`);
  const { rows: shifts } = await db.query<{ id: string }>(
    `insert into public.shifts (cashier_id, opening_float) values ('${CASHIER}', 0) returning id`
  );
  const shiftId = shifts[0].id;

  // ---- creating: normalised, unique, consent is opt-in ----
  await asUser(db, CASHIER);
  const { rows: created } = await db.query<{ id: string }>(
    `select public.create_customer('Mona Adel', ' +20 100 123 4567 ') as id`
  );
  const customer = created[0].id;
  await expectError(db.query(`select public.create_customer('Someone', '201001234567')`), "already registered", "a phone number can only be registered once");
  await expectError(db.query(`select public.create_customer('Short', '12')`), "valid phone", "a malformed phone is rejected");
  await expectError(db.query(`select public.create_customer('  ', '01001234999')`), "name is required", "a name is required");

  await asAdminService(db);
  const { rows: stored } = await db.query<{ phone: string; consent_marketing: boolean }>(
    `select phone, consent_marketing from public.customers where id = '${customer}'`
  );
  check("the phone is stored normalised", stored[0].phone === "201001234567", stored[0].phone);
  check("marketing consent is opt-in", stored[0].consent_marketing === false);

  // ---- privacy: cashiers get a minimal lookup, never the table ----
  await asUser(db, CASHIER);
  check("a cashier cannot read the customers table", (await db.query(`select * from public.customers`)).rows.length === 0);
  const { rows: found } = await db.query<Record<string, unknown>>(`select * from public.find_customer('01001234567')`);
  check("a cashier finds a customer by exact phone", found.length === 1 && found[0].id === customer);
  check("the lookup exposes only id, name and the last digits", Object.keys(found[0]).sort().join() === "id,name,phone_last4" && found[0].phone_last4 === "4567");
  check("a partial phone finds nothing", (await db.query(`select * from public.find_customer('0100123')`)).rows.length === 0);
  await expectError(
    db.query(`insert into public.customers (name, phone) values ('x', '1')`),
    "row-level security",
    "customers cannot be written around the RPCs"
  );

  // ---- consent is explicit and recorded ----
  await db.query(`select public.set_customer_consent('${customer}', true, 'register')`);
  await db.query(`select public.set_customer_consent('${customer}', false, 'register')`);
  await asAdminService(db);
  const { rows: events } = await db.query<{ consent: boolean; recorded_by: string; source: string }>(
    `select consent, recorded_by, source from public.customer_consent_events where customer_id = '${customer}' order by recorded_at, id`
  );
  check("every consent change is recorded", events.length === 2 && events[0].consent === true && events[1].consent === false);
  check("the consent event names the staff member", events[0].recorded_by === CASHIER && events[0].source === "register");
  const { rows: now } = await db.query<{ consent_marketing: boolean }>(`select consent_marketing from public.customers where id = '${customer}'`);
  check("the current consent reflects the latest event", now[0].consent_marketing === false);
  await expectError(db.query(`update public.customer_consent_events set consent = true`), "immutable", "consent history cannot be edited");
  const audits = await db.query<{ count: string }>(`select count(*) from public.audit_events where action = 'customer_consent_changed'`);
  check("each consent change emits an audit event", n(audits.rows[0].count) === 2);

  // ---- linking a sale is optional ----
  await asUser(db, CASHIER);
  const sell = (customerArg: string) =>
    db.query<{ sale_id: string }>(
      `select * from public.create_sale('[{"product_id":"${PRODUCT}","qty":1,"line_discount":0}]'::jsonb, 'cash', '${shiftId}', 1000, null, null, null, null, ${customerArg})`
    );
  const linked = await sell(`'${customer}'::uuid`);
  const anonymousSale = await sell("null");
  await asAdminService(db);
  const { rows: links } = await db.query<{ id: string; customer_id: string | null }>(`select id, customer_id from public.sales order by sale_number`);
  check("a sale can be linked to a customer", links[0].customer_id === customer && links[0].id === linked.rows[0].sale_id);
  check("customer attachment stays optional", links[1].customer_id === null && links[1].id === anonymousSale.rows[0].sale_id);
  await asUser(db, CASHIER);
  await expectError(sell(`'00000000-0000-0000-0000-0000000000ff'::uuid`), "customer not found", "an unknown customer cannot be attached");

  // ---- history needs the capability ----
  await expectError(db.query(`select * from public.customer_purchase_history('${customer}')`), "capability required", "a cashier cannot read purchase history");
  await asUser(db, MANAGER);
  const { rows: history } = await db.query<{ sale_id: string; total: string; item_count: string }>(
    `select * from public.customer_purchase_history('${customer}')`
  );
  check("an authorised user sees the purchase history", history.length === 1 && n(history[0].total) === 1000 && n(history[0].item_count) === 1);
  check("an authorised user can read the customer profile", (await db.query(`select * from public.customers`)).rows.length === 1);

  // ---- erasure ----
  await asUser(db, CASHIER);
  await expectError(db.query(`select public.anonymize_customer('${customer}')`), "capability required", "a cashier cannot anonymise a customer");
  await asUser(db, MANAGER);
  await db.query(`select public.anonymize_customer('${customer}')`);
  await asAdminService(db);
  const { rows: erased } = await db.query<Record<string, unknown>>(`select * from public.customers where id = '${customer}'`);
  check("anonymising removes personal data", erased[0].name === "Anonymous customer" && erased[0].phone === null && erased[0].email === null);
  check("anonymising withdraws consent and stamps the time", erased[0].consent_marketing === false && erased[0].anonymized_at !== null);
  const { rows: stillLinked } = await db.query<{ customer_id: string }>(`select customer_id from public.sales where customer_id is not null`);
  check("sales keep their (now anonymous) customer link", stillLinked.length === 1);
  await asUser(db, CASHIER);
  check("the old phone no longer finds the customer", (await db.query(`select * from public.find_customer('01001234567')`)).rows.length === 0);
  await expectError(sell(`'${customer}'::uuid`), "customer not found", "an anonymised customer cannot be attached again");
  await expectError(db.query(`select public.set_customer_consent('${customer}', true, 'register')`), "customer not found", "consent cannot be recorded for an anonymised customer");
  await asUser(db, MANAGER);
  await expectError(db.query(`select public.anonymize_customer('${customer}')`), "already anonymi", "anonymising twice is rejected");
  await asAdminService(db);
  const erasedAudit = await db.query<{ count: string }>(`select count(*) from public.audit_events where action = 'customer_anonymized' and target_id = '${customer}'`);
  check("erasure emits one audit event", n(erasedAudit.rows[0].count) === 1);
  await asUser(db, CASHIER);
  const { rows: reused } = await db.query<{ id: string }>(`select public.create_customer('New Owner', '01001234567') as id`);
  check("a released phone number can be registered again", reused.length === 1 && reused[0].id !== customer);

  if (failures > 0) {
    console.error(`\n${failures} check(s) failing`);
    process.exit(1);
  }
  console.log("\nCustomer tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
