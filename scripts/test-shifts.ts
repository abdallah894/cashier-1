/**
 * Shift lifecycle + PIN SQL tests — run with: npm run test:shifts
 * Validates supabase/migrations/20260706120000_auth_shifts.sql on PGlite.
 */
import { createTestDb, asUser, asAdminService, seedUser } from "./lib/pglite-db";

const ADMIN = "00000000-0000-0000-0000-00000000000a";
const CASHIER = "00000000-0000-0000-0000-00000000000b";
const CASHIER2 = "00000000-0000-0000-0000-00000000000c";
const PRODUCT = "00000000-0000-0000-0000-000000000101";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!cond) failures++;
}

async function expectError(promise: Promise<unknown>, fragment: string, name: string) {
  try {
    await promise;
    check(name, false, "no error raised");
  } catch (err) {
    const msg = (err as Error).message;
    check(name, msg.includes(fragment), msg);
  }
}

async function main() {
  const db = await createTestDb();
  await seedUser(db, ADMIN, "admin", "admin");
  await seedUser(db, CASHIER, "cashier", "cashier");
  await seedUser(db, CASHIER2, "cashier2", "cashier");
  await db.exec(`
    insert into public.products (id, barcode, name_ar, name_en, price, tax_rate, stock_qty, unit)
    values ('${PRODUCT}', '100', 'منتج', 'Product', 6300, 0.14, 100, 'piece');
  `);

  const ITEM = JSON.stringify([{ product_id: PRODUCT, qty: 1 }]);
  const sell = (shiftId: string | null, method = "cash", tendered: string | null = "10000") =>
    db.query(
      `select * from public.create_sale('${ITEM}'::jsonb, '${method}', ${
        shiftId ? `'${shiftId}'` : "null"
      }, ${tendered ?? "null"})`
    );

  // ---------- sales require an open shift ----------
  await asUser(db, CASHIER);
  await expectError(sell(null), "no open shift", "create_sale without shift_id is rejected");

  const { rows: shiftRows } = await db.query<{ id: string }>(
    `insert into public.shifts (cashier_id, opening_float) values ('${CASHIER}', 50000) returning id`
  );
  const shiftId = shiftRows[0].id;
  check("cashier can open own shift", typeof shiftId === "string");

  await expectError(
    db.query(`insert into public.shifts (cashier_id, opening_float) values ('${CASHIER}', 0)`),
    "duplicate key",
    "second open shift for same cashier is rejected (partial unique index)"
  );

  const { rows: sale1 } = await sell(shiftId);
  check("create_sale succeeds with own open shift", sale1.length === 1);
  await sell(shiftId, "card", null); // one card sale for the Z-report math

  // another cashier's shift is not yours
  await asAdminService(db);
  const { rows: shift2Rows } = await db.query<{ id: string }>(
    `insert into public.shifts (cashier_id, opening_float) values ('${CASHIER2}', 0) returning id`
  );
  const shift2Id = shift2Rows[0].id;
  await asUser(db, CASHIER);
  await expectError(
    sell(shift2Id),
    "no open shift",
    "create_sale with another cashier's shift is rejected"
  );

  // ---------- close_shift ----------
  await asUser(db, CASHIER2);
  await expectError(
    db.query(`select * from public.close_shift('${shiftId}', 0)`),
    "not your shift",
    "cannot close another cashier's shift"
  );

  await asUser(db, CASHIER);
  // cash sale: 6300 gross → expected = 50000 float + 6300 cash (card sale excluded)
  const { rows: closed } = await db.query<{ expected_cash: string; closed_at: string }>(
    `select * from public.close_shift('${shiftId}', 55000)`
  );
  check("close_shift sets closed_at", closed[0].closed_at !== null);
  check(
    "expected_cash = opening_float + cash sales only",
    Number(closed[0].expected_cash) === 50000 + 6300,
    `got ${closed[0].expected_cash}`
  );

  await expectError(
    db.query(`select * from public.close_shift('${shiftId}', 0)`),
    "already closed",
    "double close is rejected"
  );
  await expectError(sell(shiftId), "no open shift", "create_sale on a closed shift is rejected");

  // admin may close a cashier's shift
  await asUser(db, ADMIN);
  const { rows: adminClosed } = await db.query<{ closed_at: string }>(
    `select * from public.close_shift('${shift2Id}', 0)`
  );
  check("admin can close a cashier's shift", adminClosed[0].closed_at !== null);

  // ---------- PIN: grants ----------
  await asUser(db, CASHIER);
  await expectError(
    db.query(`select public.verify_pin('${CASHIER}', '1234')`),
    "permission denied",
    "authenticated role cannot call verify_pin"
  );
  await expectError(
    db.query(`select public.set_pin('${CASHIER}', '1234')`),
    "permission denied",
    "authenticated role cannot call set_pin"
  );

  // ---------- PIN: set, verify, lockout ----------
  await asAdminService(db);
  await expectError(
    db.query(`select public.set_pin('${CASHIER}', '12a4')`),
    "4 digits",
    "set_pin rejects a non-4-digit PIN"
  );
  await db.query(`select public.set_pin('${CASHIER}', '1234')`);

  const verify = async (pin: string, who = CASHIER) => {
    const { rows } = await db.query<{ verify_pin: string }>(
      `select public.verify_pin('${who}', '${pin}')`
    );
    return rows[0].verify_pin;
  };

  check("no_pin for a user without a PIN", (await verify("1234", CASHIER2)) === "no_pin");

  check("correct PIN → ok", (await verify("1234")) === "ok");
  for (let i = 1; i <= 4; i++) {
    check(`wrong PIN attempt ${i} → bad_pin`, (await verify("0000")) === "bad_pin");
  }
  check("5th wrong attempt → locked", (await verify("0000")) === "locked");
  check("correct PIN while locked → locked", (await verify("1234")) === "locked");

  // expire the lock manually, then a correct PIN resets everything
  await db.exec(
    `update public.profiles set pin_locked_until = now() - interval '1 second' where id = '${CASHIER}'`
  );
  check("correct PIN after lock expiry → ok", (await verify("1234")) === "ok");
  const { rows: att } = await db.query<{ pin_attempts: number }>(
    `select pin_attempts from public.profiles where id = '${CASHIER}'`
  );
  check("success resets pin_attempts", Number(att[0].pin_attempts) === 0);

  if (failures > 0) {
    console.error(`\n${failures} check(s) failing`);
    process.exit(1);
  }
  console.log("\nAll shift/PIN tests passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
