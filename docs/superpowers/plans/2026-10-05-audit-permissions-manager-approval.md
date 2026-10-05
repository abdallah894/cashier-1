# POS Audit Events, Granular Authority, and Manager Approval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Attribute sensitive POS operations durably and enforce granular authority plus short-lived, action-bound manager approvals.

**Architecture:** Add an append-only audit table, per-staff capability grants, and one-time manager approvals in Postgres. Existing mutations keep their financial invariants but call shared security-definer authorization/audit helpers in the same transaction; client UI consumes effective capabilities only to hide unavailable controls.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase Postgres/RLS, PGlite, next-intl, Zod.

**Spec:** `docs/superpowers/specs/2026-10-05-audit-permissions-manager-approval-design.md`

## Global Constraints

- Preserve `admin` and `cashier` as valid roles; active admins retain every capability.
- Money remains integer piasters and completed financial facts remain immutable.
- PINs, hashes, tokens, headers, cookies, emails, and full checkout payloads never enter audit metadata.
- Approvals last five minutes, bind to one requester/action/canonical request hash, and can be consumed once.
- RLS and RPC checks are authoritative; AR/EN UI visibility is advisory only.
- Every new user-facing string is localized in both `messages/ar.json` and `messages/en.json`.

## Review Focus

- A cashier must be unable to self-grant a capability or forge an audit row; Task 1 pins both RLS paths.
- An approval for one amount, target, requester, or expired time must fail when reused; Task 2 pins all four bindings.
- A successful sensitive operation must produce one audit event and a failed operation must produce none; Tasks 3–5 pin transactionality.
- PIN material must never appear in audit metadata; Task 2 scans persisted metadata after an approval flow.
- Existing owner/admin behavior for returns, stock, and drawer shifts must remain valid after authorization helpers are inserted; Tasks 3–5 extend their existing PGlite suites.

### Task 1: Capability grants and append-only audit primitives

**Files:**
- Create: `supabase/migrations/<timestamp>_audit_permissions.sql`
- Modify: `lib/supabase/database.types.ts`
- Create: `scripts/test-audit-permissions.ts`
- Modify: `scripts/test-rls.ts`

**Interfaces:**
- Produces `public.capability`, `public.staff_capabilities`, `public.audit_events`, `public.has_capability(p_capability public.capability)`, and `public.write_audit_event(...)`.
- `has_capability` returns true for an active admin or an active staff member holding the exact explicit grant.

- [ ] **Step 1: Write failing SQL/RLS tests**

```ts
await asUser(db, CASHIER);
await expectError(
  db.query(`insert into public.staff_capabilities (staff_id, capability, granted_by)
    values ('${CASHIER}', 'cash.drawer.adjust', '${CASHIER}')`),
  "row-level security",
  "cashier cannot self-grant"
);
check("cashier has no granted capability", (await db.query(
  `select public.has_capability('cash.drawer.adjust') as allowed`
)).rows[0].allowed === false);
await asUser(db, ADMIN);
check("admin has every capability", (await db.query(
  `select public.has_capability('cash.drawer.adjust') as allowed`
)).rows[0].allowed === true);
```

- [ ] **Step 2: Verify RED**

Run: `npx tsx scripts/test-audit-permissions.ts`

Expected: FAIL because `staff_capabilities` and `has_capability` do not exist.

- [ ] **Step 3: Implement the migration primitives**

```sql
create type public.capability as enum (
  'return.approve', 'cart.void', 'discount.override',
  'stock.correct', 'cash.drawer.adjust', 'shift.close.override'
);
create table public.staff_capabilities (
  staff_id uuid not null references public.profiles(id) on delete restrict,
  capability public.capability not null,
  granted_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (staff_id, capability)
);
create table public.audit_events (
  id uuid primary key default gen_random_uuid(), actor_id uuid not null references public.profiles(id),
  approved_by uuid references public.profiles(id), action text not null,
  target_type text not null, target_id uuid, metadata jsonb not null default '{}'::jsonb,
  request_id uuid, created_at timestamptz not null default now()
);
```

Enable RLS on both tables. Give only admins SELECT/MANAGE access to grants and audit rows; give no direct insert/update/delete policy for audit events. Add a security-definer `has_capability` that checks `profiles.active`, `is_admin()`, then the caller’s explicit grant. Add `write_audit_event` with a closed action whitelist and a metadata key whitelist, and revoke its execution from direct authenticated callers so only mutation RPCs call it internally.

