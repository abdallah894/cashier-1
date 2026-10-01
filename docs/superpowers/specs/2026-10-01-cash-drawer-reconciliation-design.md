# Cash Drawer Reconciliation Design

## Goal

Make the store's one fixed cash drawer accountable for every cash movement during a shift, without changing completed sales or historical cash events.

## Scope

The initial release models one implicit drawer, **Main Register**. It adds immutable cash events for opening float, cash sale, cash refund, paid-in, paid-out, safe drop, and close. The schema deliberately leaves room for a future `drawer_id` without requiring multi-drawer UI or configuration now.

## Data model

`cash_drawer_events` is append-only and belongs to a shift. It stores event type, integer-piaster amount, optional sale/return reference, required reason where the event is manually entered, actor, and timestamp. Opening, cash-sale, cash-refund, and close events are system-created; paid-in, paid-out, and safe-drop are explicit cashier actions.

The shift keeps its existing opening and close fields for compatibility. Closing calculates the expected amount from its immutable events and stores the counted amount, expected amount, and variance. No event is updated or deleted.

## Business rules

- Cash values remain integer piasters.
- Paid-in, paid-out, and safe-drop require a non-empty reason.
- A cash sale and a cash refund create their corresponding drawer events in the same transaction as their source fact.
- Expected cash equals opening float plus all signed drawer events.
- A cashier can add manual events only to their open shift. Admins can view all shifts and approve an out-of-policy close.
- The drawer-close threshold is configured in piasters. A cashier whose absolute variance meets or exceeds it must supply an active manager PIN; an admin can close directly.
- Row locks serialize closing so two concurrent closes cannot both succeed.

## UI and reporting

The open-shift screen adds paid-in, paid-out, and safe-drop controls. The close dialog shows expected cash, counted cash, variance, and a manager-PIN field when required. The Z report lists each event class and tender totals separately.

## Security and validation

The database RPCs validate all amounts, reasons, ownership, open-shift state, and manager approval. RLS exposes only a cashier's own shift events; admins may view all events. No update/delete policies exist for event history.

## Verification

PGlite tests cover reason validation, ownership, expected-cash math including refund and safe drop, manager threshold denial/approval, and concurrent close rejection. UI validation uses Zod and localized errors in Arabic and English.
