# Production plan — web, desktop (Windows) and Android

_Written: 2026-10-06. Based on [PROJECT-REVIEW.md](PROJECT-REVIEW.md)._

**Goal:** Cachier runs the real supermarket's tills every day, with:

- the **web app** on Vercel + Supabase (one codebase, the "brain");
- a **desktop app** (Windows first; macOS/Linux builds come free) on the counter PC — the till;
- an **Android app** for the owner/manager — reports, alerts, stock counts, receiving and price checks with the phone camera. Counter selling stays on the desktop app. **iOS later.**

**Approach in one sentence:** keep one Next.js web app as the single source of truth, and make the Electron and Capacitor "shells" smarter only where a browser cannot do the job (native printing, auto-update, native scanner, push notifications).

```
          ┌──────────── Counter PC ────────────┐      ┌──── Manager's phone ────┐
          │  Desktop app (Electron)            │      │  Android app (Capacitor) │
          │  • loads the web app               │      │  • loads the web app     │
          │  • native printer + cash drawer    │      │  • native camera scanner │
          │  • kiosk, auto-update              │      │  • push notifications    │
          └────────────────┬───────────────────┘      └────────────┬─────────────┘
                           │  HTTPS                                │  HTTPS
                           ▼                                       ▼
                 ┌──────────────────────────────────────────────────────┐
                 │  Next.js web app on Vercel (pages + server actions)  │
                 └───────────────────────────┬──────────────────────────┘
                                             ▼
                 ┌──────────────────────────────────────────────────────┐
                 │  Supabase: Postgres + Auth + RLS + RPC functions     │
                 └──────────────────────────────────────────────────────┘
```

## Timeline at a glance

One developer, part-time help from the shop owner for testing. Effort is in working days.

| Phase | What                                    | Effort     | Ends when                                                       |
| ----- | --------------------------------------- | ---------- | --------------------------------------------------------------- |
| 0     | Fix blockers (security, money, backups) | 8–10 days  | Every P0/P1 in the review is fixed with a regression test       |
| 1     | Egypt essentials                        | 15–20 days | Real store identity on receipts, scale barcodes, ETA path ready |
| 2     | Quality gate                            | 8–10 days  | Browser E2E tests green in CI, CSP + rate limits on             |
| 3     | Desktop app production                  | 10–15 days | Signed, auto-updating Windows installer printing natively       |
| 4     | Android manager app                     | 15–20 days | App on Google Play (closed/internal track), push alerts working |
| 5     | Go-live                                 | 5–10 days  | Pilot day matches old process; staff trained; on-call named     |
| 6     | After launch                            | ongoing    | —                                                               |

Total to go-live: roughly **3–4 months** part-time, **8–10 weeks** full-time. Phases 3 and 4 can run in parallel with Phase 2 if two people work on it. **Do not skip Phase 0.**

---

## Phase 0 — Fix the blockers (8–10 days) — ✅ DONE (2026-10-06)

All items below are implemented, each with a regression test (suite count 36 → 40; `npm run test:all`, lint, typecheck, migration validation and the production build all pass). Notes where the implementation differs from the plan:

- **0.2** Instead of a new `open_shift` RPC, the insert policy stays (a cashier legitimately chooses their opening float) and a trigger refuses any shift that is created already closed; the cashier _update_ policy is dropped, so closing is only possible through `close_shift`. Same protection with far fewer code changes.
- **0.3** Failed PIN switches are written to the structured log (`pin_switch_failed`, `pin_switch_refused`), not the audit table, whose event kinds are a fixed whitelist.
- **0.6** The backup script now needs `BACKUP_AGE_RECIPIENT`/`BACKUP_GPG_RECIPIENT` and `BACKUP_UPLOAD_CMD` and refuses to run without them. **You must still do the one-time setup**: pick an off-site storage, create an `age` key pair and store the private key safely, then schedule the script.
- **0.10** Offline policy chosen: a sale whose total no longer matches the receipt the customer holds is **rejected** for a manager to resolve (it is never silently re-priced). Cached prices older than 24 h show a warning and older than 72 h (or never synced) block offline selling.
- Extra: the public `/api/health` caches its database answer for 5 s, and `?deep=1` now exists as documented.