- [ ] **Step 4: Add generated type surface**

Add table rows/inserts/relationships and the `capability` enum/functions to `lib/supabase/database.types.ts`; do not model audit metadata as `any` outside the JSON type supplied by generated Supabase types.

- [ ] **Step 5: Verify GREEN**

Run: `npx tsx scripts/test-audit-permissions.ts && npm run test:rls && npm run typecheck`

Expected: all pass; direct cashier grant/audit writes are blocked and admins retain full capabilities.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations scripts lib/supabase/database.types.ts
git commit -m "feat: add audit and capability primitives"
```

### Task 2: One-time manager approvals

**Files:**
- Modify: `supabase/migrations/<timestamp>_audit_permissions.sql`
- Modify: `lib/supabase/database.types.ts`
- Modify: `scripts/test-audit-permissions.ts`

**Interfaces:**
- Produces `manager_approvals`, `create_manager_approval(p_action text, p_request_hash text, p_pin text)`, and `consume_manager_approval(p_approval_id uuid, p_action text, p_request_hash text)`.
- The caller supplies a SHA-256 hex request hash calculated from canonical safe operation data; consumption returns the approving manager UUID or raises a deterministic approval error.

- [ ] **Step 1: Add failing approval tests**

```ts
const approval = await db.query<{ create_manager_approval: string }>(
  `select public.create_manager_approval('cash_drawer_event', repeat('a', 64), '1234')`
);
await expectError(
  db.query(`select public.consume_manager_approval('${approval.rows[0].create_manager_approval}',
    'cash_drawer_event', repeat('b', 64))`),
  "does not match", "approval cannot authorize changed request"
);
```

Also test a different requester, an expired row (`expires_at = now() - interval '1 second'` as service role), second consumption, and that `metadata::text` never contains `1234`.

- [ ] **Step 2: Verify RED**

Run: `npx tsx scripts/test-audit-permissions.ts`

Expected: FAIL because approval functions do not exist.

- [ ] **Step 3: Implement approval table and helpers**

```sql
create table public.manager_approvals (
  id uuid primary key default gen_random_uuid(), action text not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  requested_by uuid not null references public.profiles(id),
  approved_by uuid not null references public.profiles(id),
  expires_at timestamptz not null default now() + interval '5 minutes',
  used_at timestamptz, created_at timestamptz not null default now()
);
```

`create_manager_approval` validates action/hash, finds an active admin by `extensions.crypt(p_pin, pin_hash)`, and writes an `approval_created` audit event with only action and hash prefix metadata. `consume_manager_approval` locks the row, verifies current requester/action/hash/expiry/unused state, marks it used, and returns `approved_by`. No client has direct table write policies.

- [ ] **Step 4: Verify GREEN**

Run: `npx tsx scripts/test-audit-permissions.ts && npm run typecheck`

Expected: all approval binding, expiry, single-use, and secret-safety checks pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations scripts lib/supabase/database.types.ts
git commit -m "feat: add bound manager approvals"
```

### Task 3: Apply authority and audit to stock and drawer mutations

**Files:**
- Modify: `supabase/migrations/<timestamp>_audit_permissions.sql`
- Modify: `lib/actions/products.ts`
- Modify: `lib/actions/cash-drawer.ts`
- Modify: `lib/validation/product.ts`
- Modify: `lib/validation/cash-drawer.ts`
- Modify: `scripts/test-audit-permissions.ts`
- Modify: `scripts/test-cash-drawer.ts`

**Interfaces:**
- `adjust_stock` and `record_cash_drawer_event` accept optional `p_approval_id uuid` and emit exactly one audit event on success.
- Server action inputs accept `approvalId?: string`; missing capability returns `managerApprovalRequired` without performing a mutation.

- [ ] **Step 1: Add failing mutation tests**

```ts
await asUser(db, CASHIER);
await expectError(
  db.query(`select public.adjust_stock('${PRODUCT}', 1, 'correction', 'Count correction', null)`),
  "capability required", "cashier needs stock correction authority"
);
await grant(db, CASHIER, 'stock.correct');
await db.query(`select public.adjust_stock('${PRODUCT}', 1, 'correction', 'Count correction', null)`);
check("stock correction has one audit event", await auditCount(db, 'stock_correction') === 1);
```

Also add a drawer event test for missing `cash.drawer.adjust`, successful explicit grant, and no audit row when the RPC rejects a closed/foreign shift.

- [ ] **Step 2: Verify RED**

