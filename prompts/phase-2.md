# Phase 2 — Products & Inventory

Read CLAUDE.md. Phase 1 must be complete. Build the admin catalog and stock management.

## Tasks

1. **Product list page:** shadcn data table — search (name_ar/name_en/barcode), category filter, active filter, low-stock highlight, pagination. Server Component fetching + client-side interactivity where needed.
2. **Product create/edit:** dialog or page form — barcode, name_ar, name_en, category, price, cost, tax_rate (default 14%), unit (piece/kg), stock_qty, low_stock_threshold, active, optional image upload to Supabase Storage. Zod validation both sides. Money inputs in EGP, stored as numeric — no float math.
3. **Category CRUD:** simple manage screen.
4. **Stock adjustments:** from a product, adjust stock with reason (received / damaged / correction) and note → writes `stock_movements`, updates `stock_qty` atomically (RPC or single update with movement insert in a transaction).
5. **Stock movement history** per product (who, when, why, how much).
6. **CSV import:** upload a CSV of products (template downloadable), preview with validation errors per row, then bulk insert. Handle Arabic text encoding correctly (UTF-8 with BOM tolerance).
7. All strings localized AR/EN; verify the data table and forms in RTL.

## Done when

- Full CRUD works in both languages/directions
- Stock adjustment shows in movement history and updates quantity atomically
- CSV import round-trips: export template → fill 5 rows (incl. Arabic names) → import successfully, and bad rows are reported clearly

End with: summary, manual test steps, 2–3 React↔Vue notes (forms and tables are a good place to contrast with Vuetify patterns).
