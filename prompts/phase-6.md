# Phase 6 — Reports & PWA

Read CLAUDE.md. Phases 1–5 complete. Admin-only analytics plus PWA groundwork.

## Tasks

1. **Reports dashboard (admin):**
   - Sales over time: day/week/month toggle, line or bar chart (Recharts) + summary cards (revenue, sale count, avg basket)
   - Top products by revenue and by quantity
   - Sales by category (chart)
   - Sales by cashier
   - Profit view: revenue vs cost (from snapshots + product cost), gross margin
   - Date-range picker driving everything; use SQL aggregation (views or RPCs with GROUP BY) — don't aggregate large datasets in JS
2. **CSV export** for each report, correct UTF-8 for Arabic.
3. **Charts in RTL:** verify axes/labels/tooltips behave in Arabic locale; localized number formatting.
4. **PWA groundwork (NOT full offline):**
   - Manifest: name, icons, standalone display, theme color → installable on the counter device, fullscreen
   - Service worker precaching the app shell and static assets
   - A visible online/offline indicator in the shell
   - Leave a clearly-marked seam (documented in code comments + a short `docs/offline-plan.md`) describing how the future IndexedDB sale queue will slot into the data layer
5. **Polish pass:** loading states, empty states, error boundaries, a final RTL sweep of every screen.

## Done when

- Reports match reality: make 3 known sales, verify totals/top-products/profit line up exactly
- App installs from Chrome and launches standalone fullscreen
- `docs/offline-plan.md` exists and describes the queue-and-sync design

End with: summary, manual test steps, 2–3 React↔Vue notes — plus a short project retrospective: which React concepts to review, and what to highlight from this project in a CV/portfolio.
