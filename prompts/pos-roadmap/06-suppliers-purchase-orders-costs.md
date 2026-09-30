# Implement suppliers, purchase orders, receiving, and cost history

## Goal

Provide an inventory replenishment workflow and stable historical profitability.

## Build

Add suppliers, purchase orders, lines, tax/cost, ordered/received/remaining quantities, partial receiving, invoice reference, and receiving-generated stock movements. Snapshot unit cost or maintain cost layers used by profit reporting.

## Preserve

Receiving must be atomic and auditable. Historical profit must not change when product cost is edited later.

## Acceptance

- Partial and over-receipt policy is explicit.
- PO status derives from lines safely.
- Receiving updates stock once and records actor/source document.
- Add reports/tests for outstanding PO, received cost, and historic profit.
