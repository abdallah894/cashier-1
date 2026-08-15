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
