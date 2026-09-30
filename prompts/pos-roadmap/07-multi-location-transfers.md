# Implement multi-location inventory and transfers

## Goal

Prepare Cachier for branches and warehouses without corrupting stock.

## Build

Add locations, per-location inventory, assigned till/location context, transfer orders, dispatch, in-transit state, partial receipt, and transfer audit movements.

## Preserve

Defer this feature if product direction is strictly one site. Do not retrofit by copying one global `stock_qty` inconsistently.

## Acceptance

- Checkout uses the active location stock.
- Transfer quantities cannot exceed source availability.
- In-transit inventory is not sellable.
- Location-scoped RLS, reports, and migration/backfill are tested.
