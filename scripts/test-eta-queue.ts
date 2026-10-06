/**
 * Phase 1.1: the tax-authority e-receipt QUEUE (not the authority's document
 * format, which needs the official spec): enqueue after commit, claim, retry
 * with backoff, recovery of crashed workers, alerts, permissions, and the
 * provider-independent worker.
 */
import { createTestDb, asUser, asAdminService, seedUser } from "./lib/pglite-db";
import { getEtaProvider } from "../lib/eta/providers";
import { processEtaQueue } from "../lib/eta/worker";
import type { EtaOutcome, EtaProvider, EtaSubmission } from "../lib/eta/types";

const ADMIN = "00000000-0000-0000-0000-00000000000a";
const CASHIER = "00000000-0000-0000-0000-00000000000b";
const PRODUCT = "00000000-0000-0000-0000-000000000101";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failures++;
}
async function expectError(promise: Promise<unknown>, fragment: string, name: string) {
  try {
    await promise;
    check(name, false, "no error raised");
  } catch (err) {
    check(name, (err as Error).message.includes(fragment), (err as Error).message);
  }
}

async function database() {
  const db = await createTestDb();
  await seedUser(db, ADMIN, "admin", "admin");
  await seedUser(db, CASHIER, "cashier", "cashier");
  await db.exec(`insert into public.products (id, barcode, name_ar, name_en, price, tax_rate, stock_qty, unit) values ('${PRODUCT}', '100', 'م', 'P', 1000, 0, 100, 'piece')`);
  await asUser(db, CASHIER);
  const shift = (await db.query<{ id: string }>(`insert into public.shifts (cashier_id, opening_float) values ('${CASHIER}', 0) returning id`)).rows[0].id;
  const sell = async () =>
    (await db.query<{ sale_id: string }>(`select * from public.create_sale('[{"product_id":"${PRODUCT}","qty":1}]'::jsonb, 'cash', '${shift}', 1000)`)).rows[0].sale_id;
  const q = async <T extends object>(sql: string) => (await db.query<T>(sql)).rows;

  // off by default: nothing is queued
  const first = await sell();
  await asAdminService(db);
  check("nothing is queued while the feature is off", (await q(`select id from public.eta_submissions`)).length === 0);
  check("the feature is off by default", (await q<{ eta_enabled: boolean }>(`select eta_enabled from public.store_settings`))[0].eta_enabled === false);

  // switch it on (admin)
  await asUser(db, ADMIN);
  await db.query(`select public.update_store_settings('{"eta_enabled":true}'::jsonb)`);
  await asUser(db, CASHIER);
  const second = await sell();
  const third = await sell();
  await asAdminService(db);
  const queued = await q<{ sale_id: string; status: string; attempts: number }>(`select sale_id, status, attempts from public.eta_submissions order by created_at`);
  check("each new sale is queued exactly once", queued.length === 2 && queued.every((r) => r.status === "queued" && Number(r.attempts) === 0));
  check("sales made before switching on are not queued", !queued.some((r) => r.sale_id === first));
  check("both new sales are in the queue", queued.map((r) => r.sale_id).sort().join() === [second, third].sort().join());

  // a return is queued too
  await db.exec(`insert into public.returns (sale_id, actor_id, reason, refund_tender, refund_total, restock) values ('${second}', '${ADMIN}', 'test', 'cash', 1000, true)`);
  const kinds = await q<{ document_kind: string }>(`select document_kind from public.eta_submissions order by document_kind`);
  check("a return is queued as a return", kinds.map((k) => k.document_kind).join() === "return,sale,sale");

  // permissions
  await asUser(db, CASHIER);
  check("a cashier cannot read the queue", (await q(`select id from public.eta_submissions`)).length === 0);
  await expectError(db.query(`select * from public.eta_claim_batch(5)`), "permission denied", "a cashier cannot claim work");
  await expectError(db.query(`select * from public.eta_record_result('${second}', 'accepted')`), "permission denied", "a cashier cannot record results");
  await asUser(db, ADMIN);
  check("an admin can read the queue", (await q(`select id from public.eta_submissions`)).length === 3);
  check("an admin cannot edit the queue by hand either (no update policy)", (await q(`update public.eta_submissions set status = 'accepted' returning id`)).length === 0);
  await asAdminService(db);

  // claim
  const claimed = await q<{ id: string; status: string; attempts: number }>(`select * from public.eta_claim_batch(2)`);
  check("claiming marks rows submitting and counts the attempt", claimed.length === 2 && claimed.every((r) => r.status === "submitting" && Number(r.attempts) === 1));
  const again = await q(`select * from public.eta_claim_batch(10)`);
  check("claimed rows are not handed out twice", again.length === 1);
  check("an empty queue claims nothing", (await q(`select * from public.eta_claim_batch(10)`)).length === 0);

  // outcomes
  const [a, b] = claimed;
  const accepted = (await q<{ status: string; eta_uuid: string; last_error: string | null }>(`select * from public.eta_record_result('${a.id}', 'accepted', 'UUID-123', 'SUB-1')`))[0];
  check("an accepted result stores the authority's id", accepted.status === "accepted" && accepted.eta_uuid === "UUID-123" && accepted.last_error === null);
  await expectError(db.query(`select * from public.eta_record_result('${a.id}', 'accepted')`), "not in progress", "a finished row cannot be changed again");
  const rejected = (await q<{ status: string; last_error: string }>(`select * from public.eta_record_result('${b.id}', 'rejected', null, null, 'invalid seller')`))[0];
  check("a rejection is kept for a person, with the reason", rejected.status === "rejected" && rejected.last_error === "invalid seller");
  await expectError(db.query(`select * from public.eta_record_result('${b.id}', 'maybe')`), "unknown outcome", "an unknown outcome is refused");

  // retry with backoff, give up after 8 attempts
  const third2 = again[0] as { id: string };
  const retry1 = (await q<{ status: string; next_attempt_at: string }>(`select * from public.eta_record_result('${third2.id}', 'retry', null, null, 'portal down')`))[0];
  check("a temporary failure goes back in the queue", retry1.status === "queued");
  check("with a delay before the next attempt", new Date(retry1.next_attempt_at).getTime() > Date.now() + 60_000);
  check("and is not claimable until then", (await q(`select * from public.eta_claim_batch(10)`)).length === 0);
  await db.exec(`update public.eta_submissions set next_attempt_at = now() - interval '1 minute', attempts = 7 where id = '${third2.id}'`);
  const eighth = (await q<{ attempts: number }>(`select * from public.eta_claim_batch(10)`))[0];
  check("the 8th attempt is allowed", Number(eighth.attempts) === 8);
  const failed = (await q<{ status: string }>(`select * from public.eta_record_result('${third2.id}', 'retry', null, null, 'still down')`))[0];
  check("after 8 attempts the document is marked failed", failed.status === "failed");

  // a crashed worker: submitting for >10 min is recovered
  await db.exec(`update public.eta_submissions set status = 'submitting', claimed_at = now() - interval '11 minutes', next_attempt_at = now() - interval '11 minutes', attempts = 1 where id = '${third2.id}'`);
  const recovered = await q<{ id: string }>(`select * from public.eta_claim_batch(10)`);
  check("a stuck submitting row is handed out again", recovered.some((r) => r.id === third2.id));
  await db.exec(`update public.eta_submissions set status = 'failed' where id = '${third2.id}'`);

  // alerts
  const alerts = async () => (await q<{ alert: string; severity: string }>(`select alert, severity from public.ops_alerts()`)).filter((r) => r.alert.startsWith("eta_"));
  const names = (await alerts()).map((r) => `${r.alert}:${r.severity}`);
  check("rejected or failed documents raise a critical alert", names.includes("eta_rejected:critical"), names.join());
  await db.exec(`update public.eta_submissions set status = 'accepted' where status in ('rejected', 'failed')`);
  check("no alert when everything is accepted", (await alerts()).length === 0);
  await db.exec(`update public.eta_submissions set status = 'queued', created_at = now() - interval '1 hour' where id = '${a.id}'`);
  check("a document waiting over 30 minutes raises a backlog warning", (await alerts()).some((r) => r.alert === "eta_backlog" && r.severity === "warning"));
  await db.exec(`update public.store_settings set eta_enabled = false`);
  check("alerts are silent while the feature is off", (await alerts()).length === 0);
}

