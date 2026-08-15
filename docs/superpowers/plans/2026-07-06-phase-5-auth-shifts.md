# Phase 5 — Auth, Roles & Shifts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Middleware-protected auth with role redirects, RLS-verified role enforcement, PIN fast-switch via real Supabase session swap, admin user management, shift open/close with a printable Z-report, shift-validated sales, and a touch-friendly 2-key checkout.

**Architecture:** One SQL migration adds PIN verification (`verify_pin`/`set_pin`, service-role-only), shift lifecycle (`close_shift`, one-open-shift index), and a `BEFORE INSERT` trigger on `sales` that rejects any sale without an open shift owned by the sale's cashier (stronger than validating only inside `create_sale` — it covers every insert path). PIN switch mints a real session for the target cashier server-side (`verify_pin` → `admin.generateLink(magiclink)` → `verifyOtp(token_hash)`, no email sent), so `auth.uid()` is always the genuine cashier and existing RLS is untouched. All SQL is TDD'd against PGlite (no Docker on this machine).

**Tech Stack:** Next.js 16 App Router · Supabase (`@supabase/ssr`, service-role admin client) · pgcrypto bcrypt · PGlite for SQL tests · next-intl v4 · Zod v4 · shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-07-06-phase-5-auth-shifts-design.md` (approved).

## Global Constraints

- All money is **integer piasters** in app code; display via `formatEgp`, parse via `parseEgpToPiasters` (both in `lib/money.ts`). NEVER float arithmetic on currency.
- Every user-facing string goes through next-intl (`messages/en.json` + `messages/ar.json`); verify layouts in RTL.
- TypeScript strict, no `any`. Server Components by default; `"use client"` only where interactivity demands.
- RLS is the enforcement boundary; UI hiding and `requireAdmin()` are convenience on top, never the only gate.
- `pin_hash` never leaves the database except into `verify_pin`/`set_pin`; those functions are executable by `service_role` ONLY.
- ESLint runs the React Compiler rules: **`react-hooks/set-state-in-effect` is an error** — never read localStorage/state into `useState` inside an effect; use `useSyncExternalStore` or state initializers (see `components/receipts/receipt-actions.tsx` for the established pattern).
- **This project directory is not a git repository** — commit steps are intentionally omitted. Do not `git init`.
- Platform is Windows; run shell steps through the Bash tool (Git Bash).
- No Docker: SQL is validated with PGlite (`@electric-sql/pglite`, already a devDependency) + Supabase shims. Cloud deployment happens once per migration via `supabase db push` (linked project).
- The dev server talks to the linked Supabase cloud project; Task 1's migration must be pushed before Tasks 3–9's manual verification steps work.

---

### Task 1: Migration + PGlite harness + shift/PIN SQL tests

**Files:**
- Create: `scripts/lib/pglite-db.ts`
- Create: `scripts/test-shifts.ts`
- Create: `supabase/migrations/20260706120000_auth_shifts.sql`
- Modify: `package.json` (scripts)
- Modify: `lib/supabase/database.types.ts` (regenerated or hand-patched)

**Interfaces:**
- Consumes: existing migrations `20260704120000_schema.sql`, `20260704120100_rls.sql`, `20260705090000_stock_and_images.sql`.
- Produces: SQL API used by later tasks — `public.verify_pin(p_user_id uuid, p_pin text) returns text` (`'ok'|'bad_pin'|'locked'|'no_pin'`, service_role only), `public.set_pin(p_user_id uuid, p_pin text) returns void` (service_role only), `public.close_shift(p_shift_id uuid, p_counted numeric) returns public.shifts` (authenticated), partial unique index `shifts_one_open_per_cashier`, trigger `sales_validate_shift`, columns `profiles.pin_attempts int` / `profiles.pin_locked_until timestamptz`. Test harness exports `createTestDb()`, `asUser(db, uid)`, `asAdminService(db)`, `seedUser(db, id, name, role)` reused by Task 2.

- [x] **Step 1: Write the PGlite harness**

Create `scripts/lib/pglite-db.ts`:

```ts
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

    grant usage on schema public, auth, extensions to anon, authenticated, service_role;
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

  // Supabase grants table access broadly and lets RLS do the row gating —
  // mirror that so `set role authenticated` behaves like production.
  await db.exec(`
    grant all on all tables in schema public to authenticated, service_role;
    grant usage, select on all sequences in schema public to authenticated, service_role;
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
```

- [x] **Step 2: Write the failing shift/PIN tests**

Create `scripts/test-shifts.ts`:

```ts
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

  const verify = async (pin: string) => {
    const { rows } = await db.query<{ verify_pin: string }>(
      `select public.verify_pin('${CASHIER}', '${pin}')`
    );
    return rows[0].verify_pin;
  };

  check("no_pin for a user without a PIN", (await (async () => {
    const { rows } = await db.query<{ verify_pin: string }>(
      `select public.verify_pin('${CASHIER2}', '1234')`
    );
    return rows[0].verify_pin;
  })()) === "no_pin");

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
```

Add to `package.json` scripts (after `"test:receipt"`):

```json
    "test:receipt": "tsx scripts/test-receipt.ts",
    "test:shifts": "tsx scripts/test-shifts.ts"
```

- [x] **Step 3: Run the tests to verify they fail**

Run: `npm run test:shifts`
Expected: FAIL — first failure is the missing `no open shift` error (the trigger doesn't exist yet), or `verify_pin does not exist`.

- [x] **Step 4: Write the migration**

Create `supabase/migrations/20260706120000_auth_shifts.sql`:

```sql
-- ============================================================
-- Phase 5 — PIN verification, shift lifecycle, sale-shift enforcement
--
-- verify_pin / set_pin are SERVICE-ROLE ONLY: clients can never call
-- them, so there is no client-side brute-force surface. Lockout: 5
-- consecutive failures → locked for 15 minutes.
--
-- Every NEW sale must reference an open shift owned by its cashier —
-- enforced by a BEFORE INSERT trigger so it covers every insert path
-- (create_sale RPC and any direct RLS-allowed insert alike).
-- ============================================================

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

alter table public.profiles
  add column pin_attempts int not null default 0,
  add column pin_locked_until timestamptz;

-- ---------- PIN ----------

create or replace function public.verify_pin(p_user_id uuid, p_pin text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles%rowtype;
begin
  -- lock the row: concurrent attempts serialize, the counter can't race
  select * into v_profile
  from public.profiles
  where id = p_user_id and active
  for update;

  if not found then
    return 'no_pin'; -- unknown/inactive: same opaque answer as "no PIN set"
  end if;
  if v_profile.pin_hash is null then
    return 'no_pin';
  end if;
  if v_profile.pin_locked_until is not null and v_profile.pin_locked_until > now() then
    return 'locked';
  end if;

  if extensions.crypt(p_pin, v_profile.pin_hash) = v_profile.pin_hash then
    update public.profiles
    set pin_attempts = 0, pin_locked_until = null
    where id = p_user_id;
    return 'ok';
  end if;

  if v_profile.pin_attempts + 1 >= 5 then
    update public.profiles
    set pin_attempts = 0, pin_locked_until = now() + interval '15 minutes'
    where id = p_user_id;
    return 'locked';
  end if;

  update public.profiles
  set pin_attempts = pin_attempts + 1
  where id = p_user_id;
  return 'bad_pin';
end;
$$;

create or replace function public.set_pin(p_user_id uuid, p_pin text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_pin !~ '^\d{4}$' then
    raise exception 'set_pin: PIN must be exactly 4 digits';
  end if;
  update public.profiles
  set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf')),
      pin_attempts = 0,
      pin_locked_until = null
  where id = p_user_id;
  if not found then
    raise exception 'set_pin: profile % not found', p_user_id;
  end if;
end;
$$;

revoke execute on function public.verify_pin from public, anon, authenticated;
grant execute on function public.verify_pin to service_role;
revoke execute on function public.set_pin from public, anon, authenticated;
grant execute on function public.set_pin to service_role;

-- ---------- shifts ----------

-- one open shift per cashier
create unique index shifts_one_open_per_cashier
  on public.shifts (cashier_id)
  where closed_at is null;

create or replace function public.close_shift(p_shift_id uuid, p_counted numeric)
returns public.shifts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shift public.shifts%rowtype;
  v_cash numeric;
begin
  if p_counted is null or p_counted < 0 then
    raise exception 'close_shift: counted cash must be >= 0';
  end if;

  select * into v_shift from public.shifts where id = p_shift_id for update;
  if not found then
    raise exception 'close_shift: shift % not found', p_shift_id;
  end if;
  if v_shift.closed_at is not null then
    raise exception 'close_shift: shift already closed';
  end if;
  if v_shift.cashier_id <> auth.uid() and not public.is_admin() then
    raise exception 'close_shift: not your shift';
  end if;

  select coalesce(sum(total), 0) into v_cash
  from public.sales
  where shift_id = p_shift_id and payment_method = 'cash';

  update public.shifts
  set closed_at = now(),
      closing_counted = p_counted,
      expected_cash = v_shift.opening_float + v_cash
  where id = p_shift_id
  returning * into v_shift;

  return v_shift;
end;
$$;

revoke execute on function public.close_shift from public, anon;
grant execute on function public.close_shift to authenticated, service_role;

-- ---------- every sale needs an open shift of its cashier ----------

create or replace function public.validate_sale_shift()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.shift_id is null then
    raise exception 'sales: no open shift — open a shift before selling';
  end if;
  perform 1 from public.shifts s
  where s.id = new.shift_id
    and s.cashier_id = new.cashier_id
    and s.closed_at is null;
  if not found then
    raise exception 'sales: no open shift — % is not an open shift of this cashier', new.shift_id;
  end if;
  return new;
end;
$$;

create trigger sales_validate_shift
  before insert on public.sales
  for each row execute function public.validate_sale_shift();
```

- [x] **Step 5: Run the tests to verify they pass**

Run: `npm run test:shifts`
Expected: all `PASS`, exit 0, `All shift/PIN tests passed.`
Also run: `npm run test:cart && npm run test:receipt` — both still pass (regression).

- [x] **Step 6: Push to the cloud project and regenerate types**

Run: `npx supabase db push`
Expected: `20260706120000_auth_shifts.sql` applied to the linked project.

Run: `npm run db:types`
Expected: `lib/supabase/database.types.ts` regenerated — `profiles` Row gains `pin_attempts: number` and `pin_locked_until: string | null`; `Functions` gains `verify_pin`, `set_pin`, `close_shift`.

**Fallback if `db push` cannot run right now** (keeps typecheck green; push before manual verification): hand-edit `lib/supabase/database.types.ts` — add to the `profiles` `Row` type `pin_attempts: number; pin_locked_until: string | null;` (and the same as optional fields in `Insert`/`Update`), and add to `Functions`:

```ts
      close_shift: {
        Args: { p_shift_id: string; p_counted: number };
        Returns: Database["public"]["Tables"]["shifts"]["Row"];
      };
      set_pin: {
        Args: { p_user_id: string; p_pin: string };
        Returns: undefined;
      };
      verify_pin: {
        Args: { p_user_id: string; p_pin: string };
        Returns: string;
      };
```

- [x] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

---

### Task 2: RLS verification test

**Files:**
- Create: `scripts/test-rls.ts`
- Modify: `package.json` (script)

**Interfaces:**
- Consumes: `createTestDb`, `asUser`, `asAdminService`, `seedUser` from Task 1's harness.
- Produces: `npm run test:rls` — the phase gate "cashier cannot access products admin, reports data, or other cashiers' shifts, tested at the API level".

- [x] **Step 1: Write the RLS matrix test**

Create `scripts/test-rls.ts`:

```ts
/**
 * RLS matrix — run with: npm run test:rls
 * Proves at the SQL level (not the UI) that a cashier can only reach
 * what the spec allows: catalog reads, own shifts, own sales.
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
    values ('${PRODUCT}', '100', 'منتج', 'Product', 1000, 0.14, 100, 'piece');
  `);

  // seed: each cashier opens a shift and records one sale
  const ITEM = JSON.stringify([{ product_id: PRODUCT, qty: 1 }]);
  for (const uid of [CASHIER, CASHIER2]) {
    await asUser(db, uid);
    const { rows } = await db.query<{ id: string }>(
      `insert into public.shifts (cashier_id, opening_float) values ('${uid}', 0) returning id`
    );
    await db.query(
      `select * from public.create_sale('${ITEM}'::jsonb, 'cash', '${rows[0].id}', 1000)`
    );
  }

  // ---------- as a cashier ----------
  await asUser(db, CASHIER);

  const products = await db.query(`select id from public.products`);
  check("cashier reads catalog", products.rows.length === 1);

  const upd = await db.query(`update public.products set price = 1 returning id`);
  check("cashier cannot update products (0 rows affected)", upd.rows.length === 0);

  await expectError(
    db.query(
      `insert into public.products (barcode, name_ar, name_en, price) values ('x', 'س', 'X', 1)`
    ),
    "row-level security",
    "cashier cannot insert products"
  );

  const shifts = await db.query<{ cashier_id: string }>(`select cashier_id from public.shifts`);
  check(
    "cashier sees ONLY own shifts",
    shifts.rows.length === 1 && shifts.rows[0].cashier_id === CASHIER,
    `saw ${shifts.rows.length}`
  );

  const sales = await db.query<{ cashier_id: string }>(`select cashier_id from public.sales`);
  check(
    "cashier sees ONLY own sales",
    sales.rows.length === 1 && sales.rows[0].cashier_id === CASHIER,
    `saw ${sales.rows.length}`
  );

  const movements = await db.query(`select id from public.stock_movements`);
  check("cashier sees NO stock_movements (reports data)", movements.rows.length === 0);

  const profiles = await db.query<{ id: string }>(`select id from public.profiles`);
  check(
    "cashier sees ONLY own profile",
    profiles.rows.length === 1 && profiles.rows[0].id === CASHIER
  );

  const promote = await db.query(
    `update public.profiles set role = 'admin' where id = '${CASHIER}' returning id`
  );
  check("cashier cannot self-promote (0 rows affected)", promote.rows.length === 0);

  await expectError(
    db.query(`insert into public.shifts (cashier_id, opening_float) values ('${CASHIER2}', 0)`),
    "row-level security",
    "cashier cannot open a shift for someone else"
  );

  // ---------- as admin ----------
  await asUser(db, ADMIN);
  const allShifts = await db.query(`select id from public.shifts`);
  check("admin sees all shifts", allShifts.rows.length === 2);
  const allSales = await db.query(`select id from public.sales`);
  check("admin sees all sales", allSales.rows.length === 2);
  const adminUpd = await db.query(`update public.products set price = 1100 returning id`);
  check("admin can update products", adminUpd.rows.length === 1);

  if (failures > 0) {
    console.error(`\n${failures} check(s) failing`);
    process.exit(1);
  }
  console.log("\nAll RLS checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Add to `package.json` scripts (after `"test:shifts"`):

```json
    "test:shifts": "tsx scripts/test-shifts.ts",
    "test:rls": "tsx scripts/test-rls.ts"
```

- [x] **Step 2: Run it**

Run: `npm run test:rls`
Expected: all `PASS` (these policies already exist — this is the verification the phase demands; failures mean a real RLS hole, stop and investigate).

---

### Task 3: Route protection, role redirects, admin gating

**Files:**
- Modify: `lib/supabase/proxy.ts` (return the user)
- Modify: `proxy.ts` (redirect logic)
- Modify: `lib/actions/auth.ts` (`signIn`: active check + role redirect)
- Modify: `lib/supabase/queries/profiles.ts` (`requireAdmin`)
- Modify: `app/[locale]/(app)/products/page.tsx`, `products/new/page.tsx`, `products/[id]/page.tsx`, `products/import/page.tsx`, `categories/page.tsx`, `reports/page.tsx` (gate)
- Modify: `components/layout/app-sidebar.tsx`, `app/[locale]/(app)/layout.tsx` (role-filtered nav)
- Modify: `messages/en.json`, `messages/ar.json`

**Interfaces:**
- Consumes: existing `updateSession`, `getCurrentProfile`, `signIn`.
- Produces: `requireAdmin(): Promise<Profile>` (redirects non-admins to `/register`) used by Task 5; `AppSidebar` takes `role: "admin" | "cashier"`; `AuthState` error union gains `"accountDisabled"`.

- [x] **Step 1: Return the user from updateSession**

In `lib/supabase/proxy.ts`, add `import type { User } from "@supabase/supabase-js";` to the imports and replace the end of `updateSession`:

```ts
  // Triggers a token refresh if expired — do not remove.
  await supabase.auth.getUser();

  return response;
```

with:

```ts
  // Triggers a token refresh if expired — do not remove.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { response, user };
```

and change the signature to:

```ts
export async function updateSession(
  request: NextRequest,
  response: NextResponse
): Promise<{ response: NextResponse; user: User | null }> {
```

- [x] **Step 2: Gate routes in the middleware**

Replace the ENTIRE contents of `proxy.ts` with:

```ts
import { NextResponse, type NextRequest } from "next/server";
import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";
import { updateSession } from "./lib/supabase/proxy";

const handleI18nRouting = createMiddleware(routing);

// Next 16 renamed `middleware` to `proxy` — same contract as Nuxt's
// global route middleware: runs before every matched request.
// Order: next-intl resolves the locale → Supabase refreshes the session
// → session-presence gate. Role checks stay server-side (RLS + layouts);
// the middleware never touches the database.
export default async function proxy(request: NextRequest) {
  const i18nResponse = handleI18nRouting(request);
  const { response, user } = await updateSession(request, i18nResponse);

  const segments = request.nextUrl.pathname.split("/").filter(Boolean);
  const hasLocale = (routing.locales as readonly string[]).includes(segments[0]);
  const locale = hasLocale ? segments[0] : routing.defaultLocale;
  const path = "/" + segments.slice(hasLocale ? 1 : 0).join("/");

  const redirectTo = (target: string) => {
    const redirect = NextResponse.redirect(new URL(target, request.url));
    // keep any freshly rotated auth cookies on the redirect response
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  };

  if (!user && path !== "/login") return redirectTo(`/${locale}/login`);
  if (user && path === "/login") return redirectTo(`/${locale}`);

  return response;
}

export const config = {
  // Skip API routes, Next internals and static files (anything with a dot).
  matcher: "/((?!api|_next|_vercel|.*\\..*).*)",
};
```

- [x] **Step 3: Active check + role redirect in signIn**

In `lib/actions/auth.ts`, change the `AuthState` type:

```ts
export type AuthState = { error?: "invalidInput" | "invalidCredentials" | "accountDisabled" };
```

and replace the body of `signIn` after the Zod parse with:

```ts
  const supabase = await createClient();
  const { data: signedIn, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    return { error: "invalidCredentials" };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, active")
    .eq("id", signedIn.user.id)
    .single();
  if (!profile || !profile.active) {
    await supabase.auth.signOut();
    return { error: "accountDisabled" };
  }

  redirect({
    href: profile.role === "admin" ? "/" : "/register",
    locale: await getLocale(),
  });
  return {}; // unreachable — redirect throws
```

- [x] **Step 4: requireAdmin helper**

In `lib/supabase/queries/profiles.ts`, add imports and the helper:

```ts
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
```

```ts
/**
 * Admin gate for pages. RLS would return non-admins empty data anyway —
 * this just lands them somewhere useful instead of an empty screen.
 */
export async function requireAdmin(): Promise<Profile> {
  const profile = await getCurrentProfile();
  if (profile?.role === "admin") return profile;
  redirect({ href: "/register", locale: await getLocale() });
  throw new Error("unreachable"); // redirect throws
}
```

- [x] **Step 5: Gate the six admin pages**

In each of `app/[locale]/(app)/products/page.tsx`, `products/new/page.tsx`, `products/[id]/page.tsx`, `products/import/page.tsx`, `categories/page.tsx`, `reports/page.tsx`: add the import

```ts
import { requireAdmin } from "@/lib/supabase/queries/profiles";
```

and add `await requireAdmin();` as the first statement after the `setRequestLocale(locale);` call in the page's default export. (If a page already fetches the profile, `requireAdmin` still goes first — it's the gate.)

- [x] **Step 6: Role-filter the sidebar**

In `components/layout/app-sidebar.tsx`, change `navItems` and the component signature:

```tsx
const navItems = [
  { key: "register", href: "/register", icon: ShoppingCart, adminOnly: false },
  { key: "sales", href: "/receipts", icon: ReceiptText, adminOnly: false },
  { key: "shifts", href: "/shifts", icon: Clock, adminOnly: false },
  { key: "products", href: "/products", icon: Package, adminOnly: true },
  { key: "categories", href: "/categories", icon: Tags, adminOnly: true },
  { key: "reports", href: "/reports", icon: BarChart3, adminOnly: true },
] as const;

export function AppSidebar({ role }: { role: "admin" | "cashier" }) {
```

and where the items render, filter first:

```tsx
              {navItems
                .filter((item) => role === "admin" || !item.adminOnly)
                .map((item) => (
```

(Note: shifts moves up next to register/sales — the cashier's three pages sit together.)

In `app/[locale]/(app)/layout.tsx`, pass the role:

```tsx
      <AppSidebar role={profile.role} />
```

- [x] **Step 7: i18n**

In `messages/en.json`, inside the `auth` namespace's `errors` object (where `invalidCredentials` lives), add:

```json
      "accountDisabled": "This account has been deactivated. Ask an admin.",
```

In `messages/ar.json`, same place:

```json
      "accountDisabled": "تم إيقاف هذا الحساب. راجع المدير.",
```

- [x] **Step 8: Verify**

Run: `npm run typecheck` — exit 0.
Manual (dev server, migration pushed):
- Logged out: `/en/products` → redirected to `/en/login`. `/en/login` renders.
- Log in as the seed **cashier** → lands on `/en/register`; sidebar shows only Register / Sales / Shifts; typing `/en/products` in the URL bar → bounced to `/en/register`.
- Log in as **admin** → lands on `/en/`; full sidebar; `/en/login` while logged in → bounced to `/en/`.

---

### Task 4: Service-role client, Numpad, PIN fast-switch

**Files:**
- Create: `lib/supabase/admin.ts`
- Create: `components/ui/numpad.tsx`
- Create: `components/register/pin-switch-dialog.tsx`
- Create: `lib/validation/user.ts`
- Modify: `lib/actions/auth.ts` (`switchCashier`)
- Modify: `lib/supabase/queries/profiles.ts` (`getSwitchableCashiers`)
- Modify: `app/[locale]/(app)/register/page.tsx`, `components/register/register.tsx`, `components/register/shortcuts-bar.tsx`
- Modify: `messages/en.json`, `messages/ar.json`
- Modify: `.env.example` (document the service key if missing)

**Interfaces:**
- Consumes: `verify_pin` RPC (Task 1), `ActionResult` from `lib/actions/result.ts`.
- Produces: `createAdminClient()` (service-role, server-only) used by Tasks 5–6; `Numpad({ onKey, withDot?, className? })` with `type NumpadKey = "0"–"9" | "." | "backspace"` used by Tasks 5–8; `switchCashier(input: unknown): Promise<ActionResult<{ name: string }>>`; `getSwitchableCashiers(): Promise<SwitchableCashier[]>`; `type SwitchableCashier = { id: string; full_name: string }` (exported from `pin-switch-dialog.tsx`); `Register` props gain `cashiers: SwitchableCashier[]`; `PinSwitchDialog({ cashiers, open, onOpenChange })` reused by Task 6's gate.

- [x] **Step 1: Service-role client**

Create `lib/supabase/admin.ts`:

```ts
import "server-only";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "./env";
import type { Database } from "./database.types";

/**
 * Service-role client — bypasses RLS and can mint sessions. Server-only;
 * stateless (no cookies, no session persistence). Used for: PIN verify/set,
 * admin user CRUD, and generating the PIN-switch magic link.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set (server env, never NEXT_PUBLIC)");
  }
  return createClient<Database>(SUPABASE_URL, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
```

Check `.env.example`: if it lacks `SUPABASE_SERVICE_ROLE_KEY=`, append it with a comment `# server-only — service role, never expose to the client`.

- [x] **Step 2: Numpad component**

Create `components/ui/numpad.tsx`:

```tsx
"use client";

import { Delete } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type NumpadKey = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "." | "backspace";

const LAYOUT: (NumpadKey | null)[] = ["7", "8", "9", "4", "5", "6", "1", "2", "3", ".", "0", "backspace"];

/**
 * On-screen numpad for touch counters. onPointerDown is prevented so taps
 * never steal focus from the paired input — hardware keyboard flow (scanner,
 * digits, Enter) keeps working while the numpad edits the same value.
 */
export function Numpad({
  onKey,
  withDot = true,
  className,
}: {
  onKey: (key: NumpadKey) => void;
  withDot?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("grid grid-cols-3 gap-2", className)}>
      {LAYOUT.map((key, i) =>
        key === "." && !withDot ? (
          <div key={i} aria-hidden />
        ) : (
          <Button
            key={i}
            type="button"
            variant="outline"
            className="h-12 text-lg font-medium tabular-nums"
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => onKey(key as NumpadKey)}
            aria-label={key === "backspace" ? "backspace" : (key as string)}
          >
            {key === "backspace" ? <Delete className="size-5 rtl:rotate-180" /> : key}
          </Button>
        )
      )}
    </div>
  );
}
```

- [x] **Step 3: Validation schemas**

Create `lib/validation/user.ts`:

```ts
import { z } from "zod";

export const pinSchema = z.string().regex(/^\d{4}$/);

export const switchCashierSchema = z.object({
  targetUserId: z.uuid(),
  pin: pinSchema,
});

export const createStaffSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8).max(72),
  fullName: z.string().trim().min(1).max(120),
  role: z.enum(["admin", "cashier"]),
  pin: pinSchema.optional().or(z.literal("").transform(() => undefined)),
});

export const setStaffPinSchema = z.object({
  userId: z.uuid(),
  pin: pinSchema,
});

export const setStaffRoleSchema = z.object({
  userId: z.uuid(),
  role: z.enum(["admin", "cashier"]),
});

export const toggleStaffActiveSchema = z.object({
  userId: z.uuid(),
  active: z.boolean(),
});
```

- [x] **Step 4: switchCashier action**

In `lib/actions/auth.ts`, add imports:

```ts
import { createAdminClient } from "@/lib/supabase/admin";
import { switchCashierSchema } from "@/lib/validation/user";
import type { ActionResult } from "./result";
```

and append:

```ts
/**
 * PIN fast-switch: verify the PIN (service role), then mint a REAL session
 * for the target cashier — admin.generateLink(magiclink) produces a
 * token_hash we consume immediately with verifyOtp on the cookie client.
 * No email is ever sent. auth.uid() is the genuine cashier afterwards, so
 * RLS and create_sale attribution stay sound.
 */
export async function switchCashier(input: unknown): Promise<ActionResult<{ name: string }>> {
  const parsed = switchCashierSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalidInput" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "notAuthorized" }; // switch never starts a session

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("full_name, active")
    .eq("id", parsed.data.targetUserId)
    .maybeSingle();
  if (!profile || !profile.active) return { ok: false, error: "switchFailed" };

  const { data: verdict, error: verifyError } = await admin.rpc("verify_pin", {
    p_user_id: parsed.data.targetUserId,
    p_pin: parsed.data.pin,
  });
  if (verifyError) return { ok: false, error: "switchFailed" };
  if (verdict === "locked") return { ok: false, error: "pinLocked" };
  if (verdict === "no_pin") return { ok: false, error: "pinNotSet" };
  if (verdict !== "ok") return { ok: false, error: "pinIncorrect" };

  const { data: target, error: userError } = await admin.auth.admin.getUserById(
    parsed.data.targetUserId
  );
  if (userError || !target.user.email) return { ok: false, error: "switchFailed" };

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: target.user.email,
  });
  if (linkError) return { ok: false, error: "switchFailed" };

  const { error: otpError } = await supabase.auth.verifyOtp({
    type: "magiclink",
    token_hash: link.properties.hashed_token,
  });
  if (otpError) return { ok: false, error: "switchFailed" };

  return { ok: true, data: { name: profile.full_name } };
}
```

- [x] **Step 5: Switchable-cashier list query**

In `lib/supabase/queries/profiles.ts`, add:

```ts
import { createAdminClient } from "@/lib/supabase/admin";
```

```ts
/**
 * Active, PIN-enabled staff for the switch dialog. Uses the service-role
 * client because RLS hides other profiles from cashiers — returns only
 * id + name (never hashes, never emails).
 */
export async function getSwitchableCashiers(): Promise<{ id: string; full_name: string }[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("profiles")
    .select("id, full_name")
    .eq("active", true)
    .not("pin_hash", "is", null)
    .order("full_name");
  if (error) throw error;
  return data ?? [];
}
```

- [x] **Step 6: PIN switch dialog**

Create `components/register/pin-switch-dialog.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ChevronLeft, Loader2, UserRound } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { switchCashier } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { Numpad, type NumpadKey } from "@/components/ui/numpad";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type SwitchableCashier = { id: string; full_name: string };

export function PinSwitchDialog({
  cashiers,
  open,
  onOpenChange,
}: {
  cashiers: SwitchableCashier[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("pinSwitch");
  const tErrors = useTranslations("errors");
  const router = useRouter();

  const [selected, setSelected] = useState<SwitchableCashier | null>(null);
  const [pin, setPin] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setSelected(null);
    setPin("");
  }

  function handleOpenChange(next: boolean) {
    if (submitting) return;
    if (!next) reset();
    onOpenChange(next);
  }

  async function submit(target: SwitchableCashier, fullPin: string) {
    setSubmitting(true);
    try {
      const result = await switchCashier({ targetUserId: target.id, pin: fullPin });
      if (!result.ok) {
        toast.error(tErrors(result.error));
        setPin("");
        return;
      }
      toast.success(t("switched", { name: result.data.name }));
      reset();
      onOpenChange(false);
      // new session cookie is set — re-render everything server-side
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  function pressKey(key: NumpadKey) {
    if (!selected || submitting) return;
    if (key === "backspace") {
      setPin((p) => p.slice(0, -1));
      return;
    }
    if (!/^\d$/.test(key)) return;
    const next = (pin + key).slice(0, 4);
    setPin(next);
    if (next.length === 4) void submit(selected, next); // auto-submit on 4th digit
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-sm"
        onKeyDown={(e) => {
          if (/^\d$/.test(e.key)) {
            e.preventDefault();
            pressKey(e.key as NumpadKey);
          } else if (e.key === "Backspace") {
            e.preventDefault();
            pressKey("backspace");
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{selected ? t("pinFor", { name: selected.full_name }) : t("title")}</DialogTitle>
        </DialogHeader>

        {!selected ? (
          <div className="flex flex-col gap-2">
            {cashiers.length === 0 && (
              <p className="text-muted-foreground py-2 text-sm">{t("noCashiers")}</p>
            )}
            {cashiers.map((cashier, i) => (
              <Button
                key={cashier.id}
                variant="outline"
                autoFocus={i === 0}
                className="h-12 justify-start text-base"
                onClick={() => setSelected(cashier)}
              >
                <UserRound className="size-4" />
                {cashier.full_name}
              </Button>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4">
            <div className="flex gap-3 py-2" aria-label={t("enterPin")} dir="ltr">
              {[0, 1, 2, 3].map((i) => (
                <span
                  key={i}
                  className={
                    "size-4 rounded-full border " +
                    (pin.length > i ? "bg-foreground border-foreground" : "border-input")
                  }
                />
              ))}
            </div>
            {submitting ? (
              <Loader2 className="text-muted-foreground size-6 animate-spin" />
            ) : (
              <Numpad onKey={pressKey} withDot={false} className="w-full" />
            )}
            <Button variant="ghost" size="sm" onClick={reset} disabled={submitting}>
              <ChevronLeft className="size-4 rtl:rotate-180" />
              {t("back")}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [x] **Step 7: Wire into the register**

In `app/[locale]/(app)/register/page.tsx`, replace the contents with:

```tsx
import { setRequestLocale } from "next-intl/server";
import { getCurrentProfile, getSwitchableCashiers } from "@/lib/supabase/queries/profiles";
import { Register } from "@/components/register/register";

export default async function RegisterPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [profile, cashiers] = await Promise.all([getCurrentProfile(), getSwitchableCashiers()]);

  return <Register isAdmin={profile?.role === "admin"} cashiers={cashiers} />;
}
```

In `components/register/register.tsx`:

1. Add imports:

```tsx
import { PinSwitchDialog, type SwitchableCashier } from "./pin-switch-dialog";
```

2. Change the signature:

```tsx
export function Register({
  isAdmin,
  cashiers,
}: {
  isAdmin: boolean;
  cashiers: SwitchableCashier[];
}) {
```

3. Add state next to `cameraOpen`:

```tsx
  const [switchOpen, setSwitchOpen] = useState(false);
```

4. Include it in `dialogOpen`:

```tsx
  const dialogOpen = checkoutOpen || cameraOpen || switchOpen;
```

5. In the `onKeyDown` handler, after the `F8` block, add:

```tsx
      if (event.key === "F9") {
        event.preventDefault();
        setSwitchOpen(true);
        return;
      }
```

6. Pass the handler to the shortcuts bar and mount the dialog — replace:

```tsx
      <ShortcutsBar />

      <CheckoutDialog open={checkoutOpen} onOpenChange={setCheckoutOpen} totals={totals} />
```

with:

```tsx
      <ShortcutsBar onSwitchCashier={() => setSwitchOpen(true)} />

      <PinSwitchDialog cashiers={cashiers} open={switchOpen} onOpenChange={setSwitchOpen} />
      <CheckoutDialog open={checkoutOpen} onOpenChange={setCheckoutOpen} totals={totals} />
```

In `components/register/shortcuts-bar.tsx`, replace the entire contents with:

```tsx
"use client";

import { useTranslations } from "next-intl";
import { UserRoundCog } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";

const SHORTCUTS = [
  { keys: "/", label: "focusSearch" },
  { keys: "F2", label: "openCheckout" },
  { keys: "F8", label: "cameraScan" },
  { keys: "F9", label: "switchCashier" },
  { keys: "↑↓", label: "selectLine" },
  { keys: "+/−", label: "changeQty" },
  { keys: "Del", label: "removeLine" },
  { keys: "Esc", label: "close" },
] as const;

export function ShortcutsBar({ onSwitchCashier }: { onSwitchCashier?: () => void }) {
  const t = useTranslations("register.shortcuts");

  return (
    <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-xs">
      {SHORTCUTS.map((s) => (
        <span key={s.keys} className="flex items-center gap-1.5">
          <Kbd>{s.keys}</Kbd>
          {t(s.label)}
        </span>
      ))}
      {onSwitchCashier && (
        <Button variant="ghost" size="sm" className="ms-auto h-7" onClick={onSwitchCashier}>
          <UserRoundCog className="size-4" />
          {t("switchCashier")}
        </Button>
      )}
    </div>
  );
}
```

- [x] **Step 8: i18n**

In `messages/en.json`:

- Inside `register.shortcuts`, add after `"cameraScan"`:

```json
      "switchCashier": "Switch cashier",
```

- Add a top-level `pinSwitch` namespace right before `"sales"`:

```json
  "pinSwitch": {
    "title": "Switch cashier",
    "pinFor": "PIN for {name}",
    "enterPin": "Enter PIN",
    "noCashiers": "No cashiers with a PIN yet. An admin can set PINs in Users.",
    "back": "Back",
    "switched": "Switched to {name}"
  },
```

- Inside `errors`, add after `"pdfFailed"`:

```json
    "pinIncorrect": "Wrong PIN.",
    "pinLocked": "Too many attempts — PIN locked for 15 minutes.",
    "pinNotSet": "This account has no PIN. An admin can set one.",
    "switchFailed": "Could not switch cashier. Try again.",
```

In `messages/ar.json`, same anchors:

```json
      "switchCashier": "تبديل الكاشير",
```

```json
  "pinSwitch": {
    "title": "تبديل الكاشير",
    "pinFor": "الرقم السري لـ {name}",
    "enterPin": "أدخل الرقم السري",
    "noCashiers": "لا يوجد كاشير لديه رقم سري بعد. يمكن للمدير تعيينه من صفحة المستخدمين.",
    "back": "رجوع",
    "switched": "تم التبديل إلى {name}"
  },
```

```json
    "pinIncorrect": "الرقم السري غير صحيح.",
    "pinLocked": "محاولات كثيرة — تم قفل الرقم السري لمدة ١٥ دقيقة.",
    "pinNotSet": "هذا الحساب ليس له رقم سري. يمكن للمدير تعيينه.",
    "switchFailed": "تعذّر تبديل الكاشير. حاول مرة أخرى.",
```

- [x] **Step 9: Verify**

Run: `npm run typecheck` — exit 0. Run: `npm run lint` — 0 errors.
Manual (dev server): set a PIN for the seed cashier directly once (SQL editor or `select public.set_pin('<cashier-uuid>', '1234');` via the Supabase dashboard — the Users page arrives in Task 5). On the register press `F9` → pick the cashier → type `1234` → toast + the header user menu now shows the cashier, all within ~5s. Wrong PIN 5× → locked toast. Cashier without PIN doesn't appear in the list.

---

### Task 5: User management page (admin)

**Files:**
- Create: `lib/actions/users.ts`
- Create: `app/[locale]/(app)/users/page.tsx`
- Create: `components/users/users-table.tsx`
- Create: `components/users/create-user-dialog.tsx`
- Create: `components/users/set-pin-dialog.tsx`
- Modify: `components/layout/app-sidebar.tsx` (nav item)
- Modify: `messages/en.json`, `messages/ar.json`

**Interfaces:**
- Consumes: `createAdminClient` (Task 4), `set_pin` RPC (Task 1), `requireAdmin`/`getCurrentProfile` (Task 3), schemas from `lib/validation/user.ts` (Task 4), `Numpad` (Task 4).
- Produces: `createStaff`, `setStaffPin`, `setStaffRole`, `toggleStaffActive` — all `(input: unknown) => Promise<ActionResult<void>>`. `/users` page. `SetPinDialog({ userId, name, open, onOpenChange })` (PIN entry UI, mirrors the switch dialog).

- [x] **Step 1: Server actions**

Create `lib/actions/users.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { routing } from "@/i18n/routing";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/supabase/queries/profiles";
import {
  createStaffSchema,
  setStaffPinSchema,
  setStaffRoleSchema,
  toggleStaffActiveSchema,
} from "@/lib/validation/user";
import type { ActionResult } from "./result";

/** Actions return errors instead of redirecting — the UI shows a toast. */
async function currentAdminId(): Promise<string | null> {
  const profile = await getCurrentProfile();
  return profile?.role === "admin" && profile.active ? profile.id : null;
}

function revalidateUsers() {
  for (const locale of routing.locales) {
    revalidatePath(`/${locale}/users`);
  }
}

export async function createStaff(input: unknown): Promise<ActionResult<void>> {
  if (!(await currentAdminId())) return { ok: false, error: "notAuthorized" };
  const parsed = createStaffSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalidInput" };

  const admin = createAdminClient();
  const { data: created, error: authError } = await admin.auth.admin.createUser({
    email: parsed.data.email,
    password: parsed.data.password,
    email_confirm: true,
  });
  if (authError) {
    return { ok: false, error: authError.message.includes("already") ? "emailInUse" : "userCreateFailed" };
  }

  const { error: profileError } = await admin.from("profiles").insert({
    id: created.user.id,
    full_name: parsed.data.fullName,
    role: parsed.data.role,
  });
  if (profileError) {
    // keep auth + profile consistent: roll the auth user back
    await admin.auth.admin.deleteUser(created.user.id);
    return { ok: false, error: "userCreateFailed" };
  }

  if (parsed.data.pin) {
    const { error: pinError } = await admin.rpc("set_pin", {
      p_user_id: created.user.id,
      p_pin: parsed.data.pin,
    });
    if (pinError) return { ok: false, error: "userCreateFailed" };
  }

  revalidateUsers();
  return { ok: true, data: undefined };
}

export async function setStaffPin(input: unknown): Promise<ActionResult<void>> {
  if (!(await currentAdminId())) return { ok: false, error: "notAuthorized" };
  const parsed = setStaffPinSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalidInput" };

  const admin = createAdminClient();
  const { error } = await admin.rpc("set_pin", {
    p_user_id: parsed.data.userId,
    p_pin: parsed.data.pin,
  });
  if (error) return { ok: false, error: "unknown" };

  revalidateUsers();
  return { ok: true, data: undefined };
}

export async function setStaffRole(input: unknown): Promise<ActionResult<void>> {
  const adminId = await currentAdminId();
  if (!adminId) return { ok: false, error: "notAuthorized" };
  const parsed = setStaffRoleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalidInput" };
  if (parsed.data.userId === adminId) return { ok: false, error: "cannotEditSelf" };

  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ role: parsed.data.role })
    .eq("id", parsed.data.userId);
  if (error) return { ok: false, error: "unknown" };

  revalidateUsers();
  return { ok: true, data: undefined };
}

