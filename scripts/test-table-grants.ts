/**
 * Table privileges come from the migrations (20261021090000_explicit_table_grants.sql), not from
 * Supabase defaults: a fresh Supabase project may not grant anything automatically, which made the
 * seed script and the server fail with "permission denied for table profiles".
 */
import { createTestDb } from "./lib/pglite-db";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failures++;
}

async function main() {
  const db = await createTestDb(); // starts with NO default privileges, like a new project
  const tables = (await db.query<{ t: string }>(`select quote_ident(tablename) as t from pg_tables where schemaname = 'public'`)).rows.map((r) => r.t);
  check("there are tables to check", tables.length > 40, String(tables.length));

  const missing = async (role: string, privilege: string) => {
    const out: string[] = [];
    for (const t of tables) {
      const { rows } = await db.query<{ ok: boolean }>(`select has_table_privilege('${role}', 'public.${t}', '${privilege}') as ok`);
      if (!rows[0].ok) out.push(t);
    }
    return out;
  };

  for (const role of ["service_role", "authenticated"]) {
    for (const privilege of ["select", "insert", "update", "delete"]) {
      const lacking = await missing(role, privilege);
      check(`${role} can ${privilege} on every table`, lacking.length === 0, lacking.join(","));
    }
  }
  check("nobody gets TRUNCATE (ledgers stay append-only)", (await missing("authenticated", "truncate")).length === tables.length && (await missing("service_role", "truncate")).length === tables.length);
  for (const privilege of ["select", "insert", "update", "delete"]) {
    const open = tables.length - (await missing("anon", privilege)).length;
    check(`anon cannot ${privilege} on any table`, open === 0, `${open} table(s)`);
  }

  const seq = await db.query<{ ok: boolean }>(`select has_sequence_privilege('authenticated', 'public.sale_number_seq', 'usage') and has_sequence_privilege('service_role', 'public.sale_number_seq', 'usage') as ok`);
  check("the signed-in roles can use the receipt-number sequence", seq.rows[0].ok);
  check("anon cannot use it", !(await db.query<{ ok: boolean }>(`select has_sequence_privilege('anon', 'public.sale_number_seq', 'usage') as ok`)).rows[0].ok);

  // a table added by a FUTURE migration needs no grant of its own
  await db.exec(`create table public.zz_future_table (id int primary key); alter table public.zz_future_table enable row level security;`);
  const future = await db.query<{ svc: boolean; auth: boolean; anon: boolean }>(
    `select has_table_privilege('service_role', 'public.zz_future_table', 'insert') as svc,
            has_table_privilege('authenticated', 'public.zz_future_table', 'select') as auth,
            has_table_privilege('anon', 'public.zz_future_table', 'select') as anon`
  );
  check("a table created later is reachable by the right roles automatically", future.rows[0].svc && future.rows[0].auth && !future.rows[0].anon, JSON.stringify(future.rows[0]));

  if (failures > 0) {
    console.error(`\n${failures} check(s) failing`);
    process.exit(1);
  }
  console.log("\nTable grant tests passed.");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
