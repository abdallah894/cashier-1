import { asAdminService, asUser, createTestDb, seedUser } from "./lib/pglite-db";

const ADMIN = "00000000-0000-0000-0000-00000000000a";
const CASHIER = "00000000-0000-0000-0000-00000000000b";
const OTHER = "00000000-0000-0000-0000-00000000000c";
const P = "00000000-0000-0000-0000-000000000101";

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
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const db = await createTestDb();
  await seedUser(db, ADMIN, "admin", "admin");
  await seedUser(db, CASHIER, "cashier", "cashier");
  await seedUser(db, OTHER, "other", "cashier");
  await db.query(`insert into public.products (id, barcode, name_ar, name_en, price, cost, tax_rate, stock_qty, unit)
    values ('${P}', 'rel-1', 'منتج', 'Product', 5000, 3000, 0, 1000, 'piece')`);
  const { rows: shifts } = await db.query<{ id: string }>(`insert into public.shifts (cashier_id, opening_float) values ('${CASHIER}', 0) returning id`);
  const shiftId = shifts[0].id;

  const rows = async (sql: string, params: unknown[] = []) => {
    const who = (await db.query<{ sub: string | null; u: string }>(`select current_setting('request.jwt.claim.sub', true) as sub, current_user as u`)).rows[0];
    await asAdminService(db);
    const out = (await db.query(sql, params)).rows as Record<string, unknown>[];
    if (who.u === "authenticated" && who.sub) await asUser(db, who.sub);
    return out;
  };

  // ---- rate limiting is per user and scope, enforced in the database ----
  await asUser(db, CASHIER);
  const hit = async (scope: string, limit = 3, window = 3600) =>
    (await db.query<{ allowed: boolean; remaining: number; retry_after_seconds: number }>(`select * from public.consume_rate_limit('${scope}', ${limit}, ${window})`)).rows[0];
  const r1 = await hit("ai");
  const r2 = await hit("ai");
  const r3 = await hit("ai");
  const r4 = await hit("ai");
  check("requests within the limit are allowed and counted down", r1.allowed && r2.allowed && r3.allowed && r1.remaining === 2 && r3.remaining === 0);
  check("the request over the limit is refused with a retry hint", !r4.allowed && r4.remaining === 0 && n(r4.retry_after_seconds) > 0 && n(r4.retry_after_seconds) <= 3600);
  check("another scope has its own budget", (await hit("other-scope")).allowed);
  await asUser(db, OTHER);
  check("another user has their own budget", (await hit("ai")).allowed);
  await asUser(db, CASHIER);
  const quick = await hit("burst", 1, 1);
  const blocked = await hit("burst", 1, 1);
  await sleep(1100);
  const reopened = await hit("burst", 1, 1);
  check("a limit applies per window and resets after it", quick.allowed && !blocked.allowed && reopened.allowed);
  await expectError(db.query(`select * from public.consume_rate_limit('', 3, 60)`), "invalid", "an empty scope is refused");
  await expectError(db.query(`select * from public.consume_rate_limit('x', 0, 60)`), "invalid", "a zero limit is refused");
  await expectError(db.query(`select * from public.consume_rate_limit('x', 3, 0)`), "invalid", "a zero window is refused");
  check("the limiter table exposes no rows to users", (await db.query(`select * from public.rate_limits`)).rows.length === 0);

  // ---- ops events: append-only, secrets refused ----
  await asAdminService(db);
  await db.query(`select public.record_ops_event('rpc_failed', 'warning', '{"rpc":"create_return"}'::jsonb)`);
  await expectError(db.query(`select public.record_ops_event('checkout_failed', 'warning', '{"pin":"1234"}'::jsonb)`), "sensitive", "a PIN key is refused");
  await expectError(db.query(`select public.record_ops_event('checkout_failed', 'warning', '{"nested":{"api_key":"x"}}'::jsonb)`), "sensitive", "a nested secret key is refused");
  await expectError(db.query(`select public.record_ops_event('checkout_failed', 'warning', '{"Authorization":"Bearer x"}'::jsonb)`), "sensitive", "an authorization key is refused");
  await expectError(db.query(`select public.record_ops_event('made_up', 'warning', '{}'::jsonb)`), "invalid", "an unknown event kind is refused");
  await expectError(db.query(`update public.ops_events set severity = 'info'`), "immutable", "ops events cannot be edited");
  await expectError(db.query(`delete from public.ops_events`), "immutable", "ops events cannot be deleted");
  await asUser(db, CASHIER);
  await expectError(db.query(`select public.record_ops_event('checkout_failed', 'warning', '{}'::jsonb)`), "permission denied", "only the server may record ops events");
  await expectError(db.query(`select * from public.ops_alerts()`), "permission denied", "users cannot read alert state");
  check("a cashier cannot read ops events", (await db.query(`select * from public.ops_events`)).rows.length === 0);

  // ---- alert rules ----
  await asAdminService(db);
  const alerts = async () => (await db.query<{ alert: string; severity: string; detail: string }>(`select * from public.ops_alerts()`)).rows;
  check("a quiet system has only the missing-backup alert", (await alerts()).map((a) => a.alert).join() === "backup_overdue");

  await db.query(`select public.record_backup_run('ok', 123456, 'supabase-daily', 'nightly', now() - interval '10 minutes')`);
  check("a recent successful backup clears the backup alert", (await alerts()).length === 0);
  await db.query(`select public.record_backup_run('failed', null, 'supabase-daily', 'disk full', now())`);
  check("a failed backup raises a critical alert", (await alerts()).some((a) => a.alert === "backup_failed" && a.severity === "critical"));
  await db.query(`select public.record_backup_run('ok', 123456, 'supabase-daily', 'retry', now())`);
  check("a later successful backup clears the failure", (await alerts()).length === 0);
  await expectError(db.query(`update public.backup_runs set status = 'ok'`), "immutable", "backup history cannot be rewritten");
  await asUser(db, CASHIER);
  await expectError(db.query(`select public.record_backup_run('ok', 1, 'x', null, now())`), "permission denied", "users cannot record backups");
  await asAdminService(db);

  for (let i = 0; i < 2; i++) await db.query(`select public.record_ops_event('checkout_failed', 'warning', '{"code":"rpc_unreachable"}'::jsonb)`);
  check("two checkout failures are tolerated", !(await alerts()).some((a) => a.alert === "checkout_failures"));
  await db.query(`select public.record_ops_event('checkout_failed', 'warning', '{"code":"rpc_unreachable"}'::jsonb)`);
  const checkout = (await alerts()).find((a) => a.alert === "checkout_failures");
  check("repeated checkout failures raise a critical alert", checkout !== undefined && checkout.severity === "critical");

  // The check now runs every 30 minutes, so the look-back is 30 minutes: a burst from 20 minutes
  // ago is still caught between two runs, one older than 30 minutes is history. (The log is
  // immutable, so aged rows are inserted rather than updated.) One fresh rpc_failed exists so far.
  const aged = (minutes: number) =>
    db.query(`insert into public.ops_events (kind, severity, detail, created_at) select 'rpc_failed', 'warning', '{}'::jsonb, now() - interval '${minutes} minutes' from generate_series(1, 4)`);
  await aged(40);
  check("failures older than 30 minutes do not alert", !(await alerts()).some((a) => a.alert === "rpc_failures"));
  await aged(20);
  check("failures from 20 minutes ago still count (a burst between two 30-minute runs)", (await alerts()).some((a) => a.alert === "rpc_failures"));

  for (let i = 0; i < 5; i++) await db.query(`select public.record_ops_event('rpc_failed', 'warning', '{"rpc":"create_return"}'::jsonb)`);
  check("repeated RPC failures raise an alert", (await alerts()).some((a) => a.alert === "rpc_failures"));

  // ---- sync backlog reported by tills ----
  await asUser(db, CASHIER);
  await db.query(`select public.report_client_health(25, 0, 120)`);
  await expectError(db.query(`select public.report_client_health(-1, 0, 0)`), "invalid", "a negative backlog is refused");
  await asAdminService(db);
  check("a large queued backlog raises an alert", (await alerts()).some((a) => a.alert === "sync_backlog"));
  await asUser(db, CASHIER);
  await db.query(`select public.report_client_health(0, 0, 0)`);
  await asAdminService(db);
  check("a till that reports an empty queue clears its backlog alert", !(await alerts()).some((a) => a.alert === "sync_backlog"));
  await asUser(db, CASHIER);
  await db.query(`select public.report_client_health(3, 2, 1200)`);
  await asAdminService(db);
  check("rejected or long-stuck sales raise the backlog alert", (await alerts()).some((a) => a.alert === "sync_backlog"));
  await asUser(db, CASHIER);
  await db.query(`select public.report_client_health(0, 0, 0)`);
  await asAdminService(db);

  // ---- stuck payments ----
  await db.query(`set session_replication_role = replica`);
  await db.query(`insert into public.payments (direction, tender, provider, amount, status, idempotency_key, created_by, created_at)
    values ('charge', 'card', 'manual_terminal', 900, 'pending', '00000000-0000-4000-8000-000000000001', '${CASHIER}', now() - interval '3 hours')`);
  await db.query(`set session_replication_role = origin`);
  check("a payment stuck pending raises an alert", (await alerts()).some((a) => a.alert === "payments_stuck"));

  // ---- integrity checks used after any restore ----
  await asUser(db, CASHIER);
  await db.query(`select * from public.create_sale('[{"product_id":"${P}","qty":2,"line_discount":0}]'::jsonb, 'cash', '${shiftId}', 20000)`);
  const sale = (await db.query<{ sale_id: string }>(`select * from public.create_sale('[{"product_id":"${P}","qty":1,"line_discount":0}]'::jsonb, 'cash', '${shiftId}', 10000)`)).rows[0].sale_id;
  const item = (await rows(`select id from public.sale_items where sale_id = '${sale}'`))[0].id as string;
  await db.query(`select * from public.create_return('${sale}', '[{"sale_item_id":"${item}","qty":1}]'::jsonb, 'cash', 'test', true)`);
  await asAdminService(db);
  await db.query(`update public.payments set resolved_at = now(), resolved_by = '${ADMIN}', resolution_note = 'test fixture' where status = 'pending'`);
  const integrity = async () => (await db.query<{ check_name: string; ok: boolean; detail: string }>(`select * from public.verify_database_integrity()`)).rows;
  const clean = await integrity();
  check("a healthy database passes every integrity check", clean.length >= 5 && clean.every((c) => c.ok), clean.filter((c) => !c.ok).map((c) => c.check_name).join());
  await asUser(db, CASHIER);
  await expectError(db.query(`select * from public.verify_database_integrity()`), "permission denied", "users cannot run integrity checks");
  await asAdminService(db);
  await db.query(`set session_replication_role = replica`);
  await db.query(`update public.sales set total = total + 1 where id = '${sale}'`);
  await db.query(`set session_replication_role = origin`);
  const broken = await integrity();
  check("a sale that no longer matches its payments is caught", broken.some((c) => c.check_name === "sale_totals_match_payments" && !c.ok));
  check("a sale that no longer matches its lines is caught", broken.some((c) => c.check_name === "sale_totals_match_lines" && !c.ok));

  if (failures > 0) {
    console.error(`\n${failures} check(s) failing`);
    process.exit(1);
  }
  console.log("\nReliability SQL tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
