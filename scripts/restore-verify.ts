import { createClient } from "@supabase/supabase-js";

/**
 * Run against a database restored from a backup (a scratch Supabase project,
 * never production) to prove the restore is usable: every invariant checked by
 * verify_database_integrity() must hold. Usage:
 *   RESTORE_SUPABASE_URL=... RESTORE_SERVICE_ROLE_KEY=... npx tsx scripts/restore-verify.ts
 */
const url = process.env.RESTORE_SUPABASE_URL;
const key = process.env.RESTORE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set RESTORE_SUPABASE_URL and RESTORE_SERVICE_ROLE_KEY (the restored scratch project).");
  process.exit(2);
}

async function main() {
  const client = createClient(url!, key!, { auth: { persistSession: false } });
  const { data, error } = await client.rpc("verify_database_integrity");
  if (error) throw error;
  let bad = 0;
  for (const row of data ?? []) {
    console.log(`${row.ok ? "PASS" : "FAIL"}  ${row.check_name}${row.ok ? "" : ` — ${row.detail}`}`);
    if (!row.ok) bad++;
  }
  const { count } = await client.from("sales").select("id", { count: "exact", head: true });
  console.log(`INFO  restored database holds ${count ?? 0} sales`);
  if (bad > 0) process.exit(1);
  console.log("Restore verified.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
