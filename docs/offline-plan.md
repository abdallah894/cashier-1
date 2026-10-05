# Offline plan — queue-and-sync design (Phase 7 seam)

Phase 6 shipped the **PWA groundwork only**: an installable manifest, a
Serwist service worker (`app/sw.ts`) that precaches the app shell + static
assets, and an online/offline indicator in the shell header
(`components/layout/network-indicator.tsx`). The register still requires the
network to complete a sale.

This document describes how full offline resilience slots in **without
rewriting the register** — it is the design contract for the deferred
"Offline resilience" phase (Part B1 of the project roadmap).

## Why it fits cleanly

Two existing seams make this an insert, not a rewrite:

1. **Checkout is a single RPC.** `create_sale` (see
   `supabase/migrations/20260704120000_schema.sql`) is one atomic
   transaction taking a JSON payload. That payload is the exact unit we
   queue offline — one queued item == one `create_sale` call.
2. **Data access is isolated** in `lib/supabase/`. The register never
   queries Supabase directly, so swapping "call the RPC now" for "enqueue,
   then sync" happens in one place.

## The queue (IndexedDB outbox)

- Use **Dexie** (thin IndexedDB wrapper) with an `outbox` table:
  `{ localId, payload, status: 'queued'|'syncing'|'synced'|'rejected', createdAt, saleNumber?, error? }`.
- On checkout: write the sale to the outbox **first**, show the receipt
  immediately using a **client-side temp id** and a provisional/`—` sale
  number, then attempt sync.
- Persist the Zustand cart to IndexedDB too, so a crash/refresh mid-sale
  doesn't lose the basket (`lib/store/cart.ts`).

## Sync

- A sync loop drains `queued` rows in FIFO order (receipt ordering matters)
  whenever `navigator.onLine` flips true — driven from the same
  online/offline signal the `NetworkIndicator` already subscribes to, and
  optionally a Serwist **BackgroundSync** queue registered in `app/sw.ts`.
- `sale_number` is **server-authoritative and gapless** (a Postgres
  sequence consumed only on success). The client never guesses it: the temp
  id is reconciled to the real `sale_number` returned by `create_sale` once
  the row syncs. Receipts printed before sync show the temp id and are
  reprintable with the real number afterward.

## Conflicts / failures

- **Insufficient stock** can only be detected server-side at sync time
  (offline stock counts are stale). A rejected sale surfaces to the cashier
  (`status: 'rejected'`, error toast) for a decision — it is not silently
  dropped.
- Stock shown offline is a **cached estimate**; the register should mark
  quantities as approximate when offline.
- Products/prices are served from a **read-through cache** (precached +
  refreshed while online) so scanning and search work with no network.

## Not in scope for the seam

Multi-device stock reservation and true conflict-free replicated counts are
out of scope; the model above accepts that offline stock is best-effort and
reconciles authoritatively on sync.

---

## Implementation status (roadmap item 04)

Built. The design above is implemented as follows:

| Concern | Where |
| --- | --- |
| IndexedDB (Dexie) outbox + catalog cache | `lib/offline/db.ts`, `outbox.ts`, `catalog.ts` |
| FIFO sync engine, single drain per DB | `lib/offline/sync.ts`, `submit.ts` |
| Idempotent `create_sale` (`p_idempotency_key`, `p_client_sold_at`) | `supabase/migrations/20261006100000_offline_idempotency.sql` |
| Provisional receipt (`P-n`, labelled not-final) | `components/offline/provisional-receipt-view.tsx` |
| Queue screen: retry / resolve rejected sales | `/offline-sales` |
| Header badges (pending / needs attention) | `components/layout/network-indicator.tsx` |
| Offline catalog + approximate stock | `lib/offline/register-data.ts`, `search-pane.tsx` |

Rules enforced:

- **Idempotency.** The outbox id is the server idempotency key. A replay (lost response, restart, second tab) returns the original sale; stock, movements and the drawer event happen once.
- **Cash only offline.** Card is disabled offline; a card request that loses its connection is reported as unconfirmed, never as paid.
- **No silent loss.** A server rejection (stale stock, closed shift, ...) becomes `rejected`. Staff retry it or *resolve* it with a mandatory note; the row is never deleted.
- **Shift integrity.** A queued sale names its shift and is never re-homed. Closing a shift is blocked while that shift has queued or rejected sales.
- **Per-cashier queue.** `create_sale` attributes the sale to the signed-in user, so a cashier's queue only drains under that cashier.
- **Discounts.** Above the manager-approval threshold (cached from `discount_settings`) a discount cannot be rung offline.
- **Time.** `created_at` is the sync time; the till's own clock is stored in `sales.client_sold_at` (bounded to now-7d..now+5min).

Tests: `npm run test:all` (`test-offline-idempotency.ts`, `test-offline-outbox.ts`, `test-offline-e2e.ts`).

### Manual test (needs a signed-in browser)

1. Open `/register`, let the catalog load once online.
2. DevTools > Network > Offline. The header shows **Offline**; Card is disabled.
3. Scan or search products (a banner says stock is approximate), check out in cash. You land on a `P-n` provisional receipt.
4. Reload the page while still offline. The sale is still in **Pending sales**.
5. Go back online. The sale syncs, the badge disappears, and *Final receipt* links to the numbered receipt.
6. To see a rejection, sell the last unit offline on two devices, or lower the stock in Products first. The loser shows **Rejected**; try *Retry* and *Resolve*.
