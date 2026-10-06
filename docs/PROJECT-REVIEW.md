# Project review — Cachier POS

_Reviewed: 2026-10-06, branch `claude/ecstatic-bardeen-4fih9n` (head `3cb4759`)._

This is a code review of the whole repository: database, server, register, offline mode, printing, desktop and mobile shells, and operations scripts. Every finding below was checked against the code; the file and line are given so you can open it and see the problem yourself.

**How to read the severities**

| Level  | Meaning                                                                                | When to fix                 |
| ------ | -------------------------------------------------------------------------------------- | --------------------------- |
| **P0** | Lets someone change money or records they should not, or breaks a legal/recovery need. | Before the first real sale. |
| **P1** | Gives wrong numbers or stuck data in normal use, but needs a specific situation.       | Before go-live (Phase 0).   |
| **P2** | Missing feature, rough edge, or hardening that a production supermarket will want.     | Phases 1–4 of the plan.     |

The fixes are scheduled in [PRODUCTION-PLAN.md](PRODUCTION-PLAN.md). If you are new to the project, read [PROJECT-EXPLAINED.en.md](PROJECT-EXPLAINED.en.md) (or [the Arabic version](PROJECT-EXPLAINED.ar.md)) first.

---

> **Status (2026-10-06): all six P0 and all eight P1 findings below are fixed** (see "Phase 0" in [PRODUCTION-PLAN.md](PRODUCTION-PLAN.md)), along with the P2 items "stale `app/sw.ts` comment", "no deep health check", "unvalidated id arguments" and the offline catalog-age warning. The findings are kept below as the record of what was wrong. **Phase 1 (2026-10-06)** also fixed P2 items 2 (scale-label barcodes, plus 0.1 kg steps), 3 (register keyboard gaps) and 5 (raw English device errors); P2 item 1 (ETA) is **only partly done** — the queue exists, the connection to the authority does not ([eta.md](eta.md)). **Phase 2 (2026-10-06)** added a CSP (report-only), rate limits, browser-crash reporting, generic webhook errors and the active-admin page gate (P2 items 9, 10, 11, 13; the "no browser tests" item 16 is half done — see [testing.md](testing.md)), and fixed two defects the review missed: the placeholder landing page and the offline-receipt navigation. **Phase 3 (2026-10-06)** built native Windows printing, auto-update and crash recovery for the desktop app (P2 items 4 and 7 — built, awaiting a test on a real Windows PC with a printer; see [desktop-printing.md](desktop-printing.md)). Still open: P2 item 12 (cashiers can read product cost) and items 6–7 for the Android/iOS apps (Phase 4).

## Summary

The project is in much better shape than a typical first POS. The core money path is correct: integer piasters everywhere, a single-transaction checkout, immutable receipts and ledgers, idempotent offline sync, and 36 database test suites in CI. The problems found are mostly **old permissive database policies from Phase 1 that later phases forgot to remove**, plus the pieces a real Egyptian supermarket needs that are not built yet (tax-authority e-receipts, scale barcodes, a native printer path).

| Severity | Count |
| -------- | ----- |
| P0       | 6     |
| P1       | 8     |
| P2       | 17    |

---

## P0 — fix before any real money goes through the till

### P0-1. A cashier can create sales directly, skipping checkout

- **Where:** `supabase/migrations/20260704120100_rls.sql:120-126` (policy `"sales: record own sale"`) and `:141-149` (policy `"sale_items: insert via own sale or admin"`). No later migration drops them.
- **What happens:** Any signed-in cashier can call the Supabase REST API with their own token and insert a row into `sales` with any total, any VAT and any items. Stock is not decremented, no payment row is written, and the trigger `sales_record_cash_drawer_event` (`20261001101500_cash_drawer_cash_sales.sql:48`) adds the fake amount to the cash drawer's expected cash.
- **Why it matters:** It defeats the rule "checkout = one Postgres transaction". A dishonest cashier could cover missing cash.
- **Fix:** New migration: `drop policy "sales: record own sale" on public.sales; drop policy "sale_items: insert via own sale or admin" on public.sale_items;`. The app never inserts into these tables directly (all sales go through `create_sale`, which is `security definer`), so nothing breaks. Add a case to `scripts/test-rls.ts` proving the insert is now refused.

### P0-2. A cashier can rewrite their own shift (float, count, close, reopen)

