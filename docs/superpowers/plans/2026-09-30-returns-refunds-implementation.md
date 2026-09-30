# Returns, Refunds, Exchanges, and Voids Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add immutable, auditable return and refund handling without mutating completed sales or corrupting inventory/cash history.

**Architecture:** A database RPC creates return documents and return lines as new facts linked to the original sale. It validates remaining returnable quantity and original tender limits under row locks, optionally restores stock, records an immutable movement, and returns a receipt-ready record. Server actions and the receipt UI consume the RPC; RLS guards both original-sale visibility and manager approval.

**Tech Stack:** Next.js 16 App Router, Supabase/Postgres RPC and RLS, React 19, TypeScript, Tailwind, jsPDF.

**Spec:** `prompts/pos-roadmap/01-returns-refunds-exchanges.md`

## Global Constraints

- Monetary values are integer piasters; quantities permit three decimals only for kg items.
- Completed `sales` and `sale_items` remain immutable.
- A return/restock is a new stock movement and a new audit fact.
- Server/RPC validation, not UI validation, decides returned quantity, tender limit, actor permission, and stock effect.
- Preserve current receipt snapshots and RLS guarantees.

## Review Focus

- Two concurrent returns against the same sale item must not exceed its sold quantity.
- A partial return must refund no more than the selected original tender amount.
- A no-restock return must leave stock unchanged but still be auditable.
- A cashier attempting a manager-required return must receive a deterministic rejection.
- An exchange must persist its return before creating a separate replacement sale.

---

### Task 1: Return schema, validation RPC, and RLS

**Files:**

- Create: `supabase/migrations/<timestamp>_returns.sql`
- Modify: `lib/supabase/database.types.ts` after generating types
- Test: `scripts/test-returns.ts`

**Interfaces:**

- Produces `public.returns`, `public.return_items`, and `public.create_return(p_sale_id uuid, p_items jsonb, p_refund_tender payment_method, p_reason text, p_restock boolean)`.
- The RPC returns `{ return_id, return_number, refund_total, created_at }`.

- [ ] **Step 1: Write the failing RPC test**

```ts
await expectReturn({ saleId, items: [{ saleItemId, qty: 1 }], restock: true });
await expectReturnRejected(
  { saleId, items: [{ saleItemId, qty: 999 }], restock: true },
  /return quantity exceeds sold quantity/
);
```

- [ ] **Step 2: Run `npx tsx scripts/test-returns.ts`**

Expected: failure because the RPC and return tables do not exist.

- [ ] **Step 3: Add migration**

Create append-only return/header and return-item tables; snapshot product names, unit price, tax and line refund total. In `create_return`, lock original sale items, subtract prior return quantities, validate reason/tender/permission, insert records, and insert a positive `stock_movements` row only when `p_restock` is true.

- [ ] **Step 4: Add RLS and grants**

Allow cashiers to view and create only returns for their own sales; permit admin access; keep update/delete policies absent. Require `is_admin()` for manager-approved paths.

- [ ] **Step 5: Re-run `npx tsx scripts/test-returns.ts`**

Expected: pass for full, partial, no-restock, and oversold rejection cases.

### Task 2: Server action and return UI

**Files:**

- Create: `app/[locale]/(app)/receipts/[id]/return-actions.ts`
- Create: `components/receipts/return-dialog.tsx`
- Modify: `app/[locale]/(app)/receipts/[id]/page.tsx`
- Modify: `messages/en.json`, `messages/ar.json`
- Test: `scripts/test-return-action.ts`

**Interfaces:**

- Consumes `create_return` with original receipt id, selected line quantities, reason, restock choice, and refund tender.
- Produces redirect/revalidation to the original receipt with linked return history.

- [ ] **Step 1: Write failing server-action test**

```ts
const result = await submitReturn(validReturnInput);
expect(result).toEqual({ ok: true, returnNumber: expect.any(Number) });
```

- [ ] **Step 2: Implement the action and dialog**

Render only remaining returnable quantities; require a localized reason; show refund/restock total before confirmation; send only IDs/quantities to the server; surface RPC errors without exposing database internals.

- [ ] **Step 3: Verify UI behavior**

Run the test and manually verify Arabic/English text, kg fractional quantity, disabled over-return quantities, and no-restock warning.

### Task 3: Return receipts, history, and reporting effects

**Files:**

- Create: `lib/receipts/build-return.ts`
- Create: `components/receipts/return-receipt-80mm.tsx`
- Modify: `components/receipts/receipt-actions.tsx`
- Modify: `lib/supabase/queries/sales.ts`
- Test: `scripts/test-return-receipt.ts`

**Interfaces:**

- `buildReturnReceipt(returnRecord) -> ReturnReceiptData` creates a distinct document referencing original sale and return number.

- [ ] **Step 1: Write failing receipt test**

```ts
expect(buildReturnReceipt(returnFixture)).toMatchObject({
  originalSaleNumber: 42,
  refundTotal: 4895,
  restocked: true,
});
```

- [ ] **Step 2: Implement receipt/history rendering**

Render return number, original receipt number, item quantities, reason, refund tender, restock status, cashier and timestamp. Add print/PDF actions without changing original receipt content.

- [ ] **Step 3: Include returns in financial views explicitly**

Expose gross sales, refunds, and net sales separately; do not subtract return rows invisibly from historical gross sales.

- [ ] **Step 4: Run receipt and reporting regression scripts**

Expected: immutable original receipt and correct return totals in both languages.

### Task 4: End-to-end validation and rollout

**Files:**

- Modify: `README.md`
- Modify: `docs/retail-pos-capability-gap-analysis.md`
- Test: `scripts/test-returns.ts`, `scripts/test-return-action.ts`, `scripts/test-return-receipt.ts`

- [ ] **Step 1: Run full verification**

Run `npm run typecheck`, `npm run lint`, existing receipt/shift/report scripts, and every return script.

- [ ] **Step 2: Validate access paths**

Test cashier own-sale return, cashier other-sale denial, admin return, manager-required denial, simultaneous return attempt, and no-restock return.

- [ ] **Step 3: Document operator behavior**

Document when a return restocks inventory, how to handle a wrong tender, and how managers approve exceptions.

- [ ] **Step 4: Commit**

```bash
git add supabase app components lib messages scripts README.md docs
git commit -m "feat: add audited returns and refunds"
```

## Self-Review

- Spec coverage: schema/RPC/RLS, UI, receipt, return history, stock, tender limit, approval, and tests are covered.
- Placeholders: none; migration timestamp is selected at implementation time to preserve chronological ordering.
- Type consistency: the RPC contract is the only mutation boundary used by UI/action/receipt tasks.
- Review focus: each listed failure mode is included in Task 1, 2, or 4 validation.
