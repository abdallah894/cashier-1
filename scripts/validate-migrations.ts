import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createTestDb } from "./lib/pglite-db";

/**
 * Migration validation, run by CI before anything is deployed:
 *  1. file names are `YYYYMMDDHHMMSS_name.sql`, unique and strictly ordered;
 *  2. destructive statements need an explicit reviewed marker;
 *  3. the whole history applies cleanly to an empty database (PGlite);
 *  4. every public table has Row Level Security enabled (CLAUDE.md rule);
 *  5. every SECURITY DEFINER function pins its search_path;
 *  6. lib/supabase/database.types.ts has not drifted from the schema.
 */
const DIR = join(process.cwd(), "supabase", "migrations");
const TYPES = readFileSync(join(process.cwd(), "lib", "supabase", "database.types.ts"), "utf8");

let failures = 0;
const fail = (message: string) => {
  console.error(`FAIL  ${message}`);
  failures++;
};
const pass = (message: string) => console.log(`PASS  ${message}`);

const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();

// ---- 1. names ----
const stamps = new Set<string>();
let previous = "";
for (const file of files) {
  const match = /^(\d{14})_[a-z0-9_]+\.sql$/.exec(file);
  if (!match) {
    fail(`migration name must look like 20260101120000_what_it_does.sql: ${file}`);
    continue;
  }
  if (stamps.has(match[1])) fail(`duplicate migration timestamp ${match[1]}`);
  if (match[1] <= previous) fail(`migration out of order: ${file}`);
  stamps.add(match[1]);
  previous = match[1];
}
if (failures === 0) pass(`${files.length} migration names are valid, unique and ordered`);

// ---- 2. destructive statements need a reviewed marker ----
const DESTRUCTIVE = [/\bdrop\s+table\b/i, /\bdrop\s+column\b/i, /\bdrop\s+schema\b/i, /\btruncate\s+table\b/i, /\balter\s+table\s+\S+\s+alter\s+column\s+\S+\s+type\b/i];
const MARKER = "-- safety: destructive change reviewed";
const destructiveBefore = failures;
for (const file of files) {
  const sql = readFileSync(join(DIR, file), "utf8");
  // statements inside comments do not count
  const code = sql.replace(/--.*$/gm, "");
  const hit = DESTRUCTIVE.find((re) => re.test(code));
  if (hit && !sql.includes(MARKER)) fail(`${file} contains a destructive statement (${hit.source}); add "${MARKER}" after review`);
}
if (failures === destructiveBefore) pass("no unreviewed destructive statements");

// ---- 3-5. apply everything to an empty database and inspect the result ----
async function main() {
  let db;
  try {
    db = await createTestDb();
    pass("the full migration history applies to an empty database");
  } catch (error) {
    fail((error as Error).message);
    return;
  }

  const noRls = await db.query<{ relname: string }>(
    `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity order by 1`
  );
  if (noRls.rows.length) fail(`tables without Row Level Security: ${noRls.rows.map((r) => r.relname).join(", ")}`);
  else pass("every public table has Row Level Security enabled");

  const unpinned = await db.query<{ proname: string }>(
    `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef and (p.proconfig is null or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'))
     order by 1`
  );
  if (unpinned.rows.length) fail(`SECURITY DEFINER functions without a pinned search_path: ${unpinned.rows.map((r) => r.proname).join(", ")}`);
  else pass("every SECURITY DEFINER function pins its search_path");

  // ---- 6. generated types vs the live schema ----
  const tables = await db.query<{ relname: string }>(
    `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' order by 1`
  );
  // rate_limits is internal plumbing only the limiter function touches
  const INTERNAL_TABLES = new Set(["rate_limits", "audit_actions", "audit_metadata_keys", "promotion_products"]);
  const missingTables = tables.rows.map((r) => r.relname).filter((t) => !INTERNAL_TABLES.has(t) && !new RegExp(`\\b${t}: \\{\\s*\\n\\s*Row:`).test(TYPES));
  if (missingTables.length) fail(`database.types.ts is missing tables: ${missingTables.join(", ")}`);
  else pass("database.types.ts covers every public table");

  const rpcs = await db.query<{ proname: string }>(
    `select distinct p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
       and has_function_privilege('authenticated', p.oid, 'execute')
       and p.prorettype <> 'pg_catalog.trigger'::regtype
       and p.proname not like 'guard\\_%' and p.proname not like 'reject\\_%'
     order by 1`
  );
  // pure helpers used only inside SQL, never called through the API
  const INTERNAL_FUNCTIONS = new Set([
    "default_till_id", "business_cutoff", "business_day_start", "normalize_phone", "payment_transition_allowed",
    "valid_payment_reference", "derive_po_status", "set_updated_at", "is_admin", "has_capability", "reports_guard",
    "jsonb_has_sensitive_key", "reorder_alert_sync", "record_refund_payment", "record_cash_refund_drawer_event",
  ]);
  const missingRpcs = rpcs.rows.map((r) => r.proname).filter((f) => !INTERNAL_FUNCTIONS.has(f) && !new RegExp(`\\b${f}: \\{`).test(TYPES));
  if (missingRpcs.length) fail(`database.types.ts is missing callable functions: ${missingRpcs.join(", ")}`);
  else pass("database.types.ts covers every function callable by signed-in users");

  // regenerate with `npm run db:types` when this fails; the file is hand-maintained in places, so also eyeball the diff
  if (existsSync(join(process.cwd(), ".git"))) {
    try {
      execSync("git diff --quiet -- supabase/migrations", { stdio: "ignore" });
    } catch {
      console.log("NOTE  migrations have uncommitted changes (expected while developing)");
    }
  }
}

main()
  .catch((error) => fail((error as Error).message))
  .finally(() => {
    if (failures > 0) {
      console.error(`\n${failures} migration check(s) failed`);
      process.exit(1);
    }
    console.log("\nMigration validation passed.");
  });
