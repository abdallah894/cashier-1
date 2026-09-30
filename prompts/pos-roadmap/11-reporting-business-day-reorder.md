# Implement operational reports, Cairo business day, and reorder workflow

## Goal

Turn sales and stock data into daily store control.

## Build

Add store timezone/business-day close, VAT/tax export, tender/discount/refund/void reporting, stock movement and valuation/aging reports, low-stock alert queue, reorder suggestions, and supplier links.

## Preserve

Money is piasters and reports must state gross vs net explicitly. Historic cost must use the approved cost-history design.

## Acceptance

- Cairo day boundaries are deterministic across DST.
- Every report is permission-scoped and exportable.
- Reorder suggestions explain their inputs, not just a number.
- Add boundary/date, permission, and aggregation tests.
