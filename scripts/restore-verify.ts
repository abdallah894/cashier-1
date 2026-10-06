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
  // Staff can only sign in if their auth.users row came back with the profile
  // (public.profiles.id references auth.users). A restore of the public schema
  // alone looks healthy but leaves everyone locked out.
  const { data: profiles, error: profilesError } = await client.from("profiles").select("id, full_name").eq("active", true);
  if (profilesError) throw profilesError;
  const authIds = new Set<string>();
  for (let page = 1; ; page++) {
    const { data: users, error: usersError } = await client.auth.admin.listUsers({ page, perPage: 1000 });
    if (usersError) throw usersError;
    for (const user of users.users) authIds.add(user.id);
    if (users.users.length < 1000) break;
  }
  const locked = (profiles ?? []).filter((p) => !authIds.has(p.id));
  console.log(`${locked.length === 0 ? "PASS" : "FAIL"}  every active staff profile has a login account${locked.length ? ` — missing: ${locked.map((p) => p.full_name).join(", ")}` : ""}`);
  if (locked.length > 0) bad++;

  const { count } = await client.from("sales").select("id", { count: "exact", head: true });
  console.log(`INFO  restored database holds ${count ?? 0} sales`);
  if (bad > 0) process.exit(1);
  console.log("Restore verified.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