**Migrations added:** `20261015090000_phase0_rls_lockdown`, `…090100_store_identity`, `…090200_create_sale_hardening`, `…090300_payment_capture_provider_only`. Apply with `supabase db push` outside trading hours, then test one sale (see the go-live checklist).

Rule for every item: write a failing test first in `scripts/test-*.ts` (follow `scripts/test-rls.ts`), fix, see it pass, then `npm run test:all`.

| #    | Task                                                                                                         | Files                                                                                                     | Days |
| ---- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | ---- |
| 0.1  | Drop direct-insert policies on `sales` / `sale_items` (P0-1)                                                 | new migration in `supabase/migrations/`, `scripts/test-rls.ts`                                            | 0.5  |
| 0.2  | Add `open_shift` RPC, drop shift insert/update policies (P0-2)                                               | new migration, `lib/actions/shifts.ts`, `scripts/test-shifts.ts`                                          | 1    |
| 0.3  | PIN switch: cashier targets only, caller must be active, audit failures (P0-3)                               | `lib/actions/auth.ts`, `lib/supabase/queries/profiles.ts`                                                 | 0.5  |
| 0.4  | Store identity in `store_settings` + admin form + receipts read it (P0-4)                                    | new migration, `components/reports/store-settings-dialog.tsx`, `lib/receipts/*`, `lib/offline/catalog.ts` | 2    |
| 0.5  | Scanner swallows bursts while dialogs are open; cap `amount_tendered` (P0-5)                                 | `hooks/use-barcode-scanner.ts`, `components/register/register.tsx`, `lib/validation/sale.ts`, migration   | 1    |
| 0.6  | Backups include `auth`, encrypted, copied off-site; restore drill signs in (P0-6)                            | `scripts/backup-db.sh`, `scripts/restore-verify.ts`, `docs/operations/runbook.md`                         | 1    |
| 0.7  | Remove `stock_qty` from product edit (P1-1)                                                                  | `lib/validation/product.ts`, `components/products/product-form.tsx`                                       | 0.5  |
| 0.8  | `create_sale`: sorted locking, 3-decimal qty, integer money, active check (P1-2)                             | new migration redefining `create_sale`, `scripts/test-hardening.ts`                                       | 1    |
| 0.9  | Ban user in auth on deactivate (P1-3); webhook-only results for real providers (P1-4)                        | `lib/actions/users.ts`, new migration                                                                     | 0.5  |
| 0.10 | Offline: send `expectedTotal` + customer; `navigator.locks`; "sign in to sync" banner; catalog age (P1-5…8)  | `lib/offline/*`, `components/offline/sync-provider.tsx`, `components/layout/network-indicator.tsx`        | 2    |
| 0.11 | Fix docs that claim things that don't exist (deep health check, store identity), refresh `app/sw.ts` comment | `docs/operations/*.md`, `app/sw.ts`                                                                       | 0.5  |

After each migration: `npm run db:types` and commit the regenerated `lib/supabase/database.types.ts` (CI checks it has not drifted).

**Exit criteria:** `npm run lint && npm run typecheck && npm run test:all && npm run build` green; a cashier token can no longer insert into `sales` or update `shifts` (proved by test); receipts show the real store.

---

## Phase 1 — Egypt essentials (15–20 days) — ⚠️ PARTLY DONE (2026-10-06)

| Item | Status |
| --- | --- |
| 1.2 Weighed (scale-label) barcodes | ✅ Done and tested (parser, settings, product PLU code, offline). **Not yet tried with your real scale** — print one label and run the checklist below before enabling. |
| 1.3 Register keyboard completion | ✅ Done (F4/F5/F6/F7, Ctrl+Del, `3*`, empty-search arrows, 0.1 kg steps). Unit-tested; not yet clicked through in a real browser. |
| 1.4 Translate device errors | ✅ Done and tested. |
| 1.1 ETA e-receipt | ⚠️ **Queue only.** Sales/returns are queued, retried, alerted on; the connection to the authority is **not built** because its specification could not be read and must not be guessed. See [eta.md](eta.md) for the exact steps left (accountant, registration, provider, paper receipt). |