- **Where:** `supabase/migrations/20260704120100_rls.sql:101-112` (policies `"shifts: open own shift"` and `"shifts: close own shift or admin"`). There is no trigger guarding `shifts`.
- **What happens:** A cashier can `update shifts set closing_counted = expected_cash` to hide a shortage, change `opening_float`, close a shift without the manager approval that `close_shift` enforces, or set `closed_at = null` to reopen a closed shift.
- **Fix:** Add an `open_shift(p_opening_float)` RPC (today `lib/actions/shifts.ts:30-31` inserts directly), switch the action to it, then drop the insert and update policies on `shifts`. Shifts change only through `open_shift` / `close_shift`.

### P0-3. "Switch cashier" by PIN can log into an admin account

- **Where:** `lib/actions/auth.ts:71-115` (`switchCashier`) and `lib/supabase/queries/profiles.ts:38-45` (the list of switchable users).
- **What happens:** The switch checks that the _target_ is active and the PIN is right, but never checks the target's **role**, and never checks that the **current** user is still active. Admins are in the list. A 4-digit PIN with 5 tries per 15 minutes is about 480 guesses a day — a determined cashier would find an admin PIN within weeks, and can also lock the admin out on purpose.
- **Fix:** Only allow switching to `role = 'cashier'` profiles; require the caller to be active; record failed attempts in `audit_events`; consider 6-digit PINs for admins. Admins log in with email + password.

### P0-4. Receipts print a fake store name, address and tax number

- **Where:** `lib/receipts/store-info.ts:5-12` — hard-coded `"Cachier Supermarket"`, `"15 Tahrir St."`, `taxId: "100-200-300"`. Used by `lib/receipts/build.ts:27`, `build-return.ts:38`, `z-report.ts:46` and `components/offline/provisional-receipt-view.tsx:18`.
- **What happens:** Every printed receipt shows demo data. `store_settings` (`20261012090000_reporting_ops.sql:25-32`) has no name/address/phone/tax columns, and there is no screen to set them — yet `docs/operations/go-live-checklist.md` step 4 asks you to set them "in the app".
- **Why it matters:** A VAT receipt with the wrong tax registration number is a legal problem in Egypt.
- **Fix:** Add `store_name_ar/en`, `address_ar/en`, `phone`, `tax_registration_number`, `commercial_register`, `receipt_footer_ar/en` to `store_settings`; extend `update_store_settings`; add the fields to `components/reports/store-settings-dialog.tsx`; load them once in the receipt builders instead of `STORE_INFO`. Cache them in IndexedDB for offline receipts.

### P0-5. Scanning during the payment dialog can complete a sale with a wrong amount

- **Where:** `components/register/register.tsx:62,81` (`useBarcodeScanner(handleScan, { enabled: !dialogOpen })`), `components/register/checkout-dialog.tsx:240` (tendered input), `lib/validation/sale.ts:14` (`amount_tendered: z.number().int().min(0)` — no maximum).
- **What happens:** While the checkout dialog is open the scanner listener is off, so a scanned barcode is typed as normal keys into the "amount tendered" box, and the scanner's trailing **Enter** submits the sale. A 13-digit EAN becomes billions of piasters tendered and a huge "change due" on the receipt and the drawer record.
- **Fix:** Keep the scan detector running while dialogs are open but in "swallow" mode (consume the burst, show a toast "finish payment first"); add a sane upper bound for tendered cash (for example total + 100,000 EGP) in Zod and in `create_sale`.

### P0-6. Backups cannot be restored on their own and are kept on one disk

- **Where:** `scripts/backup-db.sh:22` uses `pg_dump --schema=public`. But `public.profiles.id` references `auth.users(id)` (`supabase/migrations/20260704120000_schema.sql:52`).
- **What happens:** A restore into a fresh project has no `auth.users`, so every profile, shift and sale fails its foreign key and staff cannot log in. The dump is also written unencrypted to a local `./backups` folder only.
- **Fix:** Dump `auth` as well (or use `supabase db dump` for roles + schema + data), encrypt the file (`age` or `gpg`), copy it off-site (S3 / Backblaze / Google Drive), and update `scripts/restore-verify.ts` to check that staff can sign in after restore. Keep Supabase Pro's own daily backups/PITR on as well.

---

## P1 — wrong numbers or stuck data in specific situations

