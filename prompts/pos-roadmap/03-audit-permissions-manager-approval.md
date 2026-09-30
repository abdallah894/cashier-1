# Implement POS audit events and granular authority

## Goal

Attribute sensitive actions and require the right approval without weakening current RLS.

## Build

Add append-only audit events with actor, action, target, before/after-safe metadata, request context, and timestamp. Introduce capability permissions/roles and a manager-PIN approval record for refunds, voids, custom discounts, stock corrections, and cash events.

## Preserve

Keep `admin`/`cashier` as a migration-safe baseline. Never log PINs, tokens, or private secrets.

## Acceptance

- Every sensitive mutation emits one durable audit event.
- Approval is tied to a concrete action and expires quickly.
- UI hides unavailable actions; server/RPC remains authoritative.
- Add permission, RLS, and tamper-resistance tests.