export async function toggleStaffActive(input: unknown): Promise<ActionResult<void>> {
  const adminId = await currentAdminId();
  if (!adminId) return { ok: false, error: "notAuthorized" };
  const parsed = toggleStaffActiveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalidInput" };
  if (parsed.data.userId === adminId) return { ok: false, error: "cannotEditSelf" };

  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ active: parsed.data.active })
    .eq("id", parsed.data.userId);
  if (error) return { ok: false, error: "unknown" };

  revalidateUsers();
  return { ok: true, data: undefined };
}
```

- [x] **Step 2: The page**

Create `app/[locale]/(app)/users/page.tsx`:

```tsx
import { setRequestLocale, getTranslations } from "next-intl/server";
import { requireAdmin } from "@/lib/supabase/queries/profiles";
import { createAdminClient } from "@/lib/supabase/admin";
import { UsersTable } from "@/components/users/users-table";

export default async function UsersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const me = await requireAdmin();

  const t = await getTranslations("users");
  // service-role list: RLS would also work for an admin, but this keeps
  // one source for the page and includes pin state without exposing hashes
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("profiles")
    .select("id, full_name, role, active, pin_hash, created_at")
    .order("created_at");
  if (error) throw error;

  const rows = (data ?? []).map((p) => ({
    id: p.id,
    fullName: p.full_name,
    role: p.role,
    active: p.active,
    hasPin: p.pin_hash !== null, // boolean only — the hash never reaches the client
    createdAt: p.created_at,
  }));

  return (
    <div className="flex w-full flex-col gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <UsersTable rows={rows} selfId={me.id} />
    </div>
  );
}
```

- [x] **Step 3: Table + dialogs**

Create `components/users/users-table.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";
import { KeyRound, MoreHorizontal, Plus, ShieldCheck, UserRoundX, UserRoundCheck } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { setStaffRole, toggleStaffActive } from "@/lib/actions/users";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CreateUserDialog } from "./create-user-dialog";
import { SetPinDialog } from "./set-pin-dialog";

