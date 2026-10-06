# Cachier — Supermarket POS

Bilingual (AR/EN) point-of-sale web app for a supermarket in Egypt.
Next.js 16 (App Router) · React 19 · TypeScript · Tailwind + shadcn/ui · Supabase · next-intl.

## Start here

- New to the project? [docs/PROJECT-EXPLAINED.en.md](docs/PROJECT-EXPLAINED.en.md) · بالعربي: [docs/PROJECT-EXPLAINED.ar.md](docs/PROJECT-EXPLAINED.ar.md)
- What is wrong or missing today: [docs/PROJECT-REVIEW.md](docs/PROJECT-REVIEW.md)
- Plan to production (web, desktop, Android): [docs/PRODUCTION-PLAN.md](docs/PRODUCTION-PLAN.md)

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

## Returns, refunds, exchanges, and voids

Completed sales are never edited or deleted. A return creates its own immutable document linked to the original receipt and records the actor, reason, refund tender, item snapshots, timestamp, and stock disposition. A restocked return adds stock through a positive `stock_movements` entry; a no-restock return leaves stock unchanged. Cashiers must provide a manager PIN for returns at or above the configured threshold.

Use **Record return & start exchange** to save the return first, then create the replacement sale through normal checkout. A **void** cancels an unpaid in-progress cart only; once a sale is completed, use a return/refund instead.

## Cash drawer reconciliation

Each shift uses the fixed **Main Register** drawer. Cash sales and cash refunds are recorded automatically in its immutable event ledger. A cashier can also record a **paid-in**, **paid-out**, or **safe drop** from the Shifts page; every manual movement needs a reason and cannot be edited or removed later.

At close, expected cash is the opening float plus all signed cash-drawer events. Enter the physical count to record the over/short variance. If the configured threshold is met or exceeded, an active manager must approve the close with their PIN. The Z-report retains the tender totals and each cash-movement category for the closed shift.
