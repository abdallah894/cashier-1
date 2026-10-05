import { asAdminService, asUser, createTestDb, seedUser } from "./lib/pglite-db";

const ADMIN = "00000000-0000-0000-0000-00000000000a";
const CASHIER = "00000000-0000-0000-0000-00000000000b";

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
  await seedUser(db, CASHIER, "cashier", "cashier");

  await asUser(db, CASHIER);
  await expectError(
    db.query(`insert into public.staff_capabilities (staff_id, capability, granted_by)
      values ('${CASHIER}', 'cash.drawer.adjust', '${CASHIER}')`),
    "row-level security",
    "cashier cannot self-grant a capability"
  );
  const { rows: cashierCapabilities } = await db.query<{ allowed: boolean }>(
    `select public.has_capability('cash.drawer.adjust') as allowed`
  );
  check("cashier has no ungranted capability", cashierCapabilities[0].allowed === false);

  await asUser(db, ADMIN);
  const { rows: adminCapabilities } = await db.query<{ allowed: boolean }>(
    `select public.has_capability('cash.drawer.adjust') as allowed`
  );
  check("active admin has every capability", adminCapabilities[0].allowed === true);

  await asAdminService(db);
  await db.query(`insert into public.staff_capabilities (staff_id, capability, granted_by)
    values ('${CASHIER}', 'cash.drawer.adjust', '${ADMIN}')`);
  await asUser(db, CASHIER);
  const { rows: grantedCapabilities } = await db.query<{ allowed: boolean }>(
    `select public.has_capability('cash.drawer.adjust') as allowed`
  );
  check("explicit cashier grant enables the capability", grantedCapabilities[0].allowed === true);
  await expectError(
    db.query(`insert into public.audit_events (actor_id, action, target_type, metadata)
      values ('${CASHIER}', 'cash_drawer_event', 'shift', '{}'::jsonb)`),
    "row-level security",
    "cashier cannot forge audit event"
  );

  if (failures > 0) {
    console.error(`\n${failures} check(s) failing`);
    process.exit(1);
  }
  console.log("\nAudit permission tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