**Weighed-barcode setup:** 1) Reports → Store settings → Scale labels: choose the prefix range, item-code digits and whether the label holds weight or price (ask the scale's installer, or print a label and read the 13 digits: `2x` + PLU + value + check digit). 2) Give each scale product a **Scale code (PLU)** in its form and set its unit to kg. 3) Turn on "Read scale labels". 4) Scan a printed label: the right product should appear with the printed weight.

The original plan for this phase follows for reference.

### 1.1 ETA e-receipt (B2C) — 8–12 days

**First, a business step:** ask the store's accountant whether the shop is required to join the Egyptian Tax Authority e-receipt system now, and get the shop registered on the ETA portal (POS registration, client ID/secret per POS, activity code). Do not guess the legal requirement.

Technical design (fits the existing "receipt behind an interface" rule):

1. Migration: table `eta_submissions` (`sale_id`, `return_id`, `uuid`, `status` queued|submitted|accepted|rejected, `attempts`, `last_error`, `submitted_at`) with RLS (admin read, service-role write).
2. `lib/eta/` (server-only): build the receipt document from the sale snapshot (all data already exists in `sale_items`), compute the receipt UUID as the ETA specification requires, get an OAuth token, submit, store the response.
3. Submission runs **after** the sale commits, never inside `create_sale` — a tax-portal outage must never stop the till. A Vercel cron (add to `vercel.json`) drains `queued` rows with retry/back-off.
4. Add `eta_backlog` and `eta_rejected` to `ops_alerts()` so the existing alert webhook fires.
5. Receipt: print the ETA UUID and the ETA QR instead of the sale number (`lib/receipts/build.ts:48`); returns submit as return receipts.
6. Secrets: `ETA_CLIENT_ID`, `ETA_CLIENT_SECRET`, `ETA_POS_SERIAL`, `ETA_ENV=preprod|prod` in Vercel (server-only). Test end to end on ETA **pre-production** first.

### 1.2 Weighed (scale-label) barcodes — 3–4 days

- Settings in `store_settings`: prefixes (default `20`–`29`), layout (item-code length, value = weight in grams or price in piasters), decimals.
- Pure parser `lib/barcode/weighed.ts` (unit-tested in `scripts/test-barcode-input.ts`): returns `{ plu, weightKg }` or `{ plu, pricePiasters }`, verifies the EAN-13 check digit.
- Products get an optional `plu_code` (unique). `lookupBarcode` and `lib/offline/catalog.ts` try the parser first, then exact match.
- Cart line gets the embedded weight as qty; `+`/`-` on kg lines step by 0.1 kg or open the qty box.
- Ask the shop which scale brand they use and print one sample label to confirm the layout.

### 1.3 Register keyboard completion — 2 days

Shortcuts (shown in `components/register/shortcuts-bar.tsx`, AR/EN): `F4` line discount, `F5` sale discount, `F6` customer, `F7` promo code, `Ctrl+Del` void cart, `3*` then scan = quantity 3. Make arrows and `+`/`-` work while the search box has focus (only when it is empty).

### 1.4 Translate device errors — 0.5 day

Map transport errors to message keys in `lib/devices/print-service.ts` instead of showing `error.message`.

**Exit criteria:** a sale prints the real store identity; a weighed label adds the right kg; on ETA pre-prod a sale and a return are accepted and the receipt shows the ETA QR.

---

## Phase 2 — Quality gate (8–10 days)

1. **Browser E2E with Playwright** (4–5 days). Run against a local Supabase (`npx supabase start`) in a new CI job. Scenarios:
   - cashier signs in → opens shift → scans (simulated keyboard burst) → sells per-piece + per-kg → pays cash → receipt shows correct change;
   - same sale **in Arabic**, screenshot compare for RTL layout;
   - offline: set the browser offline, sell 2 items, go online, both sync once;
   - return with restock; shift close with variance and manager PIN;
   - cashier opening `/users` is redirected; API returns nothing.
2. **Content-Security-Policy** with nonces (Next.js `proxy.ts` sets the nonce) in report-only mode for a week, then enforce. 2 days.
3. **Rate limits** on `/api/health`, `/api/ops/*`, webhooks: reuse the existing `consume_rate_limit` RPC keyed by IP. 1 day.
4. **Error monitoring**: the existing `ERROR_WEBHOOK_URL` → a Slack/Telegram channel is enough at first. Add Sentry later if needed. 0.5 day.
5. Small hardening from the review: webhook returns generic errors; hide `products.cost` from cashiers (a `products_public` view or column grants); `requireAdmin` checks `active`; Zod on id arguments. 1–2 days.

**Exit criteria:** CI has a green Playwright job; CSP enforced with no console violations on every page.

---

## Phase 3 — Desktop app (Electron) for the counter (10–15 days)

The shell exists in `desktop/` and already gives kiosk mode, a locked-down window, USB chooser and an offline page. To make it production grade:

### 3.1 Native print bridge — the main reason to have a desktop app (4–5 days)

Today printing needs WebUSB, which on Windows means replacing the printer driver with Zadig. A native bridge removes that.

- `desktop/preload.cjs`: expose `cachierShell.printers.list()`, `cachierShell.printers.printRaw(target, bytes)` and `cachierShell.printers.openDrawer(target)` through `contextBridge` + `ipcRenderer.invoke`. Nothing else.
- `desktop/main.cjs`: `ipcMain.handle` checks the sender's origin equals the app origin, validates arguments, and sends raw ESC/POS bytes to:
  - **Windows spooler** (RAW datatype) — works with the printer's normal driver;
  - **network printer** TCP port 9100 (`node:net`);
  - optional **serial/COM** (`serialport`).
- Web side: add `ShellTransport` implementing `PrinterTransport` in `lib/devices/transport.ts`; `hooks/use-printer.ts` prefers it when `window.cachierShell?.printers` exists, else WebUSB, else browser print. The ESC/POS bytes from `lib/receipts/escpos.ts` are reused unchanged (including the Arabic bitmap mode).
- Cash drawer kick goes through the printer (`ESC p`), still authorised and audited by the existing `authorize_drawer_open` flow.
- New device profiles: `escpos_windows_spooler_80mm`, `escpos_network_80mm` marked supported in `device_profiles`.

### 3.2 Auto-update (2 days)

- Add `electron-updater`; publish releases to GitHub Releases from `.github/workflows/apps.yml` (on tag `desktop-v*`).
- Check for updates at start and every 6 hours; download in the background; install **only when the shift is closed** or at next launch — never in the middle of a sale.
- Web app checks a **minimum shell version** (`cachierShell.version`) and shows "please update the till app" if too old.

### 3.3 Code signing (1–2 days + certificate paperwork)

- Windows: **Azure Trusted Signing** (cheapest, ~$10/month) or an OV certificate from a CA (~$200–400/year). Without it, Windows SmartScreen warns on every install.
- Secrets live in GitHub Actions secrets, never in the repo.
- macOS signing/notarisation only if a Mac is ever used at the counter (Apple Developer, $99/year).

### 3.4 Counter-PC polish (2–3 days)

- Start with Windows (auto-launch on login via `app.setLoginItemSettings`), kiosk on by default for the till build.
- Crash/hang handling: `render-process-gone` → reload and log to `/api/ops` via the existing client-health report.
- Store the chosen printer per device; show printer status in the shell.
- Replace the placeholder icons in `desktop/build/` with the shop's logo.

### 3.5 Release checklist

- [ ] `appUrl` points at production; build from CI only.
- [ ] Signed installer installs without SmartScreen warning.
- [ ] Prints on the shop's real printer through the spooler, Arabic receipt correct.
- [ ] Drawer opens and is audited.
- [ ] Unplug the network → sell → reconnect → syncs.
- [ ] Update from version N to N+1 while a shift is closed.

**Exit criteria:** the counter PC runs the signed app in kiosk mode, prints natively, and updates itself.

---

## Phase 4 — Android manager app (15–20 days)

The shell exists in `mobile/` (Capacitor 7, Android project generated). The app is for the **owner/manager**, not for selling.

### 4.1 Mobile home and navigation (3–4 days)

- When the web app detects the Android shell (expose `window.cachierShell = { platform: "android" }` from a tiny Capacitor plugin or check `Capacitor.isNativePlatform()`), open a **mobile home**: today's sales, cash variance, low-stock count, open alerts, quick buttons (Price check, Stock count, Receive PO).
- Bottom tab bar on small screens; reuse existing pages (`reports`, `stock-alerts`, `stocktakes`, `purchase-orders`). All strings through next-intl, test in RTL.

### 4.2 Native barcode scanner (3 days)

- Add `@capacitor-mlkit/barcode-scanning` to `mobile/`. Much faster and more reliable than the web camera.
- Web side: a `scanBarcode()` adapter in `lib/barcode/` — uses the native plugin when present, else the existing `html5-qrcode` dialog (`components/register/camera-scan-dialog.tsx`).
- Use it in: price check, stocktake count sheet (`components/stocktakes/count-sheet.tsx`), receiving (`components/purchasing/receive-dialog.tsx`).

### 4.3 Push notifications (4–5 days)

- Firebase project + `@capacitor/push-notifications`; `google-services.json` kept out of git (CI secret).
- Migration: `push_tokens` table (`user_id`, `token`, `platform`, `created_at`) with RLS "own rows only"; a server action to register the token on login and remove it on logout.
- `/api/ops/check` (already runs every 15 minutes) sends FCM messages for new alerts to admins: low stock, cash variance over threshold, offline sales rejected, backup overdue, ETA rejections.
- Message text in the user's language (store `locale` with the token).

### 4.4 Security and comfort (2 days)

- Biometric unlock after the app has been in the background (`@capacitor-community/biometric-auth` or similar); the Supabase session stays server-side in cookies as today.
- Screenshot blocking on sensitive screens is optional.

### 4.5 Google Play release (3–4 days incl. review time)

- Google Play Console account ($25 one-time). Organisation account if possible.
- Create an **upload key** (keystore) — store it and its passwords in a password manager **and** a second safe place; Play App Signing holds the real signing key.
- CI job builds a signed **AAB** (`./gradlew bundleRelease`) on tag `android-v*`.
- Fill the **Data safety** form (account data, no selling to third parties), content rating, privacy-policy URL (add a simple page to the website).
- Tracks: **internal testing** (owner + managers) → **closed testing** → production only if the app should be public. A staff-only app can stay on internal/closed testing forever.
- `versionCode` increases on every build; `versionName` matches the git tag.

### 4.6 iOS (later, when needed)

- Needs a Mac with Xcode and an Apple Developer account ($99/year).
- Add `WKAppBoundDomains` with the production domain to `mobile/ios/App/App/Info.plist` (see review P2-6).
- Distribute privately via **TestFlight** or Apple Business Manager; the public App Store often rejects "website in a wrapper" apps (guideline 4.2), so the native scanner and push from Phase 4 help.

**Exit criteria:** a manager installs from the Play internal track, signs in, scans a product with the native scanner, does a stock count, and receives a low-stock push notification.

---

## Phase 5 — Go-live (5–10 days)

Follow `docs/operations/go-live-checklist.md` top to bottom — first on **staging**, then production. Summary:

1. **Accounts:** Supabase **Pro** (backups, no pausing) for production + a free staging project; Vercel **Pro** (commercial use); a domain (e.g. `pos.shopname.com`).
2. **Database:** `supabase db push`, `npm run db:types`, `select * from verify_database_integrity();` all `ok`. **Never** run the seed on production.
3. **Settings:** disable public sign-ups; set Site URL; set all env vars from `.env.example` (generate secrets with `openssl rand -hex 32`).
4. **Data:** import products by CSV (`/products/import`), spot-check 10; suppliers; staff with PINs; opening stock via an approved stocktake.
5. **Hardware day at the shop:** counter PC with the desktop app, scanner, printer, drawer, scale labels. Run section 6 of the checklist.
6. **Training (half a day):** scan/sell, per-kg, discounts and approvals, returns, offline banner, shift open/close, what to do when the printer fails. Print the runbook.
7. **Pilot:** one or two days running beside the old system; compare end-of-day totals to the piaster.
8. **On-call:** one named person gets the alert webhook and push notifications for the first two weeks.

---

## Phase 6 — After launch

- **Card payments**: integrate a local terminal/gateway (Paymob, Geidea, Fawry, NBE/Banque Misr terminals) through the existing payment lifecycle in `lib/payments/`.
- **Loyalty, gift cards, store credit**: only after the accountant defines liability and expiry rules (see `docs/retail-pos-capability-gap-analysis.md`).
- **Multi-branch / warehouse** (`prompts/pos-roadmap/07-multi-location-transfers.md`).
- **Offline stocktake counts** on the Android app.
- Monthly: `npm audit`, update Next.js/Electron/Capacitor; quarterly restore drill.

---

## Appendix A — Running costs

| Item                         | Cost (approx.)                          | Needed for          |
| ---------------------------- | --------------------------------------- | ------------------- |
| Supabase Pro                 | $25 / month                             | production database |
| Vercel Pro                   | $20 / month per seat                    | web hosting         |
| Domain                       | $10–15 / year                           | web + apps          |
| Off-site backup storage      | $0–5 / month                            | backups             |
| Windows code signing         | ~$10 / month (Azure) or $200–400 / year | desktop installer   |
| Google Play developer        | $25 once                                | Android             |
| Firebase Cloud Messaging     | free                                    | push notifications  |
| Apple Developer (later)      | $99 / year                              | iOS                 |
| AI assistant (Groq / Gemini) | free tier / optional                    | assistant           |

Roughly **$50–60 per month** plus one-time costs. Prices change — check before buying.

## Appendix B — Release and versioning

- `main` is always deployable; work on branches, merge by PR with CI green.
- Web: every merge to `main` deploys to Vercel production; previews for PRs. Migrations are applied **before** the deploy that needs them, outside trading hours (see `docs/operations/runbook.md`).
- Desktop: tag `desktop-vX.Y.Z` → CI builds, signs, publishes a GitHub Release → tills auto-update.
- Android: tag `android-vX.Y.Z` → CI builds a signed AAB → upload to the Play internal track.
- Because the shells load the website, **most changes ship by deploying the web app only**. Rebuild a shell only when the shell itself changes.

## Appendix C — Risk register

| Risk                                   | Likelihood | Impact | Mitigation                                                              |
| -------------------------------------- | ---------- | ------ | ----------------------------------------------------------------------- |
| Internet outage at the shop            | High       | Medium | Offline outbox already built; 4G router as backup link                  |
| Printer not compatible                 | Medium     | High   | Phase 3 spooler path; buy a known ESC/POS model; browser-print fallback |
| ETA requirements change or portal down | Medium     | Medium | Queue + retry outside checkout; alerts; accountant in the loop          |
| Lost Android upload key / signing cert | Low        | High   | Play App Signing; keys in two safe places                               |
| Cashier fraud through API              | Medium     | High   | Phase 0 RLS fixes; audit log; variance approvals                        |
| Supabase/Vercel price or plan change   | Low        | Medium | Standard Postgres + Next.js; can move hosts                             |
| Single developer unavailable           | Medium     | High   | This plan, `PROJECT-EXPLAINED`, runbook, CI tests                       |
