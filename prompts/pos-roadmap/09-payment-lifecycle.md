# Implement payment lifecycle and tender completeness

## Goal

Move from recorded tender labels to reliable payment records.

## Build

Define Egypt-supported providers first. Add payment records with tender, provider/terminal reference, authorization/capture/decline/refund state, idempotency key, and reconciliation. Design split tender, voucher, store credit, and gift-card rules.

## Preserve

Sales totals and refund limits are server-authoritative. Never store raw card data or secrets.

## Acceptance

- Duplicate provider callbacks cannot duplicate a sale/refund.
- Tender totals reconcile exactly to sale/refund amount.
- Failed and pending payments have staff-visible recovery states.
- Add provider sandbox/integration tests and a PCI scope note.
