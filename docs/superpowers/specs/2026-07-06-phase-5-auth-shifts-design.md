# Phase 5 — Auth, Roles & Shifts: Design

**Date:** 2026-07-06 · **Status:** approved by developer
**Source spec:** `prompts/phase-5.md` · **Foundation:** schema + RLS from Phase 1 (`supabase/migrations/20260704120000_schema.sql`, `20260704120100_rls.sql`)

## Decisions made during brainstorming

1. **PIN fast-switch = real Supabase session swap** (not PIN-as-password, not a shared device account). `auth.uid()` is always the genuine active cashier, so the existing RLS model and `create_sale` attribution guard work unchanged.
2. **Shifts stay open per cashier.** Switching cashiers never force-closes anyone's shift; the register requires the *active* cashier's own open shift.
3. **PIN policy:** 4 digits, bcrypt via pgcrypto, 5 consecutive failures → 15-minute lockout (`pin_locked_until`). Email+password login is never locked by PIN failures.
4. **User management is minimal:** one admin-only `/users` page — list, create, set/reset PIN, set role, toggle active. No email flows, no self-service.
5. **Checkout UX revision (added at developer request):** tendered prefilled to exact total + Enter confirms; bigger touch targets + on-screen numpad in the checkout dialog.

## 1. Login & route protection

- Extend the existing `signIn` server action (`lib/actions/auth.ts`):
  - After password success, load the caller's profile. If `active = false` → `supabase.auth.signOut()` and return an `accountDisabled` error.
  - Redirect by role: admin → `/`, cashier → `/register`.
- `proxy.ts` (Next 16 middleware): after i18n routing + `updateSession`, gate by session presence only (no DB call):
  - No session + path not `/login` → redirect to `/{locale}/login`.
  - Session + path is `/login` → redirect to `/{locale}/`.
- The `(app)` layout keeps its existing `getCurrentProfile()` check as defense in depth.

## 2. Role enforcement

- RLS (already deployed) remains the enforcement boundary. No policy changes needed for roles; the helpers `current_user_role()` / `is_admin()` already require `active`.
- New `requireAdmin()` helper in `lib/supabase/queries/profiles.ts` (server-only): loads the current profile; non-admin → `redirect("/register")`. Used by: products (+new/[id]/import), categories, reports, users pages.
- Sidebar nav filtered by role: cashier sees Register / Sales / Shifts; admin sees all + Users. `UserMenu` already shows role.
- **Verification:** PGlite-based SQL test (`scripts/test-rls.ts`, `npm run test:rls`) using the established auth-shim approach (see memory: testing-sql-without-docker): as a cashier, assert DENIED/empty on: `update products`, `select` other cashiers' shifts, other cashiers' sales, `stock_movements`, `update profiles`; assert ALLOWED on own shift insert/select and catalog reads.

## 3. PIN fast-switch (session swap)

### Migration (`supabase/migrations/20260706120000_auth_shifts.sql` — one file for §3 + §5)

- `create extension if not exists pgcrypto;`
- `alter table profiles add column pin_attempts int not null default 0, add column pin_locked_until timestamptz;`
- `verify_pin(p_user_id uuid, p_pin text) returns text` — security definer. Returns `'ok' | 'bad_pin' | 'locked' | 'no_pin'`:
  - `no_pin` when `pin_hash is null`; `locked` while `pin_locked_until > now()`.
  - Compare `crypt(p_pin, pin_hash) = pin_hash`. Failure increments `pin_attempts`; at 5, set `pin_locked_until = now() + interval '15 minutes'` and reset counter. Success resets counter and lock.
- `set_pin(p_user_id uuid, p_pin text) returns void` — security definer. Validates `p_pin ~ '^\d{4}$'`, sets `pin_hash = crypt(p_pin, gen_salt('bf'))`, clears attempts/lock.
- **Grants:** `revoke execute ... from public, authenticated; grant execute ... to service_role;` on both. Clients can never call them — no client-side brute force surface.

### Server action `switchCashier` (`lib/actions/auth.ts`)

Input (Zod): `targetUserId: uuid`, `pin: 4 digits`. Flow:
1. Require an existing authenticated staff session (any role) — the register is never anonymous.
2. Service-role client (`lib/supabase/admin.ts`, new, server-only, reads `SUPABASE_SERVICE_ROLE_KEY`): check target profile exists and `active`.
3. `rpc verify_pin` → map `bad_pin/locked/no_pin` to i18n error keys.
4. `auth.admin.generateLink({ type: "magiclink", email: target.email })` → take `properties.hashed_token`; **no email is sent** (generateLink only creates the link).
5. On the SSR client: `auth.verifyOtp({ type: "magiclink", token_hash })` — cookie session now belongs to the target cashier.
6. Return the new cashier's name/role; client redirects to `/register`.

Target user email comes from `auth.admin.getUserById` (profiles carry no email).

### UI

- "Switch cashier" entry: button in the register header area + `F9` shortcut (added to the shortcuts bar) + entry in `UserMenu`.
- Dialog: list of active, PIN-enabled profiles (arrow-key navigable) → 4-digit PIN entry (masked, auto-submits on 4th digit, on-screen numpad for touch) → success toast with the new name. Fully keyboard-operable; `Esc` closes.
- Needs a client-safe list of active cashier profiles: RLS lets non-admins read only their own profile, so the register page (server component) loads `{ id, full_name }` of active, PIN-enabled staff via the service-role client and passes it to the dialog as a prop — no hashes, no emails, no client query.

## 4. User management (`/users`, admin-only)

