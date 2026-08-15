# CLAUDE.md — Supermarket POS Project

## What this project is

A production-grade supermarket cashier (POS) web app for a real supermarket in Egypt. Runs on a counter device (laptop / mini-PC / tablet, landscape). Not a demo — deployable.

## Who you're working with

The developer is mid-level with ~3.5 years in **Vue 3 / Nuxt 3 / Vuetify**, using this project to **learn React + Next.js**. When a React pattern differs meaningfully from Vue (JSX vs templates, hooks vs Composition API, Zustand vs Pinia, context vs provide/inject), add ONE short line mapping it to the Vue equivalent. Keep it brief — build first, teach in passing.

## Tech stack (fixed — never substitute)

- Next.js 15+ (App Router) · React 19 · TypeScript (strict, no `any`)
- Tailwind CSS + shadcn/ui
- Zustand (client state: cart, UI) · TanStack Query (server state)
- Supabase: Postgres, Auth, RLS, Realtime
- next-intl (AR/EN, RTL) · Recharts · next-pwa/Serwist
- Deploy target: Vercel + Supabase cloud

## Business rules

- Currency: **EGP**. All money as integers in piasters in app code, `numeric` in Postgres. NEVER float arithmetic on currency.
- VAT default **14%**, stored per-product (`tax_rate`) — some goods are 0%/exempt.
- **Bilingual AR (RTL) / EN (LTR)** from day one. Every user-facing string goes through next-intl. Test layouts in RTL.
- Products can be per-piece or per-kg (decimal quantities for weighted items).

## Data model (source of truth)

Tables: `categories`, `products` (unique indexed `barcode`, name_ar/name_en, price, cost, tax_rate, stock_qty, low_stock_threshold, unit, active), `profiles` (role: admin|cashier, pin_hash), `shifts` (opening_float, closing_counted, expected_cash), `sales` (sequential sale_number, totals, payment_method cash|card, amount_tendered, change_due), `sale_items` (**name/price/tax_rate snapshots — mandatory**, numeric qty, line_discount), `stock_movements` (qty_change, reason: sale|received|damaged|correction, reference_id).

Checkout = ONE Postgres transaction (RPC function): insert sale + items, decrement stock, log stock_movements. Never do this as separate client calls.

Historical receipts must never change when products are edited — hence the snapshots.

## Roles & security

- **admin**: everything. **cashier**: register + own shifts only.
- Enforce with **RLS policies**, not just UI hiding. Every table gets policies.

## Architecture rules

- Server Components by default; Client Components only where interactivity demands (register, forms, scan modal).
- Zod validation on every mutation, client AND server.
- Data access isolated in `lib/supabase/` — no queries inside components.
- Receipt rendering behind a clean interface (`lib/receipts/`) so a thermal ESC/POS driver can be added later without touching register logic.
- Data layer designed so an offline IndexedDB queue can be inserted later (deferred, don't build yet).
- Register screen: fully keyboard-operable (scan → qty → checkout, no mouse).
- Errors → user-friendly AR/EN toasts. No silent failures.

## Hardware notes

- USB barcode scanner = keyboard emulation. Global keydown listener on the register: detect rapid keystroke bursts ending in Enter, distinguish from human typing, work regardless of focus.
- Camera scanning: modal with `html5-qrcode` or ZXing. Support EAN-13, EAN-8, Code 128, QR.

## Deferred (design for, don't build)

Offline queue-and-sync · thermal ESC/POS printing · returns/refunds · multi-branch.

## Working style

- Work one phase at a time (see `prompts/phase-1.md` … `phase-6.md`). Never jump ahead.
- Every phase ends runnable, with: what was built, manual test steps, and 2–3 React↔Vue concept notes.
- Give full file paths for every file created/edited. Commit-sized steps.
