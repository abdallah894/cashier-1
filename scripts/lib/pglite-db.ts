import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

/**
 * In-memory Postgres with Supabase shims — this machine has no Docker, so
 * migrations are validated against PGlite instead of `supabase start`.
 * Shims: the three Supabase roles, an `auth` schema with a stub users table
 * and auth.uid() reading request.jwt.claim.sub, and an `extensions` schema
 * for pgcrypto (matching Supabase's layout).
 */
export async function createTestDb(): Promise<PGlite> {
  const db = new PGlite({ extensions: { pgcrypto } });

  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin;

    create schema auth;
    create table auth.users (
      id uuid primary key,
      email text unique
    );
    create function auth.uid() returns uuid
    language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;

    create schema extensions;

    -- storage shim: the phase-3 migration creates a bucket + object policies
    create schema storage;
    create table storage.buckets (
      id text primary key,
      name text not null,
      public boolean not null default false
    );
    create table storage.objects (
      id uuid primary key default gen_random_uuid(),
      bucket_id text references storage.buckets(id),
      name text,
      owner uuid
    );

    grant usage on schema public, auth, extensions, storage to anon, authenticated, service_role;
  `);

  const dir = join(process.cwd(), "supabase", "migrations");
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith(".sql")) continue;
    try {
      await db.exec(readFileSync(join(dir, file), "utf8"));
    } catch (err) {
      throw new Error(`migration ${file} failed: ${(err as Error).message}`);
    }
  }

  // Table and sequence privileges now come from the migrations themselves
  // (20261021090000_explicit_table_grants.sql): this database starts with no default
  // privileges, like a new Supabase project, so a missing grant fails the tests.
  await db.exec(`
    grant execute on all functions in schema extensions to authenticated, service_role;
  `);
  return db;
}

/** Run as an authenticated user: RLS enforced, auth.uid() = uid. */
export async function asUser(db: PGlite, uid: string): Promise<void> {
  await db.exec(
    `set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);`
  );
}

/** Back to superuser — stands in for service_role (bypasses RLS). */
export async function asAdminService(db: PGlite): Promise<void> {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
}

/** Seed an auth user + profile (run while superuser). */
export async function seedUser(
  db: PGlite,
  id: string,
  name: string,
  role: "admin" | "cashier"
): Promise<void> {
  await db.exec(`
    insert into auth.users (id, email) values ('${id}', '${name}@test.local');
    insert into public.profiles (id, full_name, role) values ('${id}', '${name}', '${role}');
  `);
}
