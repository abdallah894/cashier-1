# Implement audited returns, refunds, exchanges, and voids

## Goal

Add an immutable post-sale correction flow; never edit or delete `sales` or `sale_items`.

## Build

Create return records linked to the original sale and line items. Support full/partial quantity returns, exchange as return plus new sale, refund tender, restock/no-restock, mandatory reason, receipt, and manager approval threshold. Restocking must create a stock movement atomically with the return.

## Preserve

Keep piasters, receipt snapshots, RLS, and the existing `create_sale` transaction intact. A return is a new audited fact, not a negative edit.

## Acceptance

- Cannot exceed sold/refunded quantity.
- Refund never exceeds original paid amount by tender.
- Every return has actor, reason, timestamp, original receipt, and stock disposition.
- Cashiers need manager approval where configured.
- Add migration, RLS, UI, receipt output, and regression tests.