Run: `npx tsx scripts/test-audit-permissions.ts && npx tsx scripts/test-cash-drawer.ts`

Expected: FAIL because existing RPCs do not recognize capability grants or write audits.

- [ ] **Step 3: Recreate the two RPCs in the migration**

At the top of each function, retain existing ownership/open-state checks, then require `has_capability('stock.correct')` or `has_capability('cash.drawer.adjust')`. If an optional approval is supplied, consume it using a canonical SQL `jsonb_build_object` request hash containing the product/shift id, signed amount, reason/type. Insert the financial record and `write_audit_event` before the function returns; do not add direct DML policies.

- [ ] **Step 4: Extend validation and server error mapping**

```ts
export const stockAdjustmentSchema = z.object({
  // existing fields...
  approvalId: z.uuid().optional(),
});
```

Pass `p_approval_id` only when supplied. Map "capability required" and approval errors to `managerApprovalRequired`; retain existing ownership/error handling.

- [ ] **Step 5: Verify GREEN**

Run: `npx tsx scripts/test-audit-permissions.ts && npx tsx scripts/test-cash-drawer.ts && npm run typecheck`

Expected: grants affect authority only through RPCs, and each successful mutation has exactly one audit record.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations lib/actions lib/validation scripts
git commit -m "feat: audit stock and drawer controls"
```

### Task 4: Apply approval and audit to returns, discounts, and shift close

**Files:**
- Modify: `supabase/migrations/<timestamp>_audit_permissions.sql`
- Modify: `supabase/migrations/20260930130000_returns.sql` only if a function-signature replacement requires it; otherwise use the new migration
- Modify: `lib/actions/sales.ts`
- Modify: `lib/actions/shifts.ts`
- Modify: `app/[locale]/(app)/receipts/[id]/return-actions.ts`
- Modify: `lib/validation/sale.ts`
- Modify: `lib/validation/return.ts`
- Modify: `lib/validation/shift.ts`
- Modify: `scripts/test-returns.ts`
- Modify: `scripts/test-shifts.ts`

**Interfaces:**
- `create_return`, `create_sale`, and `close_shift` gain optional `p_approval_id uuid`; their financial inserts and audit events share a transaction.
- `authorization_settings` exposes nullable piaster thresholds for return, discount, and close-variance approval; existing return/cash settings migrate into these values without losing configured policy.

- [ ] **Step 1: Add failing tests for each path**

```ts
await expectError(createThresholdReturn(null), "approval is required", "return requires bound approval");
const approvalId = await approve(db, 'return', returnHash);
await createThresholdReturn(approvalId);
check("return audit links manager", await auditHasApproval(db, 'return_created', approvalId));
```

Add equivalent test cases for a discount over threshold on `create_sale`, a close variance at threshold, and an approval passed with a changed total. Preserve the existing test that a completed sale is never voided or updated.

- [ ] **Step 2: Verify RED**

Run: `npx tsx scripts/test-returns.ts && npm run test:shifts && npx tsx scripts/test-audit-permissions.ts`

Expected: FAIL because these RPCs accept only raw manager PINs or no approval id and create no audit event.

- [ ] **Step 3: Replace raw manager PIN operation parameters**

In the new migration, replace `p_manager_pin` with optional `p_approval_id` in `create_return` and `close_shift`. Preserve the existing threshold calculations, build the request hash after the authoritative server-side totals are known, consume the approval before the state change, and include the returned manager id in both the existing domain record and audit event. Recreate `create_sale` with the same checkout validation and add an authoritative discount threshold check after computed totals.

- [ ] **Step 4: Update action schemas and error maps**

Pass optional approval ids from `createSale`, `recordReturn`, and `closeShift`. Do not pass a raw PIN to financial RPCs. Ensure the error map returns a localized manager-approval key while exposing no information about PIN validity.

- [ ] **Step 5: Verify GREEN**

Run: `npx tsx scripts/test-returns.ts && npm run test:shifts && npx tsx scripts/test-audit-permissions.ts && npm run typecheck`

Expected: all existing financial behavior remains valid, threshold paths consume exactly one matching approval, and each successful sensitive operation writes exactly one audit event.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations app lib scripts
git commit -m "feat: approve and audit financial overrides"
```

### Task 5: Capability management, approval UX, and audit viewing

