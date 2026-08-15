# Phase 1 — Foundation

Read CLAUDE.md first. Build the project foundation. Nothing user-facing yet beyond a working shell.

## Tasks

1. **Scaffold** Next.js 15+ (App Router, TypeScript strict) with Tailwind, shadcn/ui, ESLint + Prettier.
2. **i18n:** next-intl with `ar` and `en` locales, locale switcher, `dir="rtl"` handling on `<html>` for Arabic. Prove it with a placeholder home page rendered in both directions.
3. **Supabase:** client setup in `lib/supabase/` (browser + server clients, typed with generated types).
4. **Full SQL schema** in `supabase/migrations/`: all tables from CLAUDE.md, FKs, unique index on `products.barcode`, sequential `sale_number` (Postgres sequence), and the **transactional checkout RPC function** (`create_sale`): inserts sale + sale_items with snapshots, decrements stock, writes stock_movements — all or nothing, with a stock-sufficiency check.
5. **RLS policies** on every table for admin/cashier roles (profiles.role). Deny by default.
6. **Seed script:** ~30 realistic Egyptian supermarket products (names in Arabic AND English — rice, oil, molokhia, juice, cleaning supplies, a couple of per-kg items like tomatoes), 6–8 categories, one admin and one cashier profile.
7. **App shell:** sidebar layout (register / products / reports / shifts placeholders), locale + theme toggle.

## Done when

- `npm run dev` shows the shell in AR (RTL) and EN (LTR)
- Migrations apply cleanly to a fresh Supabase project; seed runs
- Calling `create_sale` from the SQL editor with sample items creates a sale, decrements stock, and rolls back entirely if stock is insufficient

End with: summary, manual test steps, 2–3 React↔Vue notes.
