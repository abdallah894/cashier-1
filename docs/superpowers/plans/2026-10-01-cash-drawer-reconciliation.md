# Cash Drawer Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the fixed Main Register cash drawer accountable for every cash movement and reconcile it safely at shift close.

**Architecture:** An append-only `cash_drawer_events` ledger is the source of expected cash. Database RPCs create manual events and close a shift under locks; checkout and cash returns append their events atomically. Existing `shifts` remain compatible while their close values become event-derived.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase Postgres/RLS, PGlite, next-intl, Zod.

**Spec:** `docs/superpowers/specs/2026-10-01-cash-drawer-reconciliation-design.md`

## Global Constraints

- Amounts are integer piasters; never use float currency arithmetic.
- The one implicit drawer is Main Register; do not add a selectable drawer UI.
- Ledger events are append-only; no update/delete RLS policies.
- Database RPCs enforce ownership, open-shift state, reason, and manager-PIN approval.
- Every user-facing string is localized in English and Arabic.

## Review Focus

- A cash refund must decrease expected drawer cash exactly once.
- A safe drop must reduce expected cash but retain its actor and reason.
- A cashier cannot add an event or close another cashier's shift.
- Two simultaneous close attempts must produce one close and one deterministic rejection.
- A threshold variance must not close without a valid active manager PIN.

---

### Task 1: Immutable ledger and reconciliation RPCs

**Files:**
- Create: `supabase/migrations/<generated>_cash_drawer_reconciliation.sql`
- Create: `scripts/test-cash-drawer.ts`
- Modify: `lib/supabase/database.types.ts`

**Interfaces:**
- Produces `cash_drawer_events`, `record_cash_drawer_event(p_shift_id uuid, p_type text, p_amount numeric, p_reason text)` and `close_shift(p_shift_id uuid, p_counted numeric, p_manager_pin text default null)`.
- Event types are `opening_float`, `cash_sale`, `cash_refund`, `paid_in`, `paid_out`, `safe_drop`, and `close`; each has a signed amount.

- [ ] **Step 1: Write the failing SQL test**

```ts
await expectError(record("paid_out", 5000, ""), "reason is required", "paid-out needs reason");
await record("paid_in", 10000, "cash float top-up");
await record("safe_drop", 5000, "safe deposit");
const closed = await close(55000);
check("expected includes drawer events", Number(closed.expected_cash) === 55000);
```

- [ ] **Step 2: Verify RED**

Run: `npx tsx scripts/test-cash-drawer.ts`

Expected: FAIL because the ledger table and RPC do not exist.

- [ ] **Step 3: Generate and implement migration**

Run: `npx supabase migration new cash_drawer_reconciliation`

Implement the table with signed `amount`, actor, optional sale/return reference, reason, and timestamp; enable RLS; add cashier-own/admin read policies and no direct write policies. Replace `close_shift` with a row-locked calculation from the event ledger; reject threshold variances without a manager PIN.

- [ ] **Step 4: Make source transactions append events**

Add a positive `cash_sale` event inside `create_sale` for cash tender and a negative `cash_refund` event inside `create_return` for cash refunds. Both inserts occur in their existing transaction.

- [ ] **Step 5: Verify GREEN**

Run: `npx tsx scripts/test-cash-drawer.ts && npx tsx scripts/test-shifts.ts && npx tsx scripts/test-returns.ts`