export type StaffRow = {
  id: string;
  fullName: string;
  role: "admin" | "cashier";
  active: boolean;
  hasPin: boolean;
  createdAt: string;
};

export function UsersTable({ rows, selfId }: { rows: StaffRow[]; selfId: string }) {
  const t = useTranslations("users");
  const tErrors = useTranslations("errors");
  const format = useFormatter();
  const router = useRouter();

  const [createOpen, setCreateOpen] = useState(false);
  const [pinTarget, setPinTarget] = useState<StaffRow | null>(null);

  async function run(promise: Promise<{ ok: boolean } & Record<string, unknown>>, doneKey: string) {
    const result = await promise;
    if (!result.ok) {
      toast.error(tErrors(String((result as { error: string }).error)));
      return;
    }
    toast.success(t(doneKey));
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" />
          {t("create")}
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("colName")}</TableHead>
              <TableHead>{t("colRole")}</TableHead>
              <TableHead>{t("colStatus")}</TableHead>
              <TableHead>{t("colPin")}</TableHead>
              <TableHead>{t("colCreated")}</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id} className={row.active ? "" : "opacity-60"}>
                <TableCell className="font-medium">
                  {row.fullName}
                  {row.id === selfId && (
                    <span className="text-muted-foreground ms-2 text-xs">{t("you")}</span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={row.role === "admin" ? "default" : "secondary"}>
                    {t(`roles.${row.role}`)}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge variant={row.active ? "outline" : "destructive"}>
                    {row.active ? t("active") : t("inactive")}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {row.hasPin ? t("pinSet") : t("pinMissing")}
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {format.dateTime(new Date(row.createdAt), { dateStyle: "medium" })}
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label={t("rowActions")}>
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => setPinTarget(row)}>
                        <KeyRound className="size-4" />
                        {t("setPin")}
                      </DropdownMenuItem>
                      {row.id !== selfId && (
                        <>
                          <DropdownMenuItem
                            onSelect={() =>
                              void run(
                                setStaffRole({
                                  userId: row.id,
                                  role: row.role === "admin" ? "cashier" : "admin",
                                }),
                                "roleChanged"
                              )
                            }
                          >
                            <ShieldCheck className="size-4" />
                            {row.role === "admin" ? t("makeCashier") : t("makeAdmin")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() =>
                              void run(
                                toggleStaffActive({ userId: row.id, active: !row.active }),
                                row.active ? "deactivated" : "activated"
                              )
                            }
                          >
                            {row.active ? (
                              <UserRoundX className="size-4" />
                            ) : (
                              <UserRoundCheck className="size-4" />
                            )}
                            {row.active ? t("deactivate") : t("activate")}
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <CreateUserDialog open={createOpen} onOpenChange={setCreateOpen} />
      <SetPinDialog
        userId={pinTarget?.id ?? null}
        name={pinTarget?.fullName ?? ""}
        open={pinTarget !== null}
        onOpenChange={(open) => !open && setPinTarget(null)}
      />
    </div>
  );
}
```

Create `components/users/create-user-dialog.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { createStaff } from "@/lib/actions/users";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function CreateUserDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("users");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    try {
      const result = await createStaff({
        email: form.get("email"),
        password: form.get("password"),
        fullName: form.get("fullName"),
        role: form.get("role"),
        pin: form.get("pin") || "",
      });
      if (!result.ok) {
        toast.error(tErrors(result.error));
        return;
      }
      toast.success(t("created"));
      onOpenChange(false);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !submitting && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("create")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="staff-name">{t("fullName")}</FieldLabel>
              <Input id="staff-name" name="fullName" required maxLength={120} autoFocus />
            </Field>
            <Field>
              <FieldLabel htmlFor="staff-email">{t("email")}</FieldLabel>
              <Input id="staff-email" name="email" type="email" required dir="ltr" />
            </Field>
            <Field>
              <FieldLabel htmlFor="staff-password">{t("password")}</FieldLabel>
              <Input
                id="staff-password"
                name="password"
                type="password"
                required
                minLength={8}
                dir="ltr"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="staff-role">{t("colRole")}</FieldLabel>
              <select
                id="staff-role"
                name="role"
                defaultValue="cashier"
                className="border-input h-9 rounded-md border bg-transparent px-3 text-sm shadow-xs outline-none"
              >
                <option value="cashier">{t("roles.cashier")}</option>
                <option value="admin">{t("roles.admin")}</option>
              </select>
            </Field>
            <Field>
              <FieldLabel htmlFor="staff-pin">{t("pinOptional")}</FieldLabel>
              <Input
                id="staff-pin"
                name="pin"
                inputMode="numeric"
                pattern="\d{4}"
                maxLength={4}
                placeholder="1234"
                dir="ltr"
              />
            </Field>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={submitting}
              >
                {t("cancel")}
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting && <Loader2 className="size-4 animate-spin" />}
                {t("createConfirm")}
              </Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

Create `components/users/set-pin-dialog.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { setStaffPin } from "@/lib/actions/users";
import { Numpad, type NumpadKey } from "@/components/ui/numpad";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function SetPinDialog({
  userId,
  name,
  open,
  onOpenChange,
}: {
  userId: string | null;
  name: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("users");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function handleOpenChange(next: boolean) {
    if (submitting) return;
    if (!next) setPin("");
    onOpenChange(next);
  }

  async function submit(fullPin: string) {
    if (!userId) return;
    setSubmitting(true);
    try {
      const result = await setStaffPin({ userId, pin: fullPin });
      if (!result.ok) {
        toast.error(tErrors(result.error));
        setPin("");
        return;
      }
      toast.success(t("pinSaved", { name }));
      setPin("");
      onOpenChange(false);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  function pressKey(key: NumpadKey) {
    if (submitting) return;
    if (key === "backspace") {
      setPin((p) => p.slice(0, -1));
      return;
    }
    if (!/^\d$/.test(key)) return;
    const next = (pin + key).slice(0, 4);
    setPin(next);
    if (next.length === 4) void submit(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-sm"
        onKeyDown={(e) => {
          if (/^\d$/.test(e.key)) {
            e.preventDefault();
            pressKey(e.key as NumpadKey);
          } else if (e.key === "Backspace") {
            e.preventDefault();
            pressKey("backspace");
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{t("setPinFor", { name })}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col items-center gap-4">
          <div className="flex gap-3 py-2" dir="ltr">
            {[0, 1, 2, 3].map((i) => (
              <span
                key={i}
                className={
                  "size-4 rounded-full border " +
                  (pin.length > i ? "bg-foreground border-foreground" : "border-input")
                }
              />
            ))}
          </div>
          {submitting ? (
            <Loader2 className="text-muted-foreground size-6 animate-spin" />
          ) : (
            <Numpad onKey={pressKey} withDot={false} className="w-full" />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [x] **Step 4: Nav item**

In `components/layout/app-sidebar.tsx`, add `UsersRound` to the lucide import and append to `navItems`:

```tsx
  { key: "users", href: "/users", icon: UsersRound, adminOnly: true },
```

- [x] **Step 5: i18n**

In `messages/en.json`:

- In `nav`, add after `"shifts"`:

```json
    "users": "Users",
```

- Add a top-level `users` namespace right before `"pinSwitch"`:

```json
  "users": {
    "title": "Users",
    "create": "New user",
    "createConfirm": "Create",
    "cancel": "Cancel",
    "fullName": "Full name",
    "email": "Email",
    "password": "Password",
    "pinOptional": "PIN (optional, 4 digits)",
    "colName": "Name",
    "colRole": "Role",
    "colStatus": "Status",
    "colPin": "PIN",
    "colCreated": "Created",
    "roles": { "admin": "Admin", "cashier": "Cashier" },
    "you": "(you)",
    "active": "Active",
    "inactive": "Deactivated",
    "pinSet": "Set",
    "pinMissing": "Not set",
    "rowActions": "Actions",
    "setPin": "Set PIN",
    "setPinFor": "Set PIN for {name}",
    "pinSaved": "PIN saved for {name}",
    "makeAdmin": "Make admin",
    "makeCashier": "Make cashier",
    "roleChanged": "Role updated",
    "deactivate": "Deactivate",
    "activate": "Activate",
    "deactivated": "Account deactivated",
    "activated": "Account activated",
    "created": "User created"
  },
```

- In `errors`, add after `"switchFailed"`:

```json
    "emailInUse": "A user with this email already exists.",
    "userCreateFailed": "Could not create the user. Try again.",
    "cannotEditSelf": "You cannot change your own account here.",
```

In `messages/ar.json`, same anchors:

```json
    "users": "المستخدمون",
```

```json
  "users": {
    "title": "المستخدمون",
    "create": "مستخدم جديد",
    "createConfirm": "إنشاء",
    "cancel": "إلغاء",
    "fullName": "الاسم الكامل",
    "email": "البريد الإلكتروني",
    "password": "كلمة المرور",
    "pinOptional": "الرقم السري (اختياري، ٤ أرقام)",
    "colName": "الاسم",
    "colRole": "الدور",
    "colStatus": "الحالة",
    "colPin": "الرقم السري",
    "colCreated": "تاريخ الإنشاء",
    "roles": { "admin": "مدير", "cashier": "كاشير" },
    "you": "(أنت)",
    "active": "نشط",
    "inactive": "موقوف",
    "pinSet": "معيّن",
    "pinMissing": "غير معيّن",
    "rowActions": "إجراءات",
    "setPin": "تعيين الرقم السري",
    "setPinFor": "تعيين الرقم السري لـ {name}",
    "pinSaved": "تم حفظ الرقم السري لـ {name}",
    "makeAdmin": "ترقية إلى مدير",
    "makeCashier": "تحويل إلى كاشير",
    "roleChanged": "تم تحديث الدور",
    "deactivate": "إيقاف",
    "activate": "تفعيل",
    "deactivated": "تم إيقاف الحساب",
    "activated": "تم تفعيل الحساب",
    "created": "تم إنشاء المستخدم"
  },
```

```json
    "emailInUse": "يوجد مستخدم بهذا البريد الإلكتروني بالفعل.",
    "userCreateFailed": "تعذّر إنشاء المستخدم. حاول مرة أخرى.",
    "cannotEditSelf": "لا يمكنك تعديل حسابك من هنا.",
```

- [x] **Step 6: Verify**

Run: `npm run typecheck` — exit 0. Run: `npm run lint` — 0 errors.
Manual: as admin, `/en/users` lists staff; create a cashier with a PIN → appears; set/reset a PIN via the numpad dialog; deactivate → badge flips, that account can no longer log in (`accountDisabled`) nor appear in the F9 switch list; self row has no role/deactivate items. As cashier, `/en/users` bounces to the register and "Users" is absent from the nav.

---

### Task 6: Shifts core — open/close actions, register gate, sale wiring

**Files:**
- Create: `lib/validation/shift.ts`
- Create: `lib/supabase/queries/shifts.ts`
- Create: `lib/actions/shifts.ts`
- Create: `components/shifts/open-shift-form.tsx`
- Create: `components/register/open-shift-gate.tsx`
- Modify: `lib/actions/sales.ts` (shift lookup)
- Modify: `app/[locale]/(app)/register/page.tsx` (gate)
- Modify: `messages/en.json`, `messages/ar.json`

**Interfaces:**
- Consumes: `close_shift` RPC + trigger (Task 1), `Numpad` + `PinSwitchDialog` (Task 4), `parseEgpToPiasters`/`piastersToEgpInput`/`formatEgp` from `lib/money.ts`.
- Produces: `getActiveShift(): Promise<Shift | null>`, `getShifts(page?: number)` → `{ rows: ShiftListRow[]; total; page; pageCount }`, `getShiftWithSales(id)` → `{ shift: ShiftListRow; cashSales: number; cardSales: number; saleCount: number } | null`, `type ShiftListRow = Tables<"shifts"> & { profiles: Pick<Tables<"profiles">, "full_name"> | null }`; actions `openShift(input): Promise<ActionResult<{ shiftId: string }>>`, `closeShift(input): Promise<ActionResult<{ shiftId: string }>>`; `OpenShiftForm({ onDone? })` client component reused by Task 7's shifts page.

- [x] **Step 1: Validation**

Create `lib/validation/shift.ts`:

```ts
import { z } from "zod";

// piasters, integers — parsed from EGP input client-side
export const openShiftSchema = z.object({
  openingFloat: z.number().int().min(0).max(100_000_000),
});

export const closeShiftSchema = z.object({
  shiftId: z.uuid(),
  counted: z.number().int().min(0).max(1_000_000_000),
});
```

- [x] **Step 2: Queries**

Create `lib/supabase/queries/shifts.ts`:

```ts
import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/lib/supabase/database.types";

export type Shift = Tables<"shifts">;
export type ShiftListRow = Shift & {
  profiles: Pick<Tables<"profiles">, "full_name"> | null;
};

/** The signed-in user's OWN open shift (admins also only get their own —
 *  an explicit cashier_id filter, since RLS shows admins everyone's). */
export async function getActiveShift(): Promise<Shift | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("shifts")
    .select("*")
    .eq("cashier_id", user.id)
    .is("closed_at", null)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export const SHIFTS_PAGE_SIZE = 20;

/** History, newest first. RLS scopes: cashiers see own, admins see all. */
export async function getShifts(page = 1) {
  const supabase = await createClient();
  const from = (page - 1) * SHIFTS_PAGE_SIZE;
  const { data, count, error } = await supabase
    .from("shifts")
    .select("*, profiles(full_name)", { count: "exact" })
    .order("opened_at", { ascending: false })
    .range(from, from + SHIFTS_PAGE_SIZE - 1);
  if (error) throw error;
  return {
    rows: (data ?? []) as ShiftListRow[],
    total: count ?? 0,
    page,
    pageCount: Math.max(1, Math.ceil((count ?? 0) / SHIFTS_PAGE_SIZE)),
  };
}

/** Shift + per-method sale totals for the Z-report (from the sales rows,
 *  which are snapshot-priced — product edits never change a Z-report). */
export async function getShiftWithSales(id: string): Promise<{
  shift: ShiftListRow;
  cashSales: number;
  cardSales: number;
  saleCount: number;
} | null> {
  const supabase = await createClient();
  const { data: shift, error } = await supabase
    .from("shifts")
    .select("*, profiles(full_name)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!shift) return null;

  const { data: sales, error: salesError } = await supabase
    .from("sales")
    .select("total, payment_method")
    .eq("shift_id", id);
  if (salesError) throw salesError;

  let cashSales = 0;
  let cardSales = 0;
  for (const sale of sales ?? []) {
    if (sale.payment_method === "cash") cashSales += Number(sale.total);
    else cardSales += Number(sale.total);
  }
  return {
    shift: shift as ShiftListRow,
    cashSales,
    cardSales,
    saleCount: (sales ?? []).length,
  };
}
```

- [x] **Step 3: Actions**

Create `lib/actions/shifts.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { routing } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import { openShiftSchema, closeShiftSchema } from "@/lib/validation/shift";
import type { ActionResult } from "./result";

function revalidateShiftPages() {
  for (const locale of routing.locales) {
    revalidatePath(`/${locale}/shifts`);
    revalidatePath(`/${locale}/register`);
  }
}

export async function openShift(input: unknown): Promise<ActionResult<{ shiftId: string }>> {
  const parsed = openShiftSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalidInput" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "notAuthorized" };

  const { data, error } = await supabase
    .from("shifts")
    .insert({ cashier_id: user.id, opening_float: parsed.data.openingFloat })
    .select("id")
    .single();
  if (error) {
    return { ok: false, error: error.code === "23505" ? "shiftAlreadyOpen" : "unknown" };
  }

  revalidateShiftPages();
  return { ok: true, data: { shiftId: data.id } };
}

export async function closeShift(input: unknown): Promise<ActionResult<{ shiftId: string }>> {
  const parsed = closeShiftSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalidInput" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("close_shift", {
    p_shift_id: parsed.data.shiftId,
    p_counted: parsed.data.counted,
  });
  if (error) {
    if (error.message.includes("not your shift")) return { ok: false, error: "notAuthorized" };
    return { ok: false, error: "shiftCloseFailed" };
  }

  revalidateShiftPages();
  return { ok: true, data: { shiftId: parsed.data.shiftId } };
}
```

- [x] **Step 4: Wire the shift into checkout**

In `lib/actions/sales.ts`, replace the block from `const supabase = await createClient();` through the `.rpc("create_sale", …)` call with:

```ts
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "notAuthorized" };

  // The sale is recorded against the cashier's own open shift — looked up
  // server-side so the client can neither omit nor forge it. The DB trigger
  // (sales_validate_shift) re-checks ownership + openness transactionally.
  const { data: shift, error: shiftError } = await supabase
    .from("shifts")
    .select("id")
    .eq("cashier_id", user.id)
    .is("closed_at", null)
    .maybeSingle();
  if (shiftError) return { ok: false, error: "checkoutFailed" };
  if (!shift) return { ok: false, error: "noOpenShift" };

  // ONE transaction server-side: sale + snapshot items + stock + movements.
  const { data, error } = await supabase.rpc("create_sale", {
    p_items: parsed.data.items,
    p_payment_method: parsed.data.payment_method,
    p_shift_id: shift.id,
    p_amount_tendered: parsed.data.payment_method === "cash" ? parsed.data.amount_tendered : null,
    p_cashier_id: null,
  });