### P1-1. Saving a product overwrites stock and can undo sales

- **Where:** `lib/validation/product.ts:24` (form schema includes `stock_qty`), `lib/actions/products.ts:37-40` (`.update(parsed.data)`).
- **What happens:** The edit form posts the stock number it loaded earlier. Sales made while the form was open are silently reversed, and no `stock_movements` row explains the change.
- **Fix:** Remove `stock_qty` from the edit schema. Stock changes only through `adjust_stock`, receiving, stocktakes and sales (all of which write the ledger). New products start at 0 and get an opening-stock movement.

### P1-2. `create_sale` can deadlock two tills and accepts odd numbers

- **Where:** `supabase/migrations/20261010090000_payments.sql:735-738` locks product rows `for update` in cart order; `:722-723` casts qty and discount to plain `numeric`; `:670-682` never checks `profiles.active`.
- **What happens:** Two tills selling {A, B} and {B, A} at the same moment can deadlock; Postgres kills one checkout. A direct RPC call can send qty `0.4355` (priced at full precision, stored rounded) or a fractional `amount_tendered`. A deactivated user with a still-valid token can keep selling.
- **Fix:** Lock all products in one `select … where id = any(…) order by id for update` before the loop; reject qty with more than 3 decimals and non-integer money inside the RPC; check `active` at the top.

### P1-3. Deactivating a staff member does not log them out

- **Where:** `lib/actions/users.ts:104-117` (`toggleStaffActive`) only flips `profiles.active`.
- **Fix:** Also call `admin.auth.admin.updateUserById(id, { ban_duration: "876000h" })` (and unban on reactivate) so their session dies.

### P1-4. Staff can mark a sandbox card payment as "captured" themselves

- **Where:** `record_payment_result` in `supabase/migrations/20261010090000_payments.sql:245-285` only rejects `provider = 'cash'`.
- **Fix:** For any provider that has a webhook, the result must come from `apply_provider_event` (service role) only. Staff may record results only for the manual "card terminal + approval code" flow.

### P1-5. Offline sales can be recorded at a different total than the customer paid

- **Where:** `lib/offline/submit.ts:11-21` sends no `expectedTotal`; `lib/offline/outbox.ts:4-12` (`EnqueueInput`) has no `customerId`.
- **What happens:** If a price changes between the offline sale and the sync, the server records the new price — the receipt in the customer's hand no longer matches the database. The attached customer is lost.
- **Fix:** Store the provisional total and customer in the outbox entry and send `expectedTotal`; on mismatch mark the sale `rejected` with a clear reason for a manager to resolve (or accept the offline price snapshot, which is the more common POS policy — decide and document it).

### P1-6. Two open tabs can sync offline sales out of order

- **Where:** `lib/offline/sync.ts:16` — the "only one drain at a time" guard is a `WeakMap` inside one tab.
- **Fix:** Wrap `drainOutbox` in `navigator.locks.request("cachier-outbox", …)` so only one tab in the browser drains at a time. Add a test with two `OfflineDb` instances on the same fake IndexedDB.

### P1-7. An expired login while offline silently stalls the queue

- **Where:** `lib/offline/submit.ts:28` throws `notAuthorized`; `components/offline/sync-provider.tsx:66,75` just retries every 30 s. Nothing tells the cashier.
- **Fix:** Expose a `needsSignIn` state from the sync provider and show a red banner "Sign in again to send N queued sales" (AR/EN). Also add `.catch` to the fire-and-forget calls at `sync-provider.tsx:66` so IndexedDB errors become toasts, not unhandled rejections.

### P1-8. Offline prices can be days old without anyone knowing

- **Where:** `lib/offline/catalog.ts:15` writes `catalogRefreshedAt`, but no component reads it.
- **Fix:** Show "Offline prices from HH:MM" in the network indicator, warn after 24 h, and refuse offline sales after a configurable maximum age.

---

## P2 — missing features and hardening

### Egypt-specific business needs

