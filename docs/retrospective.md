# Project retrospective

## React / Next.js concepts to review
- **Server vs Client Components**: what runs where, why `"use client"` is only on interactive leaves (register, forms), and why server actions replace API calls for mutations.
- **Hooks and effects**: `useEffect` cleanup (global scanner listener, timers, online/offline events), dependency arrays, and when a derived value should be computed instead of stored in state.
- **State placement**: Zustand for the cart (client state), TanStack Query / server components for server data, URL for filters.
- **Route conventions**: `layout.tsx`, `loading.tsx`, `error.tsx`, middleware/proxy, route groups `(app)` / `(auth)`.
- **next-intl**: message namespaces (keys cannot contain dots), RTL via `dir`, locale-aware formatting.
- **Forms and validation**: Zod on client and server, server actions returning typed results.
- **React Compiler caveats**: libraries returning unstable functions (TanStack Table) need `"use no memo"`.

## What to highlight in a CV / portfolio
- A production-style POS for a real Egyptian supermarket: bilingual AR/EN with full RTL, keyboard-first register, USB and camera barcode scanning.
- Money correctness: integer piasters, per-line VAT, immutable receipt snapshots, cost snapshots for profit.
- Database-enforced integrity: single-transaction checkout RPC, RLS for every table, immutable audit ledgers, single-use manager approvals.
- Offline-first checkout: IndexedDB outbox with idempotent, ordered sync.
- Operations: payments state machine, ESC/POS printing, Cairo business-day reports, structured logging, alerting, backups, CI with 36 PGlite-backed test suites.
- AI assistant with provider fallback, rate limiting and a read-only tool boundary.
