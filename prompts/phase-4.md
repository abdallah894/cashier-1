# Phase 4 — Receipts

Read CLAUDE.md. Phases 1–3 complete.

## Tasks

1. **Receipt renderer** behind a clean interface in `lib/receipts/` — takes a sale (with items) and returns renderable receipt data. Register logic must not know how receipts are printed. (This is the seam where thermal ESC/POS plugs in later — do NOT build thermal now.)
2. **80mm print view:** dedicated receipt page/component styled for 80mm paper via CSS `@media print` — store name/address (configurable constants for now), date/time, sale_number, cashier name, line items (name in current UI language, qty, unit price, line total), discount, VAT breakdown by rate, grand total, payment method, tendered, change, thank-you line, and a barcode or QR encoding the sale_number.
3. **Print flow:** after checkout, receipt view opens with an auto-print option and a reprint button. Browser print dialog targets the receipt only (hide app chrome).
4. **PDF download:** generate a downloadable PDF of the same receipt (client-side lib is fine). Arabic text must render correctly — pick a lib/font combo that handles RTL Arabic properly and embed the font.
5. **Sales history page:** searchable list (by sale_number, date range, cashier) with a detail view and reprint/re-download from any past sale — rendered from the **snapshots**, proving old receipts survive product edits.
6. Localized AR/EN; the receipt prints correctly in both.

## Done when

- Completing a sale opens the receipt and prints cleanly at 80mm width
- PDF downloads with correct Arabic rendering
- Editing a product's price does NOT change an old receipt (snapshot verified)

End with: summary, manual test steps, 2–3 React↔Vue notes.
