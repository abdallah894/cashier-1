# Go-live checklist

Work top to bottom. Do every step on a **staging** Supabase project and Vercel preview first, then repeat on production. Tick a box only after you have seen it work.

## 0. Before you start
- [ ] `main` is pushed and the GitHub Actions CI run is green (lint, typecheck, secrets, migrations, tests, build).
- [ ] You have: Supabase staging + production projects, a Vercel project connected to the repo, the production domain, and the shop's printer / scanner / drawer on site.
- [ ] If production already holds real data: take a full backup first (`scripts/backup-db.sh`) and keep the file.

## 1. Database
- [ ] `supabase link --project-ref <ref>`
- [ ] `supabase db push` applies all migrations with no errors (the latest, `20261014090000_least_privilege_and_fk_indexes.sql`, changes permissions: test sign-in and one sale right after).
- [ ] `npm run db:types`; commit the file if it changed.
- [ ] Seed script run on **staging only**. Never seed demo users or demo products on production.
- [ ] In the SQL editor: `select * from public.verify_database_integrity();` returns only `ok = true`.

## 2. Supabase settings
- [ ] Auth: public sign-ups disabled (staff are created from the Users page only).
- [ ] Auth: Site URL and redirect URLs set to the final domain.
- [ ] Plan: Pro (daily backups, point-in-time recovery, no pausing).
- [ ] Real admin user created; demo credentials (`123`) do not exist on production.
- [ ] Admin PIN set; every cashier has a PIN.

## 3. Vercel environment variables (Production)
Generate secrets with `openssl rand -hex 32`. Server-only values must never start with `NEXT_PUBLIC_`.
- [ ] `NEXT_PUBLIC_SUPABASE_URL`
- [ ] `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- [ ] `SUPABASE_SERVICE_ROLE_KEY`
- [ ] `OPS_API_TOKEN`
- [ ] `CRON_SECRET`
- [ ] `ALERT_WEBHOOK_URL` and `ERROR_WEBHOOK_URL` (Slack/Teams/any JSON receiver)
- [ ] `GROQ_API_KEY` / `GEMINI_API_KEY` (optional; the assistant is simply off without them)
- [ ] `PAYMENT_SANDBOX_WEBHOOK_SECRET` (only if using the sandbox provider)
- [ ] Redeploy after changing variables.

## 4. Store setup (in the app, as admin)
- [ ] Store name (AR + EN), address, phone, **tax registration number** and receipt footer: Reports → Store settings. Print a receipt and check every line; until this is filled in, receipts show a neutral "Supermarket" and no tax number.
- [ ] Business-day cutoff and timezone (`Africa/Cairo`).
- [ ] Categories, products (barcode, AR/EN names, price, cost, tax rate, unit, low-stock threshold) via CSV import; spot-check 10 products.
- [ ] Suppliers and product-supplier links.
- [ ] Staff accounts, roles and capabilities (manager approval, void, discount override, stock correction).
- [ ] Tills and devices registered on `/devices`.
- [ ] Discount approval threshold and cash-variance threshold reviewed.

## 5. Monitoring and backups
- [ ] `GET /api/health` returns ok; `GET /api/health?deep=1` with `Authorization: Bearer $OPS_API_TOKEN` shows database ok.
- [ ] Vercel cron for `/api/ops/check` is listed under Cron Jobs and ran at least once.
- [ ] A test alert reaches your webhook (trigger one by temporarily skipping a backup report, or call `/api/ops/check`).
- [ ] `scripts/backup-db.sh` scheduled daily on a machine that is not the till, with `BACKUP_AGE_RECIPIENT` (or `BACKUP_GPG_RECIPIENT`) and `BACKUP_UPLOAD_CMD` set; first run reported `ok` and both files (`pos-*.dump.age` and `pos-*-auth.dump.age`) are in the off-site storage. The age **private key** is stored somewhere else (password manager + printed copy).
- [ ] One restore drill done into a scratch project (auth dump first, then public) with `scripts/restore-verify.ts`, **and** a real staff member signed in on the restored project; date and result written down.

### Security headers rollout
- [ ] `CSP_MODE=report-only` in production. After a few trading days with nothing in the logs for `csp_violation`, switch to `enforce` ([../security.md](../security.md)).

## 6. Counter-device test (staging, then production)
- [ ] Chrome or Edge on the counter PC; app installed as PWA and opens full screen.
- [ ] Scan with the USB scanner (bursts ending in Enter) and with the camera; unknown barcode flow works. Scan while the payment window is open: nothing is typed or confirmed and a message appears.
- [ ] Open shift with a float; register is blocked without one.
- [ ] Sell: per-piece, per-kg (e.g. 1.25 kg), a line discount, a sale discount, a promotion, a customer attached.
- [ ] Large discount asks for manager approval; cashier cannot bypass it.
- [ ] Cash sale shows correct change; card sale needs the terminal approval code.
- [ ] If the shop has a deli/produce scale: Store settings → Scale labels set; each scale product has its PLU and unit kg; scan a printed label → right product, right weight. Scan a label whose PLU no product has → a clear message, no wrong item added. Also `3*` then scan adds three; F4/F5/F6/F7 and Ctrl+Del work from the keyboard.
- [ ] Print the receipt (80 mm), reprint, gift receipt, PDF download with correct Arabic.
- [ ] Open the cash drawer from the receipt screen; it is audited.
- [ ] Return a restocked item and a card refund; stock and drawer move as expected.
- [ ] Go offline (unplug or dev-tools offline), make 2 sales, reconnect: they sync, stock decrements, no duplicates. The header shows "Prices from …" while offline. Change a price while the till is offline: that sale is rejected as "total changed" and appears in Offline sales for a manager.
- [ ] Paid-in / paid-out / safe drop recorded with a reason.
- [ ] Close shift: counted cash vs expected; a large variance needs a manager; Z-report prints and matches the drawer.
- [ ] Reports: daily summary, VAT, stock valuation, reorder suggestions match a hand calculation from 3 known sales.
- [ ] Stocktake: count, submit, approve; adjustments appear in stock movements.
- [ ] Purchase order: create, place, receive; stock and cost update.
- [ ] Every screen checked in Arabic (RTL) and English (LTR).
- [ ] Cashier account cannot open admin pages (`/products/new`, `/users`, `/reports`, `/devices`) and gets nothing from the API.

## 7. Cutover
- [ ] Production domain added in Vercel; HTTPS works.
- [ ] Opening stock counted and entered (a stocktake approved before the first sale).
- [ ] Staff trained: scanning, shift open/close, returns, offline banner, what to do when the printer fails.
- [ ] Pilot day: run beside the old process; compare end-of-day totals.
- [ ] Runbook (`docs/operations/runbook.md`) printed or saved where the manager can find it.
- [ ] Someone is named on call for the first week and receives the alert webhook.

## 8. After launch
- [ ] Day 1: review `/payments`, offline sales rejected, and `ops_alerts()`.
- [ ] Week 1: confirm daily backups arrived and daily summaries close cleanly.
- [ ] Monthly: `npm audit`, update Next.js, rotate keys that left a person's hands.
- [ ] Quarterly: restore drill.

## Known limits
- Card payments are recorded against the terminal approval code; no live payment gateway is connected.
- Printing and drawer control need WebUSB (Chrome/Edge on desktop) and a supported device profile.
- The offline queue covers sales only; product edits and reports need a connection.
- Loyalty points, gift cards and multi-location transfers are not built.
