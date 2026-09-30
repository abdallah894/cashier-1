# Implement cash-drawer reconciliation

## Goal

Make each till session accountable beyond recorded cash sales.

## Build

Extend shifts or add drawer sessions and immutable cash events: opening float, cash sale, paid-in, paid-out, safe drop, refund, closing count, expected amount, variance, reason, and approval. Associate every event with staff, device/till, and time.

## Preserve

Do not derive expected cash only from sales. Keep existing shift records compatible and use integer piasters.

## Acceptance

- Paid-in/out require reason and permission.
- Close computes variance and blocks or escalates according to configured policy.
- Z report includes event/tender breakdown.
- RLS and audit history prevent silent edits; add tests for variance and concurrent close attempts.
