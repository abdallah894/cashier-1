# Implement supported POS hardware and receipt delivery

## Goal

Make counter operation dependable with declared hardware support.

## Build

Define supported scanners, thermal printers, and cash drawers. Add device profiles, health/status checks, ESC/POS print path where feasible, drawer-open authorization, reprints, and optional email/SMS/gift receipts.

## Preserve

Keep browser/PDF printing as a fallback. Device actions require actor/till audit data.

## Acceptance

- Hardware compatibility matrix exists.
- Failed print is visible and reprintable without duplicating sales.
- Drawer opens only for approved events.
- Test printer failure, barcode input, and receipt privacy cases.