1. **No Egyptian Tax Authority (ETA) e-receipt integration.** The receipt QR is only the sale number (`lib/receipts/build.ts:48`). Retailers in the B2C e-receipt programme must submit each receipt to the ETA and print its UUID/QR. Check the store's obligation with its accountant; the plan (Phase 1) builds a submit queue for it.
2. **No support for scale-printed weighed barcodes.** Lookups are exact (`components/register/register.tsx:70`, `lib/offline/catalog.ts:41`). A deli/produce label such as `2 PPPPP WWWWW C` (prefix 20–29, item code + weight or price) opens the "unknown barcode" dialog. Also, `+`/`-` step a kg line by a whole kilo (`register.tsx:137-141`).
3. **Keyboard gaps on the register.** No shortcut for line discount, sale discount, void cart, customer, promo code or a `3*` quantity multiplier (`components/register/shortcuts-bar.tsx:8-17`); arrows and `+`/`-` stop working while the search box has focus (`register.tsx:121`).

### Hardware

4. **Printing works only through WebUSB** (`lib/devices/transport.ts`). On Windows, most thermal printers must have their driver replaced with WinUSB (Zadig) first, which then breaks normal Windows printing. Network (TCP 9100) and Bluetooth printers are not supported. The Electron shell exposes only metadata (`desktop/preload.cjs:4-8`) — it could print natively.
5. **Raw English device errors in toasts**: `components/devices/devices-panel.tsx:109,125` and `components/receipts/receipt-actions.tsx:155,192` show `error.message` such as "USB transfer stall" even in Arabic.

### Apps

6. **iOS shell will not load the site**: `mobile/capacitor.config.json` sets `limitsNavigationsToAppBoundDomains: true` but `mobile/ios/App/App/Info.plist` has no `WKAppBoundDomains` list. (Android first, so this is for later.)
7. **No auto-update, no signing, no native features in the shells** — covered in the plan, Phases 3–4.
8. **Service worker has a stale comment and no offline navigation fallback** (`app/sw.ts:5-8`). After an offline sale, `router.push('/offline-sales/…')` (`components/register/checkout-dialog.tsx:112`) fails if that page was never cached.

### Security hardening

9. **Webhook returns raw database error text** (`app/api/payments/webhook/sandbox/route.ts:41`) and has no timestamp/replay window.
10. **No rate limiting** on `/api/health` (which runs a service-role query, `app/api/health/route.ts:10-11`), `/api/ops/*` and the webhook.
11. **No Content-Security-Policy** (`next.config.ts` explains why; still worth a nonce-based rollout).
12. **Cashiers can read product cost prices** (`rls.sql:72-75` exposes every column).
13. **Page admin gate ignores `active`** (`lib/supabase/queries/profiles.ts:28`); RLS still protects the data, but a deactivated admin sees admin pages.
14. **A few actions skip Zod on the id argument** (`updateCategory`, `deleteCategory`, `updateProduct`, `deleteProduct`) — low impact, the admin check runs first.

### Docs, tests and housekeeping

15. **The runbook describes `/api/health?deep=1`** but `app/api/health/route.ts` has no deep mode.
16. **No browser end-to-end tests.** All 36 suites run against an in-memory database (PGlite); nothing clicks through the real register, keyboard flow, RTL layout or two-tab sync.
17. **`package.json` metadata is boilerplate** (`description`, `main`, `license`), and the comment at `payments.sql:716` suggests receipt numbers never skip, but a checkout that fails _after_ the sale insert (for example a promotion limit or approval error) still burns a number. That is normal for Postgres sequences; just document it for the accountant.

---

## What is already done well

- **RLS is on for all 44 tables**; tables without a policy deny everything.
- **Every `security definer` function pins `search_path = ''`**, and `20261014090000_least_privilege_and_fk_indexes.sql` revokes execute from `anon`/`public`.
- **Money is integer piasters** everywhere (`lib/money.ts`); the only `toFixed` calls are on non-money averages.
- **`create_sale`** takes prices from the server, locks stock rows, checks cumulative stock per product, is idempotent (advisory lock on the key), checks `p_expected_total`, and binds discounts to manager approvals.
- **Ledgers are immutable** (triggers block update/delete/truncate on sales, movements, drawer events, audit).
- **Offline outbox** is crash-safe: claims are atomic, stuck `syncing` rows are requeued, the server deduplicates by idempotency key.
- **Translations**: `messages/ar.json` and `messages/en.json` have the same 1143 keys.
- **Secrets**: timing-safe bearer and HMAC checks that fail closed; service-role client is `server-only`.
- **CI** runs lint, typecheck, secret scan, migration validation, 36 test suites and a build on every PR.