- Page: table of profiles — name, role badge, active badge, "PIN set" badge, created date.
- Actions (all in `lib/actions/users.ts`, all begin with `requireAdmin()`, all on the service-role client, all Zod-validated):
  - `createStaff(email, password, fullName, role, pin?)` → `auth.admin.createUser({ email, password, email_confirm: true })` + insert profile row (+ `set_pin` when a PIN is given). Failure of the profile insert deletes the just-created auth user (manual compensation — keep them consistent).
  - `setStaffPin(userId, pin)` → `rpc set_pin`.
  - `setStaffRole(userId, role)` → update profile. Guard: an admin cannot demote themselves (prevents zero-admin lockout).
  - `toggleStaffActive(userId, active)` → update profile. Guard: cannot deactivate yourself. Deactivation takes effect immediately: RLS helpers, `verify_pin`, and `signIn` all check `active`.
- Dialogs: create user, set PIN (numpad, same component as switch dialog), confirm deactivate.

## 5. Shifts & Z-report

### Migration (same file as §3)

- Partial unique index: `create unique index shifts_one_open_per_cashier on shifts (cashier_id) where closed_at is null;`
- `close_shift(p_shift_id uuid, p_counted numeric) returns shifts` — security definer, caller must own the shift or be admin, shift must be open. In one statement set: `closed_at = now()`, `closing_counted = p_counted`, `expected_cash = opening_float + (select coalesce(sum(total),0) from sales where shift_id = p_shift_id and payment_method = 'cash')`. Granted to `authenticated`.
- **`create_sale` update:** `p_shift_id` loses its `default null`; validation added at the top — the shift must exist, be open (`closed_at is null`), and belong to `v_cashier_id`, else `raise exception 'create_sale: no open shift ...'`. (Callers updated in the same phase.)

### App

- `lib/supabase/queries/shifts.ts`: `getActiveShift()` (own open shift), `getShifts(page)` (history, RLS-scoped), `getShiftWithSales(id)` (for the Z-report: shift row + per-method totals + count via one aggregate select).
- `lib/actions/shifts.ts`: `openShift(openingFloatInput)` (parse EGP → piasters, insert; unique-index violation → `shiftAlreadyOpen` error key), `closeShift(shiftId, countedInput)` (rpc, returns Z-report data, redirect to `/shifts/[id]`).
- **Register gating:** the register page (server component) loads `getActiveShift()`. None → render `<OpenShiftGate>` (blocking panel: explanation + opening-float input + open button) instead of the register. With a shift → render register, passing `shiftId`; `createSale` action sends it as `p_shift_id` (Phase 3 TODO resolved). The gate re-checks after PIN switch simply because the page re-renders under the new session.
- `/shifts` page: current-shift card (open → running duration, close button with counted-cash dialog + numpad; none → open form), then history table (cashier, opened, closed, duration, expected, counted, over/short, link). Admin sees all cashiers (RLS), cashier sees own.
- `/shifts/[id]` — the **Z-report**: `buildZReport(shift, salesAgg): ZReportData` transform in `lib/receipts/z-report.ts` + `components/shifts/z-report-80mm.tsx` rendered inside the existing `.receipt-print-area` print seam with print/reprint buttons (`ReceiptActions` stays receipt-specific; a slim `PrintButton` client component is shared). Fields: store name, cashier, opened/closed timestamps, duration, sale count, opening float, cash sales, card sales, total sales, expected cash (= float + cash sales), counted, over/short (signed, colored on screen). PDF download is NOT in scope for Z-reports (print covers the counter workflow; receipts keep PDF).

## 6. Checkout UX revision

`components/register/checkout-dialog.tsx`:

- On open: `tenderedInput` prefilled with the exact total (`piastersToEgpInput(totals.total)`), input `select()`-ed — typing overwrites, `Enter` confirms immediately. `F2` → `Enter` = 2-key exact-cash sale.
- Touch layout: dialog `sm:max-w-lg`; amount due and change in larger type; quick-note + method buttons at comfortable tap height (~h-12+); a 3×4 on-screen numpad (7 8 9 / 4 5 6 / 1 2 3 / . 0 ⌫) under the tender input editing `tenderedInput` via `onPointerDown` + `preventDefault` so hardware-keyboard focus never leaves the input.
- A reusable `<Numpad onKey={...}>` component at `components/ui/numpad.tsx`, shared by: checkout tender, PIN dialogs (§3/§4), opening-float and counted-cash dialogs (§5).

## 7. Testing & i18n

- `scripts/test-shifts.ts` (`npm run test:shifts`, PGlite + auth shims): `create_sale` rejects missing/closed/foreign shift and accepts an open own shift; `close_shift` math (expected = float + cash only; card excluded), ownership + double-close rejection; one-open-shift index; `verify_pin` lockout sequence (4 failures → still `bad_pin`, 5th → `locked`, success resets) and `set_pin` format validation.
- `scripts/test-rls.ts` (`npm run test:rls`): the §2 matrix.
- All new strings in `messages/en.json` + `messages/ar.json` (namespaces: `shifts`, `users`, `pinSwitch`, additions to `register`, `errors`, `nav`); all new screens verified in RTL; PIN/numpad/shift dialogs keyboard-operable.

## Done-when gates (from prompts/phase-5.md)

1. Cashier login cannot access products admin, reports, or other cashiers' shifts — proven at the API level by `test:rls`, plus manual URL checks.
2. Register blocks until a shift is open; closing produces a Z-report with expected cash = float + cash sales — covered by `test:shifts` + manual walkthrough.
3. PIN switch swaps the active cashier in under 5 seconds — manual timing on the dev server.

## Out of scope (unchanged from CLAUDE.md deferrals)

Offline queue, ESC/POS thermal printing, returns/refunds, multi-branch, store-timezone setting for shift boundaries.