```

and add to `mapSaleError`, before the final `return`:

```ts
  if (message.includes("no open shift")) return "noOpenShift";
```

- [x] **Step 5: Open-shift form (shared) and the register gate**

Create `components/shifts/open-shift-form.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Play } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { openShift } from "@/lib/actions/shifts";
import { formatEgp, parseEgpToPiasters } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Numpad, type NumpadKey } from "@/components/ui/numpad";

/** Opening-float entry. Used by the register gate and the shifts page. */
export function OpenShiftForm() {
  const t = useTranslations("shifts");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const router = useRouter();

  const [floatInput, setFloatInput] = useState("0");
  const [submitting, setSubmitting] = useState(false);

  const piasters = parseEgpToPiasters(floatInput);

  function pressKey(key: NumpadKey) {
    if (key === "backspace") setFloatInput((v) => v.slice(0, -1));
    else if (key === "." && floatInput.includes(".")) return;
    else setFloatInput((v) => (v === "0" && key !== "." ? key : v + key));
  }

  async function submit() {
    if (submitting || piasters === null) return;
    setSubmitting(true);
    try {
      const result = await openShift({ openingFloat: piasters });
      if (!result.ok) {
        toast.error(tErrors(result.error));
        return;
      }
      toast.success(t("opened", { float: formatEgp(piasters, locale) }));
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex w-full max-w-xs flex-col gap-3">
      <Input
        dir="ltr"
        inputMode="decimal"
        autoFocus
        value={floatInput}
        onChange={(e) => setFloatInput(e.target.value)}
        onFocus={(e) => e.target.select()}
        onKeyDown={(e) => e.key === "Enter" && void submit()}
        className="h-12 text-center text-xl tabular-nums"
        aria-label={t("openingFloat")}
      />
      <Numpad onKey={pressKey} />
      <Button onClick={() => void submit()} disabled={submitting || piasters === null} className="h-12">
        {submitting ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
        {t("open")}
      </Button>
    </div>
  );
}
```

Create `components/register/open-shift-gate.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Clock, UserRoundCog } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { OpenShiftForm } from "@/components/shifts/open-shift-form";
import { PinSwitchDialog, type SwitchableCashier } from "./pin-switch-dialog";

/** Blocks the register until the ACTIVE cashier has an open shift.
 *  Switching cashiers is still possible from here (relief mid-shift). */
export function OpenShiftGate({ cashiers }: { cashiers: SwitchableCashier[] }) {
  const t = useTranslations("shifts");
  const [switchOpen, setSwitchOpen] = useState(false);

  return (
    <div className="flex flex-1 items-center justify-center">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <Clock className="text-muted-foreground size-8" />
          <CardTitle>{t("gateTitle")}</CardTitle>
          <CardDescription>{t("gateDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4">
          <span className="text-muted-foreground text-sm">{t("openingFloat")}</span>
          <OpenShiftForm />
          <Button variant="ghost" size="sm" onClick={() => setSwitchOpen(true)}>
            <UserRoundCog className="size-4" />
            {t("switchInstead")}
          </Button>
        </CardContent>
      </Card>
      <PinSwitchDialog cashiers={cashiers} open={switchOpen} onOpenChange={setSwitchOpen} />
    </div>
  );
}
```

- [x] **Step 6: Gate the register page**

Replace the contents of `app/[locale]/(app)/register/page.tsx` with:

```tsx
import { setRequestLocale } from "next-intl/server";
import { getCurrentProfile, getSwitchableCashiers } from "@/lib/supabase/queries/profiles";
import { getActiveShift } from "@/lib/supabase/queries/shifts";
import { Register } from "@/components/register/register";
import { OpenShiftGate } from "@/components/register/open-shift-gate";

export default async function RegisterPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [profile, shift, cashiers] = await Promise.all([
    getCurrentProfile(),
    getActiveShift(),
    getSwitchableCashiers(),
  ]);

  // no open shift → the register is blocked until one is opened
  if (!shift) return <OpenShiftGate cashiers={cashiers} />;

  return <Register isAdmin={profile?.role === "admin"} cashiers={cashiers} />;
}
```

- [x] **Step 7: i18n**

In `messages/en.json`, add a top-level `shifts` namespace right before `"users"` (Task 7 extends this same namespace — add all keys now):

```json
  "shifts": {
    "title": "Shifts",
    "gateTitle": "No open shift",
    "gateDescription": "Enter your opening cash float to start selling.",
    "switchInstead": "Switch cashier instead",
    "openingFloat": "Opening float",
    "open": "Open shift",
    "opened": "Shift opened with {float}",
    "current": "Current shift",
    "noneOpen": "You have no open shift.",
    "openedAt": "Opened",
    "closedAt": "Closed",
    "stillOpen": "Still open",
    "close": "Close shift",
    "countedCash": "Counted cash",
    "closeConfirm": "Count & close",
    "colCashier": "Cashier",
    "colOpened": "Opened",
    "colClosed": "Closed",
    "colFloat": "Float",
    "colExpected": "Expected",
    "colCounted": "Counted",
    "colOverShort": "Over / short",
    "empty": "No shifts yet.",
    "pageOf": "Page {page} of {pageCount}",
    "previousPage": "Previous page",
    "nextPage": "Next page",
    "zReport": "Z-report",
    "duration": "Duration",
    "saleCount": "Sales",
    "cashSales": "Cash sales",
    "cardSales": "Card sales",
    "totalSales": "Total sales",
    "expectedCash": "Expected cash",
    "overShort": "Over / short",
    "shiftStillOpen": "This shift is still open — the Z-report is available after closing."
  },
```

In `errors` (after `"cannotEditSelf"`):

```json
    "noOpenShift": "No open shift — open a shift before selling.",
    "shiftAlreadyOpen": "You already have an open shift.",
    "shiftCloseFailed": "Could not close the shift. Try again.",
```

In `messages/ar.json`, same anchors:

```json
  "shifts": {
    "title": "الورديات",
    "gateTitle": "لا توجد وردية مفتوحة",
    "gateDescription": "أدخل رصيد الدرج الافتتاحي لبدء البيع.",
    "switchInstead": "تبديل الكاشير بدلًا من ذلك",
    "openingFloat": "الرصيد الافتتاحي",
    "open": "فتح وردية",
    "opened": "تم فتح الوردية برصيد {float}",
    "current": "الوردية الحالية",
    "noneOpen": "ليس لديك وردية مفتوحة.",
    "openedAt": "بدأت",
    "closedAt": "أُغلقت",
    "stillOpen": "ما زالت مفتوحة",
    "close": "إغلاق الوردية",
    "countedCash": "النقدية المعدودة",
    "closeConfirm": "عدّ وإغلاق",
    "colCashier": "الكاشير",
    "colOpened": "البداية",
    "colClosed": "النهاية",
    "colFloat": "الرصيد",
    "colExpected": "المتوقع",
    "colCounted": "المعدود",
    "colOverShort": "زيادة / عجز",
    "empty": "لا توجد ورديات بعد.",
    "pageOf": "صفحة {page} من {pageCount}",
    "previousPage": "الصفحة السابقة",
    "nextPage": "الصفحة التالية",
    "zReport": "تقرير الوردية",
    "duration": "المدة",
    "saleCount": "عدد المبيعات",
    "cashSales": "مبيعات نقدية",
    "cardSales": "مبيعات بالبطاقة",
    "totalSales": "إجمالي المبيعات",
    "expectedCash": "النقدية المتوقعة",
    "overShort": "زيادة / عجز",
    "shiftStillOpen": "هذه الوردية ما زالت مفتوحة — تقرير الوردية يتاح بعد الإغلاق."
  },
```

```json
    "noOpenShift": "لا توجد وردية مفتوحة — افتح وردية قبل البيع.",
    "shiftAlreadyOpen": "لديك وردية مفتوحة بالفعل.",
    "shiftCloseFailed": "تعذّر إغلاق الوردية. حاول مرة أخرى.",
```

- [x] **Step 8: Verify**

Run: `npm run typecheck` — exit 0. Run: `npm run test:shifts && npm run test:rls` — all pass.
Manual: log in as a cashier with no open shift → register shows the gate; open with float 500 → register appears; complete a sale → works; F9-switch to a cashier without an open shift → gate appears for THEM (the first cashier's shift stays open — switch back to confirm).

---

### Task 7: Shifts pages & printable Z-report

**Files:**
- Create: `lib/receipts/z-report.ts`
- Create: `scripts/test-zreport.ts`
- Create: `components/receipts/receipt-primitives.tsx`
- Create: `components/receipts/print-button.tsx`
- Create: `components/shifts/z-report-80mm.tsx`
- Create: `components/shifts/close-shift-dialog.tsx`
- Create: `app/[locale]/(app)/shifts/[id]/page.tsx`
- Modify: `app/[locale]/(app)/shifts/page.tsx` (replace placeholder)
- Modify: `components/receipts/receipt-80mm.tsx` (use shared primitives)
- Modify: `package.json` (script)

**Interfaces:**
- Consumes: `getShifts`/`getShiftWithSales`/`ShiftListRow` + `closeShift` action (Task 6), `STORE_INFO` + `StoreInfo` from `lib/receipts/`, the `.receipt-print-area` CSS contract from Phase 4, `Numpad` (Task 4).
- Produces: `buildZReport(shift: ShiftForZReport, agg: { cashSales: number; cardSales: number; saleCount: number }): ZReportData`; `<ZReport80mm report={ZReportData} />`; `<PrintButton />`; shared `<Row>`/`<Dashes>` receipt primitives.

- [x] **Step 1: Write the failing Z-report transform test**

Create `scripts/test-zreport.ts`:

```ts
/**
 * Z-report builder tests — run with: npm run test:zreport
 * expected_cash comes from close_shift (SQL); overShort = counted − expected.
 */
import { buildZReport, type ShiftForZReport } from "../lib/receipts/z-report";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!cond) failures++;
}

