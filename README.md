# Cachier — Supermarket POS

Bilingual (AR/EN) point-of-sale web app for a supermarket in Egypt.
Next.js 16 (App Router) · React 19 · TypeScript · Tailwind + shadcn/ui · Supabase · next-intl.

Money convention: **all amounts are integer piasters** (EGP 48.95 → `4895`) — in app code and in the database. Prices are VAT-inclusive; `tax_rate` is a fraction per product (`0.14`, or `0` for exempt basic foods).

## Setup

1. **Install**

   ```bash
   npm install
   ```

2. **Supabase** — create a project at [database.new](https://database.new), then:

   ```bash
   cp .env.example .env.local   # fill in URL + anon key + service role key
   npx supabase link --project-ref YOUR_PROJECT_REF
   npx supabase db push         # applies supabase/migrations/
   ```

3. **Seed** (creates admin + cashier users, 8 categories, 35 products):

   ```bash
   npm run seed
   ```

4. **Run**

   ```bash
   npm run dev
   ```

   Open http://localhost:3000 — redirects to `/ar` (RTL). Switch language from the globe icon in the header.

## Scripts

| Script              | What it does                                |
| ------------------- | ------------------------------------------- |
| `npm run dev`       | dev server                                  |
| `npm run build`     | production build                            |
| `npm run lint`      | ESLint                                      |
| `npm run typecheck` | `tsc --noEmit`                              |
| `npm run format`    | Prettier                                    |
| `npm run seed`      | seed users/categories/products (idempotent) |
| `npm run db:types`  | regenerate `lib/supabase/database.types.ts` |

## Structure

- `app/[locale]/(app)/` — pages behind the sidebar shell (register, products, reports, shifts)
- `i18n/` + `messages/` — next-intl config and AR/EN catalogs
- `lib/supabase/` — browser/server clients + generated DB types (all data access lives here)
- `supabase/migrations/` — schema, `create_sale` checkout RPC, RLS policies
- `scripts/seed.ts` — demo data

## Checkout invariant

`create_sale(p_items, p_payment_method, …)` is a single Postgres transaction: it validates stock (row-locked), inserts the sale + snapshot items, decrements stock and logs `stock_movements` — all or nothing. Receipts are immutable (no UPDATE/DELETE policies on `sales`/`sale_items`), and product name/price/tax are snapshotted per line so editing a product never changes history.