**Files:**
- Create: `lib/supabase/queries/audit.ts`
- Create: `lib/actions/approvals.ts`
- Create: `components/approvals/manager-approval-dialog.tsx`
- Create: `components/audit/audit-events-table.tsx`
- Create: `app/[locale]/(app)/audit/page.tsx`
- Modify: `lib/actions/users.ts`
- Modify: `lib/validation/user.ts`
- Modify: `components/users/users-table.tsx`
- Modify: `components/products/stock-adjust-dialog.tsx`
- Modify: `components/shifts/cash-drawer-event-dialog.tsx`
- Modify: `components/shifts/close-shift-dialog.tsx`
- Modify: `components/receipts/return-dialog.tsx`
- Modify: `components/register/checkout-dialog.tsx`
- Modify: `components/layout/sidebar.tsx`
- Modify: `messages/ar.json`
- Modify: `messages/en.json`
- Create: `scripts/test-approval-validation.ts`

**Interfaces:**
- `createManagerApproval({ action, requestHash, pin })` returns `{ approvalId }` or an existing localized error key.
- `getEffectiveCapabilities()` returns the current signed-in staff member’s allowed enum values; `getAuditEvents(filters)` is admin-only and paginated.
- `setStaffCapabilities({ userId, capabilities })` replaces explicit grants only after an admin identity check; admin UI shows full inherited access as non-editable.

- [ ] **Step 1: Write failing validation tests**

```ts
check("approval pin rejects non-digits", !managerApprovalSchema.safeParse({
  action: 'cash_drawer_event', requestHash: 'a'.repeat(64), pin: '12a4'
}).success);
check("approval requires a 64-char hash", !managerApprovalSchema.safeParse({
  action: 'cash_drawer_event', requestHash: 'short', pin: '1234'
}).success);
```

- [ ] **Step 2: Verify RED**

Run: `npx tsx scripts/test-approval-validation.ts`

Expected: FAIL because approval validation/actions do not exist.

- [ ] **Step 3: Build the shared approval dialog and actions**

Create a client dialog that accepts only a PIN, receives its action/request hash from the calling dialog, calls the approval action, and returns the one-time id in memory. Each sensitive dialog retries its normal action with that id only after the server asks for approval. Clear PIN/id when the dialog closes or action completes.

- [ ] **Step 4: Add capability and audit admin surfaces**

Add localized capability toggles alongside each non-admin staff member. Add an admin-only sidebar route with actor/action/target/date filters and an audit table displaying safe metadata only. Use server queries and existing pagination/table patterns; do not send audit rows to cashier clients.

- [ ] **Step 5: Verify GREEN**

Run: `npx tsx scripts/test-approval-validation.ts && npm run typecheck && npm run lint`

Expected: all staff/admin screens typecheck; invalid approval input is blocked before RPC; audit route is unavailable to non-admin UI and database callers.

- [ ] **Step 6: Commit**

```bash
git add app components lib messages scripts
git commit -m "feat: manage POS authority and audit events"
```

### Task 6: Full verification and operator documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/retail-pos-capability-gap-analysis.md`

- [ ] **Step 1: Document operational rules**

Explain explicit capability grants, admin inheritance, manager-approval expiry/single-use behavior, audit metadata safety, and how admins inspect audit history. State that completed sales are still corrected by returns rather than voided.

- [ ] **Step 2: Run the full verification set**

Run: `npm run typecheck && npm run lint && npm run test:rls && npm run test:shifts && npx tsx scripts/test-returns.ts && npx tsx scripts/test-cash-drawer.ts && npx tsx scripts/test-audit-permissions.ts && npx tsx scripts/test-approval-validation.ts`

Expected: every command exits 0 and PGlite proves authorization, tamper resistance, approval bindings, and financial regressions.

- [ ] **Step 3: Commit**

```bash
git add README.md docs
git commit -m "docs: explain POS audit authority"
```

## Self-review

- Spec coverage: Tasks 1–2 provide immutable audit, grants, and action-bound approvals; Tasks 3–4 integrate each persisted sensitive operation; Task 5 delivers UI visibility and management; Task 6 documents and verifies the release.
- Placeholder scan: No unresolved implementation markers or unspecified interfaces remain; every task names its files, inputs, verification, and commit boundary.
- Type consistency: `approvalId` is the TypeScript input name and `p_approval_id` the RPC argument everywhere; approval actions use canonical 64-character SHA-256 request hashes throughout.
- Review focus: Task 1 tests grant/audit tampering; Task 2 tests expiry/reuse/request binding and secret safety; Tasks 3–4 test atomic audit events and existing ownership behavior; Task 6 executes the full regression set.