function fakeShift(over: Partial<ShiftForZReport>): ShiftForZReport {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    cashier_id: "00000000-0000-0000-0000-000000000002",
    opened_at: "2026-07-06T08:00:00Z",
    closed_at: "2026-07-06T16:30:00Z",
    opening_float: 50000,
    closing_counted: 156000,
    expected_cash: 156300,
    created_at: "2026-07-06T08:00:00Z",
    profiles: { full_name: "Test Cashier" },
    ...over,
  };
}

// closed shift: over/short is signed (counted − expected → short = negative)
{
  const r = buildZReport(fakeShift({}), { cashSales: 106300, cardSales: 40000, saleCount: 12 });
  check("expected passthrough", r.expectedCash === 156300);
  check("counted passthrough", r.counted === 156000);
  check("overShort = counted − expected (short → negative)", r.overShort === -300);
  check("totalSales = cash + card", r.totalSales === 146300);
  check("saleCount passthrough", r.saleCount === 12);
  check("cashier name from join", r.cashierName === "Test Cashier");
  check("store info attached", r.store.nameEn.length > 0);
}

// over: counted above expected → positive
{
  const r = buildZReport(fakeShift({ closing_counted: 156500 }), {
    cashSales: 106300,
    cardSales: 0,
    saleCount: 5,
  });
  check("overShort positive when over", r.overShort === 200);
}

