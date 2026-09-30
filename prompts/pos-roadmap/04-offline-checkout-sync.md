# Implement resilient offline checkout

## Goal

Allow cash sales during outages with explicit reconciliation, following `docs/offline-plan.md`.

## Build

Use an IndexedDB outbox for sale payloads, cached catalog data, provisional receipts, FIFO sync, visible queued/synced/rejected states, and idempotency keys. Show cached stock as approximate offline.

## Preserve

The server `create_sale` RPC remains authoritative for stock, price, sale number, and conflicts. Never silently discard a rejected sale.

## Acceptance

- Disconnect, restart, reconnect, duplicate-submit, stale-stock, and rejected-sync paths are tested.
- A queued sale cannot create two server sales.
- Staff can find and resolve rejected items.
- Do not claim card payments succeeded offline without provider support.
