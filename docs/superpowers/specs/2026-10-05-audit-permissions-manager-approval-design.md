# POS Audit Events, Granular Authority, and Manager Approval Design

## Purpose and success criteria

The POS must attribute sensitive operations to a staff member, retain an immutable record of what happened, and allow the store to give narrowly scoped authority without weakening its existing RLS boundary. This design applies to refunds, stock corrections, cash-drawer movements, high-value discounts, and the unpaid-cart void action.

Success means every completed sensitive mutation creates one durable audit event; an approval is tied to one intended action and expires quickly; UI affordances reflect authority but Postgres RPCs remain decisive; and neither PINs, tokens, hashes, nor full request payloads become audit metadata.

## Scope and compatibility

The existing `admin` and `cashier` roles remain valid and preserve current access while the new capability layer is introduced. `admin` has every capability by default. `cashier` retains ordinary checkout, their own return, and their own shift flows, but needs explicit capability grants for sensitive manager-like actions. The first release stores grants per user rather than inventing new named roles; a future role editor can apply the same capability table in bulk.

Completed sales, returns, stock movements, and drawer events remain their own immutable financial facts. Audit events add attribution and context; they do not replace those records or authorize direct writes to them.

## Data model

`capability` is a Postgres enum with a small closed vocabulary:

- `return.approve`
- `cart.void`
- `discount.override`
- `stock.correct`
- `cash.drawer.adjust`
- `shift.close.override`

`staff_capabilities` contains `(staff_id, capability, granted_by, created_at)` with a composite primary key. Only admins can view or manage it. A security-definer `has_capability(capability)` returns true for an active admin or for the signed-in active staff member with that grant. The function is the one authorization seam used by sensitive RPCs.

`manager_approvals` stores an approval nonce, `action`, `request_hash`, `approved_by`, `requested_by`, `expires_at`, and `used_at`. The hash is SHA-256 over a canonical JSON payload built in SQL from the action’s public identifiers and amount values; it never contains the PIN. A caller creates an approval only by presenting an active admin’s PIN to `create_manager_approval`. It expires after five minutes, may be consumed only once, and is bound to both the requesting actor and its exact request hash.

`audit_events` stores `actor_id`, optional `approved_by`, action, target type/id, a small safe `metadata` JSONB object, optional request identifier, and timestamp. It has no update or delete policies. Select access is admin-only in the initial release. A security-definer `write_audit_event` validates the action and metadata shape and is invoked within the same transaction as each sensitive mutation.

## Authorization and approval flow

1. The UI fetches the signed-in user’s effective capabilities and hides actions they cannot perform. This is usability only.
2. A server action performs Zod validation and calls the operation RPC with a stable, canonical request payload.
3. The RPC evaluates `has_capability`. Ordinary ownership/RLS checks remain unchanged.
4. If the operation needs a manager approval due to a configured threshold or because the actor lacks the override capability, the UI asks for a manager PIN. It requests a short-lived approval for that exact action and payload, then retries the operation with the approval id.
5. The operation locks and consumes that approval in the same database transaction as the return, drawer event, stock correction, discount-bearing sale, or void marker. It writes exactly one audit event before returning.

Approval records prove approval; audit events prove the final state-changing action. An approval that is never consumed remains visible to admins but has no operational effect after expiry.

## Sensitive-operation mapping

| Operation | Primary authority | Manager approval condition | Audit target and safe metadata |
| --- | --- | --- | --- |
| Return/refund | Original-sale cashier or admin; `return.approve` permits cross-cashier approval | Existing amount threshold or cross-cashier approval | return id; sale id, refund total, tender, restock |
| Unpaid cart void | `cart.void` | None when actor has capability; otherwise unavailable | client-side void endpoint only if a durable void attempt is added; no audit event for simply clearing local state in this release |
| Custom discount | `discount.override` for amounts above the configured threshold | Exact sale/discount payload approval | sale id; subtotal, discount total, payment method |
| Stock correction | `stock.correct` | Exact correction payload approval if actor is not an admin | product id; signed quantity change, reason, note length only |
| Paid-in/out/safe drop | Own open shift plus `cash.drawer.adjust` | Exact drawer event payload approval if actor lacks capability | drawer-event id; shift id, type, signed amount, reason length |
| Shift-close variance | Own open shift or admin; `shift.close.override` | Existing variance threshold, converted to reusable approval record | shift id; expected, counted, variance |

The release does not create a financial "void" for completed sales: the existing rule remains that completed sales are corrected with immutable returns.

## Audit safety and request context

Audit metadata is intentionally a whitelist, not arbitrary JSON copied from the caller. It contains only identifiers, integer-piaster amounts, enum values, boolean disposition, and bounded text lengths. It excludes PINs, PIN hashes, auth headers, cookies, service-role credentials, email addresses, full customer data, and raw checkout line-item payloads.

The server action may attach an opaque request UUID generated per mutation. IP address and user-agent are not available reliably through the current Supabase server path, so they are deliberately omitted rather than guessed. The database timestamp is authoritative.

## UI and reporting

An admin-only audit page supports filtering by action, actor, target, and time range. Sensitive dialogs show a localized manager-approval prompt only after the server reports that approval is needed; the PIN is held only in client component state for the single request and never logged or stored by application code. Staff management exposes capability toggles for each active staff member, with inherited full access clearly shown for admins.

## Error handling

RPC errors distinguish: unauthenticated, missing capability, invalid/expired/used approval, approval bound to a different request, ownership violation, and invalid input. Server actions map these to existing and new Arabic/English error keys without exposing whether a particular manager PIN matched. Retrying with a consumed approval is deterministic and safe because the financial mutation and consumption occur atomically.

## Verification

PGlite tests must prove:

- audit events are inserted once with approved safe metadata and cannot be inserted, changed, or deleted directly by a cashier;
- an admin default capability and an explicit cashier grant are accepted, while a missing capability is rejected server-side;
- an approval expires, cannot be reused, cannot be used by another requester, and cannot approve a changed amount or target;
- return, stock, drawer, discount, and variance-close paths create correct audit links without recording PIN material;
- RLS lets an admin read audit events but blocks cashiers, and all existing ownership checks remain intact.

## Explicit non-goals

This release does not add a generic workflow engine, customer data audit capture, configurable named roles, network request logging, multi-store policy inheritance, or editable audit annotations. Those would widen the security surface without serving the immediate POS control requirements.