// open shift: closing fields are null
{
  const r = buildZReport(
    fakeShift({ closed_at: null, closing_counted: null, expected_cash: null }),
    { cashSales: 0, cardSales: 0, saleCount: 0 }
  );
  check("open shift → null expected/counted/overShort", 
    r.expectedCash === null && r.counted === null && r.overShort === null);
  check("open shift → closedAt null", r.closedAt === null);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failing`);
  process.exit(1);
}
console.log("\nAll Z-report tests passed.");
```

Add to `package.json` scripts (after `"test:rls"`):

```json
    "test:rls": "tsx scripts/test-rls.ts",
    "test:zreport": "tsx scripts/test-zreport.ts"
```

Run: `npm run test:zreport` — expected: FAIL, `Cannot find module '../lib/receipts/z-report'`.

- [x] **Step 2: Implement the transform**

Create `lib/receipts/z-report.ts`:

```ts
import type { Tables } from "@/lib/supabase/database.types";
import { STORE_INFO } from "./store-info";
import type { StoreInfo } from "./types";

// Defined here (not in the server-only queries module) so the tsx test
// script and client components can import it — same pattern as SaleForReceipt.
export type ShiftForZReport = Tables<"shifts"> & {
  profiles: Pick<Tables<"profiles">, "full_name"> | null;
};

export type ZReportData = {
  store: StoreInfo;
  shiftId: string;
  cashierName: string | null;
  openedAt: string;
  closedAt: string | null;
  saleCount: number;
  openingFloat: number; // piasters
  cashSales: number;
  cardSales: number;
  totalSales: number;
  expectedCash: number | null; // set by close_shift; null while open
  counted: number | null;
  /** counted − expected: negative = short, positive = over */
  overShort: number | null;
};

export function buildZReport(
  shift: ShiftForZReport,
  agg: { cashSales: number; cardSales: number; saleCount: number }
): ZReportData {
  const expected = shift.expected_cash === null ? null : Number(shift.expected_cash);
  const counted = shift.closing_counted === null ? null : Number(shift.closing_counted);
  return {
    store: STORE_INFO,
    shiftId: shift.id,
    cashierName: shift.profiles?.full_name ?? null,
    openedAt: shift.opened_at,
    closedAt: shift.closed_at,
    saleCount: agg.saleCount,
    openingFloat: Number(shift.opening_float),
    cashSales: agg.cashSales,
    cardSales: agg.cardSales,
    totalSales: agg.cashSales + agg.cardSales,
    expectedCash: expected,
    counted,
    overShort: expected !== null && counted !== null ? counted - expected : null,
  };
}
```

Run: `npm run test:zreport` — expected: all PASS.

- [x] **Step 3: Shared receipt primitives + PrintButton**

Create `components/receipts/receipt-primitives.tsx`:

```tsx
/** Label/value line; money values keep LTR digits inside the RTL layout. */
export function Row({
  label,
  value,
  ltr = true,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  ltr?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="min-w-0">{label}</span>
      {ltr ? (
        <span className="tabular-nums" dir="ltr">
          {value}
        </span>
      ) : (
        <span>{value}</span>
      )}
    </div>
  );
}

export function Dashes() {
  return <div className="my-1 border-t border-dashed border-black" />;
}
```

In `components/receipts/receipt-80mm.tsx`: add `import { Row, Dashes } from "./receipt-primitives";` and DELETE the private `Row` and `Dashes` function definitions at the bottom of the file (the JSX stays identical).

Create `components/receipts/print-button.tsx`:

```tsx
"use client";

import { Printer } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

export function PrintButton() {
  const t = useTranslations("receipt");
  return (
    <Button onClick={() => window.print()} className="print:hidden">
      <Printer className="size-4" />
      {t("print")}
    </Button>
  );
}
```

- [x] **Step 4: Z-report 80mm view**

Create `components/shifts/z-report-80mm.tsx`:

```tsx
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { formatEgp } from "@/lib/money";
import type { ZReportData } from "@/lib/receipts/z-report";
import { Row, Dashes } from "@/components/receipts/receipt-primitives";

/** Printable end-of-shift Z-report — same 80mm/.receipt-print-area seam
 *  as sale receipts, so the future ESC/POS driver covers both. */
export function ZReport80mm({ report }: { report: ZReportData }) {
  const t = useTranslations("shifts");
  const format = useFormatter();
  const locale = useLocale();
  const isAr = locale === "ar";
  const money = (v: number) => formatEgp(v, locale);
  const dateTime = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: "short", timeStyle: "short" });

  return (
    <div className="w-[80mm] bg-white px-[4mm] py-[5mm] text-[11px] leading-snug text-black">
      <div className="text-center">
        <div className="text-sm font-bold">{isAr ? report.store.nameAr : report.store.nameEn}</div>
        <div className="font-semibold">{t("zReport")}</div>
      </div>

      <Dashes />

      {report.cashierName && <Row label={t("colCashier")} value={report.cashierName} ltr={false} />}
      <Row label={t("openedAt")} value={dateTime(report.openedAt)} />
      {report.closedAt && <Row label={t("closedAt")} value={dateTime(report.closedAt)} />}
      {report.closedAt && (
        <Row label={t("duration")} value={formatDuration(report.openedAt, report.closedAt)} />
      )}
      <Row label={t("saleCount")} value={String(report.saleCount)} />

      <Dashes />

      <Row label={t("openingFloat")} value={money(report.openingFloat)} />
      <Row label={t("cashSales")} value={money(report.cashSales)} />
      <Row label={t("cardSales")} value={money(report.cardSales)} />
      <Row label={t("totalSales")} value={money(report.totalSales)} />

      <Dashes />

      {report.expectedCash !== null && (
        <Row label={t("expectedCash")} value={money(report.expectedCash)} />
      )}
      {report.counted !== null && <Row label={t("countedCash")} value={money(report.counted)} />}
      {report.overShort !== null && (
        <div className="mt-1 flex items-baseline justify-between border-t border-dashed border-black pt-1 text-sm font-bold">
          <span>{t("overShort")}</span>
          <span className="tabular-nums" dir="ltr">
            {report.overShort > 0 ? "+" : ""}
            {money(report.overShort)}
          </span>
        </div>
      )}
    </div>
  );
}

function formatDuration(openedAt: string, closedAt: string): string {
  const mins = Math.max(
    0,
    Math.round((new Date(closedAt).getTime() - new Date(openedAt).getTime()) / 60000)
  );
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}
```

- [x] **Step 5: Close-shift dialog**

Create `components/shifts/close-shift-dialog.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Square } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { closeShift } from "@/lib/actions/shifts";
import { parseEgpToPiasters } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Numpad, type NumpadKey } from "@/components/ui/numpad";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/** Counted-cash entry → close_shift RPC → navigate to the Z-report. */
export function CloseShiftDialog({ shiftId }: { shiftId: string }) {
  const t = useTranslations("shifts");
  const tErrors = useTranslations("errors");
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [countedInput, setCountedInput] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const counted = parseEgpToPiasters(countedInput);

  function pressKey(key: NumpadKey) {
    if (key === "backspace") setCountedInput((v) => v.slice(0, -1));
    else if (key === "." && countedInput.includes(".")) return;
    else setCountedInput((v) => v + key);
  }

  async function submit() {
    if (submitting || counted === null) return;
    setSubmitting(true);
    try {
      const result = await closeShift({ shiftId, counted });
      if (!result.ok) {
        toast.error(tErrors(result.error));
        return;
      }
      setOpen(false);
      router.push(`/shifts/${result.data.shiftId}`);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !submitting && setOpen(next)}>
      <DialogTrigger asChild>
        <Button variant="destructive">
          <Square className="size-4" />
          {t("close")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("countedCash")}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Input
            dir="ltr"
            inputMode="decimal"
            autoFocus
            value={countedInput}
            onChange={(e) => setCountedInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
            className="h-12 text-center text-xl tabular-nums"
            aria-label={t("countedCash")}
          />
          <Numpad onKey={pressKey} />
        </div>
        <DialogFooter>
          <Button onClick={() => void submit()} disabled={submitting || counted === null} className="w-full">
            {submitting && <Loader2 className="size-4 animate-spin" />}
            {t("closeConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [x] **Step 6: The shifts page**

Replace the ENTIRE contents of `app/[locale]/(app)/shifts/page.tsx` with:

```tsx
import { setRequestLocale, getTranslations, getFormatter } from "next-intl/server";
import { ChevronLeft, ChevronRight, ReceiptText } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { getActiveShift, getShifts } from "@/lib/supabase/queries/shifts";
import { formatEgp } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CloseShiftDialog } from "@/components/shifts/close-shift-dialog";
import { OpenShiftForm } from "@/components/shifts/open-shift-form";