Expected: all PASS, including ownership, variance approval, safe-drop, refund, and duplicate-close cases.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations scripts/test-cash-drawer.ts lib/supabase/database.types.ts
git commit -m "feat: add cash drawer event ledger"
```

### Task 2: Drawer-event action and shift controls

**Files:**
- Create: `lib/validation/cash-drawer.ts`
- Create: `lib/actions/cash-drawer.ts`
- Create: `components/shifts/cash-drawer-event-dialog.tsx`
- Modify: `app/[locale]/(app)/shifts/page.tsx`
- Modify: `messages/en.json`, `messages/ar.json`
- Create: `scripts/test-cash-drawer-action.ts`

**Interfaces:**
- Consumes `record_cash_drawer_event` and accepts `{ shiftId, type: "paid_in" | "paid_out" | "safe_drop", amount, reason }`.
- Produces `ActionResult<void>` and revalidates shifts and the Z report.

- [ ] **Step 1: Write the failing validation test**

```ts
expect(cashDrawerEventSchema.safeParse({ shiftId, type: "paid_out", amount: 5000, reason: "" }).success).toBe(false);
expect(cashDrawerEventSchema.safeParse({ shiftId, type: "paid_in", amount: 5000, reason: "Float" }).success).toBe(true);
```

- [ ] **Step 2: Verify RED**

Run: `npx tsx scripts/test-cash-drawer-action.ts`

Expected: FAIL because `cashDrawerEventSchema` does not exist.

- [ ] **Step 3: Implement action and dialog**

Validate Zod input, call the RPC, map ownership/open-shift errors to localized keys, and present only three manual event types. Require a reason before enabling submission.

- [ ] **Step 4: Verify GREEN**

Run: `npx tsx scripts/test-cash-drawer-action.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib components app messages scripts
git commit -m "feat: record drawer cash events"
```

### Task 3: Reconciled close and Z report

**Files:**
- Modify: `lib/actions/shifts.ts`
- Modify: `components/shifts/close-shift-dialog.tsx`
- Modify: `lib/receipts/z-report.ts`
- Modify: `components/shifts/z-report-80mm.tsx`
- Modify: `scripts/test-zreport.ts`
- Modify: `messages/en.json`, `messages/ar.json`

**Interfaces:**
- Consumes the RPC return fields `expected_cash`, `closing_counted`, and `variance` plus immutable event totals.
- Produces a Z report with cash-sale, cash-refund, paid-in, paid-out, safe-drop, card, expected, counted, and variance values.

- [ ] **Step 1: Write the failing Z-report test**

```ts
check("drawer totals are explicit", report.paidIn === 10000 && report.safeDrops === 5000);
check("variance is counted minus expected", report.variance === -2000);
```

- [ ] **Step 2: Verify RED**

Run: `npx tsx scripts/test-zreport.ts`

Expected: FAIL because the drawer totals are absent.

- [ ] **Step 3: Implement close and report rendering**

Show the expected amount before closing, require the manager PIN only when the RPC returns the threshold error, and render every event/tender total as its own Z-report row.

- [ ] **Step 4: Verify GREEN**

Run: `npx tsx scripts/test-zreport.ts && npm run typecheck && npm run lint`

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add lib components scripts messages
git commit -m "feat: reconcile drawer cash in Z reports"
```

### Task 4: Full verification and operator documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/retail-pos-capability-gap-analysis.md`

- [ ] **Step 1: Document the operation**

Explain Main Register, paid-in/out/safe-drop reason rules, the expected-cash formula, variance approval, and the fact that events cannot be edited.

- [ ] **Step 2: Run the full suite**

Run: `npm run typecheck && npm run lint && npm run test:shifts && npm run test:zreport && npx tsx scripts/test-cash-drawer.ts && npx tsx scripts/test-returns.ts`

Expected: all PASS.

- [ ] **Step 3: Commit**

```bash
git add README.md docs
git commit -m "docs: explain cash drawer reconciliation"
```

## Self-review

- Spec coverage: Tasks 1–3 implement the ledger, reason/permission rules, automatic sale/refund events, close variance approval, Z totals, and concurrency tests; Task 4 documents the operation.
- Placeholder scan: no unresolved implementation choices remain; the migration timestamp is generated through the Supabase CLI.
- Type consistency: Task 1 RPC names and event names are consumed unchanged by Tasks 2 and 3.
- Review focus coverage: Task 1 tests refunds, safe drops, ownership, close serialization, and manager threshold approval.
