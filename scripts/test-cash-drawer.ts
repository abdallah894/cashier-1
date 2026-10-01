import { asUser, createTestDb, seedUser } from "./lib/pglite-db";

const ADMIN = "00000000-0000-0000-0000-00000000000a";
const CASHIER = "00000000-0000-0000-0000-00000000000b";

async function main() {
  const db = await createTestDb();
  await seedUser(db, ADMIN, "admin", "admin");
  await seedUser(db, CASHIER, "cashier", "cashier");
  await asUser(db, CASHIER);
  const { rows: shifts } = await db.query<{ id: string }>(
    `insert into public.shifts (cashier_id, opening_float) values ('${CASHIER}', 50000) returning id`
  );
  const shiftId = shifts[0].id;

  let rejected = false;
  try {
    await db.query(`select public.record_cash_drawer_event('${shiftId}', 'paid_out', 5000, '')`);
  } catch (error) {
    rejected = (error as Error).message.includes("reason is required");
  }
  if (!rejected) throw new Error("paid-out without a reason must be rejected");

  await db.query(`select public.record_cash_drawer_event('${shiftId}', 'paid_in', 10000, 'Float top-up')`);
  await db.query(`select public.record_cash_drawer_event('${shiftId}', 'safe_drop', 5000, 'Safe deposit')`);
  const { rows } = await db.query<{ expected_cash: string }>(
    `select * from public.close_shift('${shiftId}', 55000)`
  );
  if (Number(rows[0].expected_cash) !== 55000) throw new Error("expected cash must include drawer events");
  console.log("Cash drawer ledger tests passed.");
}

main().catch((error) => { console.error(error); process.exit(1); });