async function worker() {
  const rows = (n: number): EtaSubmission[] => Array.from({ length: n }, (_, i) => ({ id: `r${i}`, document_kind: "sale", sale_id: `s${i}`, return_id: null, attempts: 1 }));
  const run = async (queue: EtaSubmission[], submit: EtaProvider["submit"], extra: { failRecordFor?: string; batchSize?: number } = {}) => {
    const recorded: [string, EtaOutcome][] = [];
    const result = await processEtaQueue({
      provider: { name: "fake", submit },
      batchSize: extra.batchSize ?? 20,
      claim: async (limit) => queue.splice(0, limit),
      record: async (id, outcome) => {
        if (id === extra.failRecordFor) throw new Error("db down");
        recorded.push([id, outcome]);
      },
    });
    return { result, recorded };
  };

  const ok = await run(rows(3), async (d) => ({ kind: "accepted", etaUuid: `U-${d.id}` }));
  check("accepted documents are recorded with their ids", ok.result.accepted === 3 && ok.recorded[1][1].kind === "accepted");

  const mixed = await run(rows(3), async (d) => (d.id === "r0" ? { kind: "rejected", error: "bad" } : d.id === "r1" ? { kind: "retry", error: "later" } : { kind: "accepted", etaUuid: "U" }));
  check("each outcome is counted separately", mixed.result.rejected === 1 && mixed.result.retried === 1 && mixed.result.accepted === 1);

  const throws = await run(rows(2), async () => {
    throw new Error("socket hang up");
  });
  check("a provider that throws means retry, never a lost document", throws.result.retried === 2 && throws.recorded.every(([, o]) => o.kind === "retry"));
  check("a thrown message is kept (clipped) for the admin", throws.recorded[0][1].kind === "retry" && (throws.recorded[0][1] as { error: string }).error === "socket hang up");

  const flaky = await run(rows(3), async () => ({ kind: "accepted", etaUuid: "U" }), { failRecordFor: "r1" });
  check("a failed save does not stop the rest of the batch", flaky.result.recordFailed === 1 && flaky.recorded.length === 2);

  const many = await run(rows(45), async () => ({ kind: "accepted", etaUuid: "U" }), { batchSize: 20 });
  check("large queues are drained in batches", many.result.claimed === 45 && many.result.accepted === 45);

  const empty = await run([], async () => ({ kind: "accepted", etaUuid: "U" }));
  check("an empty queue does nothing", empty.result.claimed === 0);

  check("no ETA_PROVIDER means no provider", getEtaProvider(undefined) === null && getEtaProvider("none") === null && getEtaProvider(" ") === null);
  let threw = false;
  try {
    getEtaProvider("magic");
  } catch {
    threw = true;
  }
  check("an unknown provider name is an error, not a silent no-op", threw);
}

async function main() {
  await database();
  await worker();
  if (failures > 0) {
    console.error(`\n${failures} check(s) failing`);
    process.exit(1);
  }
  console.log("\nETA queue tests passed.");
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
