# Implement stocktakes and controlled reconciliation

## Goal

Replace ad-hoc corrections with auditable full and cycle counts.

## Build

Create count sessions with scope, frozen expected quantity, barcode/count entry, counted quantity, variance, reason, submit/review/approve states, and generated stock movements.

## Preserve

Stock remains decimal for kg products and integer-compatible for pieces. Existing movement history stays immutable.

## Acceptance

- Counts support pause/resume and scanner entry.
- Approval, not entry, changes stock.
- Concurrent stock movement is surfaced as a review conflict.
- Add migrations, RLS, count UI, variance report, and tests.