export default async function ShiftsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);

  const [t, format, active, result] = await Promise.all([
    getTranslations("shifts"),
    getFormatter(),
    getActiveShift(),
    getShifts(page),
  ]);

  const money = (v: number | null) => (v === null ? "—" : formatEgp(Number(v), locale));
  const overShort = (expected: number | null, counted: number | null) => {
    if (expected === null || counted === null) return null;
    return Number(counted) - Number(expected);
  };

  return (
    <div className="flex w-full flex-col gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">{t("current")}</CardTitle>
          {active && <CloseShiftDialog shiftId={active.id} />}
        </CardHeader>
        <CardContent>
          {active ? (
            <div className="text-muted-foreground flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <span>
                {t("openedAt")}:{" "}
                {format.dateTime(new Date(active.opened_at), {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </span>
              <span dir="ltr" className="tabular-nums">
                {t("openingFloat")}: {money(active.opening_float)}
              </span>
            </div>
          ) : (
            <div className="flex flex-col items-start gap-3">
              <p className="text-muted-foreground text-sm">{t("noneOpen")}</p>
              <OpenShiftForm />
            </div>
          )}
        </CardContent>
      </Card>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("colCashier")}</TableHead>
              <TableHead>{t("colOpened")}</TableHead>
              <TableHead>{t("colClosed")}</TableHead>
              <TableHead className="text-end">{t("colFloat")}</TableHead>
              <TableHead className="text-end">{t("colExpected")}</TableHead>
              <TableHead className="text-end">{t("colCounted")}</TableHead>
              <TableHead className="text-end">{t("colOverShort")}</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-muted-foreground h-24 text-center">
                  {t("empty")}
                </TableCell>
              </TableRow>
            )}
            {result.rows.map((shift) => {
              const diff = overShort(shift.expected_cash, shift.closing_counted);
              return (
                <TableRow key={shift.id}>
                  <TableCell>{shift.profiles?.full_name ?? "—"}</TableCell>
                  <TableCell>
                    {format.dateTime(new Date(shift.opened_at), {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </TableCell>
                  <TableCell>
                    {shift.closed_at
                      ? format.dateTime(new Date(shift.closed_at), {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })
                      : t("stillOpen")}
                  </TableCell>
                  <TableCell className="text-end tabular-nums" dir="ltr">
                    {money(shift.opening_float)}
                  </TableCell>
                  <TableCell className="text-end tabular-nums" dir="ltr">
                    {money(shift.expected_cash)}
                  </TableCell>
                  <TableCell className="text-end tabular-nums" dir="ltr">
                    {money(shift.closing_counted)}
                  </TableCell>
                  <TableCell
                    className={
                      "text-end tabular-nums " +
                      (diff === null
                        ? ""
                        : diff < 0
                          ? "text-destructive"
                          : "text-green-600 dark:text-green-500")
                    }
                    dir="ltr"
                  >
                    {diff === null ? "—" : `${diff > 0 ? "+" : ""}${formatEgp(diff, locale)}`}
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" asChild aria-label={t("zReport")}>
                      <Link href={`/shifts/${shift.id}`}>
                        <ReceiptText className="size-4" />
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {result.pageCount > 1 && (
        <div className="flex items-center justify-end gap-2">
          <span className="text-muted-foreground text-sm">
            {t("pageOf", { page: result.page, pageCount: result.pageCount })}
          </span>
          {result.page <= 1 ? (
            <Button variant="outline" size="icon" disabled aria-label={t("previousPage")}>
              <ChevronLeft className="size-4 rtl:rotate-180" />
            </Button>
          ) : (
            <Button variant="outline" size="icon" asChild aria-label={t("previousPage")}>
              <Link href={`/shifts?page=${result.page - 1}`}>
                <ChevronLeft className="size-4 rtl:rotate-180" />
              </Link>
            </Button>
          )}
          {result.page >= result.pageCount ? (
            <Button variant="outline" size="icon" disabled aria-label={t("nextPage")}>
              <ChevronRight className="size-4 rtl:rotate-180" />
            </Button>
          ) : (
            <Button variant="outline" size="icon" asChild aria-label={t("nextPage")}>
              <Link href={`/shifts?page=${result.page + 1}`}>
                <ChevronRight className="size-4 rtl:rotate-180" />
              </Link>
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
```

- [x] **Step 7: The Z-report page**

Create `app/[locale]/(app)/shifts/[id]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { getShiftWithSales } from "@/lib/supabase/queries/shifts";
import { buildZReport } from "@/lib/receipts/z-report";
import { ZReport80mm } from "@/components/shifts/z-report-80mm";
import { PrintButton } from "@/components/receipts/print-button";

export default async function ZReportPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const [t, data] = await Promise.all([getTranslations("shifts"), getShiftWithSales(id)]);
  if (!data) notFound();

  const report = buildZReport(data.shift, data);

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">{t("zReport")}</h1>
      {report.closedAt === null ? (
        <p className="text-muted-foreground text-sm">{t("shiftStillOpen")}</p>
      ) : (
        <div className="print:hidden">
          <PrintButton />
        </div>
      )}
      <div className="receipt-print-area self-center overflow-hidden rounded-md border shadow-sm">
        <ZReport80mm report={report} />
      </div>
    </div>
  );
}
```

- [x] **Step 8: Verify**

Run: `npm run typecheck && npm run lint && npm run test:zreport && npm run test:receipt` — all pass (test:receipt guards the primitives refactor).
Manual: `/en/shifts` shows the current shift + history; close the open shift with a counted amount → lands on the Z-report; expected = float + cash sales; over/short signed and colored; Print shows ONLY the 80mm Z-report; `/ar/shifts` renders RTL. A cashier sees only their own rows; admin sees everyone's.

---

### Task 8: Checkout UX — 2-key exact-cash sale + touch targets

**Files:**
- Modify: `components/register/checkout-dialog.tsx` (full rewrite)

**Interfaces:**
- Consumes: `Numpad` (Task 4), `createSale` (Task 6 version), `piastersToEgpInput`/`parseEgpToPiasters`/`formatEgp`.
- Produces: same external contract — `CheckoutDialog({ open, onOpenChange, totals })`; no caller changes.

- [x] **Step 1: Rewrite the dialog**

Replace the ENTIRE contents of `components/register/checkout-dialog.tsx` with:

```tsx
"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Banknote, CreditCard, Loader2 } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { createSale } from "@/lib/actions/sales";
import { formatEgp, parseEgpToPiasters, piastersToEgpInput } from "@/lib/money";
import { useCart, toSaleItems, type CartTotals } from "@/lib/store/cart";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Numpad, type NumpadKey } from "@/components/ui/numpad";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// EGP notes a cashier reaches for
const QUICK_NOTES = [5000, 10000, 20000] as const; // piasters: 50, 100, 200

export function CheckoutDialog({
  open,
  onOpenChange,
  totals,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  totals: CartTotals;
}) {
  // submitting lives OUT here so Esc/overlay can't close (and unmount) the
  // form while a sale is in flight — clearCart + navigation must still run
  const [submitting, setSubmitting] = useState(false);

  return (
    <Dialog open={open} onOpenChange={(next) => !submitting && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        {/* mounted only while open → state re-initializes each checkout,
            so the exact total is prefilled without any effect (the React
            version of v-if forcing a fresh component instance in Vue) */}
        {open && (
          <CheckoutForm
            onOpenChange={onOpenChange}
            totals={totals}
            submitting={submitting}
            setSubmitting={setSubmitting}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CheckoutForm({
  onOpenChange,
  totals,
  submitting,
  setSubmitting,
}: {
  onOpenChange: (open: boolean) => void;
  totals: CartTotals;
  submitting: boolean;
  setSubmitting: (v: boolean) => void;
}) {
  const t = useTranslations("register.checkoutDialog");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const router = useRouter();
  const clearCart = useCart((s) => s.clear);

  const [method, setMethod] = useState<"cash" | "card">("cash");
  // prefilled with the exact total: F2 → Enter completes the sale in 2 keys;
  // the input is selected on focus, so typing digits overwrites the prefill
  const [tenderedInput, setTenderedInput] = useState(() => piastersToEgpInput(totals.total));

  const tendered = parseEgpToPiasters(tenderedInput);
  const change = tendered !== null ? tendered - totals.total : null;
  const cashInvalid = method === "cash" && (tendered === null || tendered < totals.total);

  function pressKey(key: NumpadKey) {
    if (key === "backspace") setTenderedInput((v) => v.slice(0, -1));
    else if (key === "." && tenderedInput.includes(".")) return;
    else setTenderedInput((v) => v + key);
  }

  async function confirm() {
    if (submitting || totals.lines.length === 0) return;
    if (method === "cash" && cashInvalid) return;
    setSubmitting(true);
    try {
      const result = await createSale({
        items: toSaleItems(totals),
        payment_method: method,
        amount_tendered: method === "cash" ? tendered : null,
      });
      if (!result.ok) {
        toast.error(tErrors(result.error));
        return; // cart stays intact — fix and retry
      }
      clearCart();
      toast.success(t("saleDone", { number: result.data.saleNumber }));
      onOpenChange(false);
      router.push(`/receipts/${result.data.saleId}?new=1`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("title")}</DialogTitle>
      </DialogHeader>

      <div className="flex items-baseline justify-between">
        <span className="text-muted-foreground">{t("amountDue")}</span>
        <span className="text-4xl font-bold tabular-nums" dir="ltr">
          {formatEgp(totals.total, locale)}
        </span>
      </div>

      <Tabs value={method} onValueChange={(v) => setMethod(v as "cash" | "card")}>
        <TabsList className="h-11 w-full">
          <TabsTrigger value="cash" className="flex-1 gap-2 text-base">
            <Banknote className="size-5" />
            {t("cash")}
          </TabsTrigger>
          <TabsTrigger value="card" className="flex-1 gap-2 text-base">
            <CreditCard className="size-5" />
            {t("card")}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {method === "cash" ? (
        <div className="flex flex-col gap-3">
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="h-11 flex-1"
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => setTenderedInput(piastersToEgpInput(totals.total))}
            >
              {t("exact")}
            </Button>
            {QUICK_NOTES.map((note) => (
              <Button
                key={note}
                variant="outline"
                className="h-11 flex-1 tabular-nums"
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => setTenderedInput(piastersToEgpInput(note))}
              >
                {note / 100}
              </Button>
            ))}
          </div>
          <Input
            dir="ltr"
            inputMode="decimal"
            autoFocus
            value={tenderedInput}
            onChange={(e) => setTenderedInput(e.target.value)}
            onFocus={(e) => e.target.select()}
            onKeyDown={(e) => e.key === "Enter" && void confirm()}
            className="h-14 text-center text-2xl tabular-nums"
            aria-label={t("tendered")}
          />
          <Numpad onKey={pressKey} />
          <Separator />
          <div className="flex items-baseline justify-between">
            <span className="text-muted-foreground">{t("change")}</span>
            <span
              className={
                "text-3xl font-semibold tabular-nums " +
                (change !== null && change < 0
                  ? "text-destructive"
                  : "text-green-600 dark:text-green-500")
              }
              dir="ltr"
            >
              {change === null ? "—" : formatEgp(change, locale)}
            </span>
          </div>
        </div>
      ) : (
        <p className="text-muted-foreground py-2 text-sm">{t("cardHint")}</p>
      )}

      <DialogFooter>
        <Button
          variant="outline"
          className="h-12"
          onClick={() => onOpenChange(false)}
          disabled={submitting}
        >
          {t("cancel")}
        </Button>
        <Button
          onClick={() => void confirm()}
          disabled={submitting || cashInvalid}
          className="h-12 min-w-36 text-base"
        >
          {submitting && <Loader2 className="size-4 animate-spin" />}
          {t("confirm")}
        </Button>
      </DialogFooter>
    </>
  );
}
```

- [x] **Step 2: Verify**

Run: `npm run typecheck && npm run lint` — clean.
Manual: scan items → `F2` → the tendered field shows the exact total, selected, change 0.00 → `Enter` completes the sale (2 keys). Reopen: type `200` — typing replaced the prefill; change updates. Tap the on-screen numpad — digits append, hardware Enter still confirms. Buttons are comfortably tappable; test in AR/RTL.

---

### Task 9: Phase verification & wrap-up

**Files:** none — verification and the phase-end report.

- [ ] **Step 1: Full check suite**

Run each; all must pass:
- `npm run typecheck` — exit 0
- `npm run lint` — 0 errors
- `npm run test:cart` — all PASS (regression)
- `npm run test:receipt` — all PASS (regression, primitives refactor)
- `npm run test:zreport` — all PASS
- `npm run test:shifts` — all PASS
- `npm run test:rls` — all PASS
- `npm run build` — compiles clean

- [ ] **Step 2: Manual "done when" walkthrough (dev server, migration pushed)**

1. **Role gate (API, not UI):** log in as cashier → `/en/products`, `/en/reports`, `/en/users` all bounce to the register; sidebar shows only Register/Sales/Shifts; `test:rls` covers the SQL level.
2. **Shift gate + Z-report:** cashier with no shift → register blocked; open with float 500 EGP → sell 2 cash + 1 card sale → close counting the drawer → Z-report shows expected cash = 500 + cash sales exactly; over/short matches the deliberate miscount; prints at 80mm only.
3. **PIN switch < 5s:** F9 → pick cashier → 4 digits → header shows the new cashier; time it. Wrong PIN 5× → locked for 15 min; a locked or PIN-less account can't switch.
4. **Users:** create a cashier with PIN; deactivate → login blocked (`accountDisabled`), switch list drops them; reactivate → back.
5. **Checkout:** F2 → Enter completes an exact-cash sale; numpad works by touch; AR/RTL clean everywhere.

- [ ] **Step 3: Phase-end report**

Write the phase summary in the final message: what was built (file list), condensed manual test steps, and 2–3 React↔Vue notes — suggested: (a) Next `proxy.ts` middleware vs Nuxt global route middleware (`defineNuxtRouteMiddleware`); (b) service-role server actions vs Nuxt server routes + private runtime config; (c) remounting `{open && <CheckoutForm/>}` to reset dialog state vs Vue's `v-if` destroying/recreating component instances.

---

## Self-review notes

- **Spec coverage:** login + middleware + role redirect (T3), RLS verification at API level (T2), PIN switch with real session swap + lockout (T1/T4), minimal user management (T5), shift open/close + register gate + `create_sale` shift validation via trigger (T1/T6), printable Z-report from snapshots via the receipt seam (T7), checkout UX revision (T8), AR/EN + keyboard throughout, done-when gates (T9). One deliberate refinement over the spec: sale-shift validation is a `BEFORE INSERT` trigger rather than editing the 190-line `create_sale` body — same guarantee, covers all insert paths, far smaller migration; `p_shift_id` keeps its `default null` but a null now always fails with a clear error.
- **Deviation (small):** the spec's "UserMenu entry" for PIN switch is dropped — the switch dialog lives on the register (button + F9), which is the only place switching matters; a global menu entry would need the dialog mounted app-wide for no real gain.
- **Type consistency:** `SwitchableCashier` defined once in `pin-switch-dialog.tsx`; `ShiftListRow`/`ShiftForZReport` are structurally identical (queries vs receipts module) so `buildZReport(data.shift, …)` typechecks; `NumpadKey` is the single key type across all four numpad consumers; action results all use `ActionResult` from `lib/actions/result.ts`.
- **Known simplifications (accepted):** `asAdminService` in the PGlite harness stands in for service_role as superuser (function-grant tests still run as `authenticated`, which is the case that matters); users page omits emails (only used at creation); shift date boundaries use timestamps as stored (store-timezone setting remains deferred).
