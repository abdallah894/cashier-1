# Cachier POS — the whole project explained from zero

> النسخة العربية: [PROJECT-EXPLAINED.ar.md](PROJECT-EXPLAINED.ar.md)

This guide assumes you know **nothing**. Read it top to bottom once; afterwards use it as a reference. Words in **bold** the first time are explained in the glossary (section 3).

Contents:

1. What this project is
2. The big picture
3. Glossary — every word you need
4. A tour of the folders
5. The life of one sale, step by step
6. Business rules (money, VAT, weight, roles)
7. The other features
8. The desktop app and the Android app
9. Running the project on your computer
10. Putting it on the internet and building the apps
11. Daily operations and troubleshooting
12. React ↔ Vue cheat sheet
13. Where to go next

---

## 1. What this project is

A **POS** (point of sale) is the program a cashier uses at the counter. In a supermarket it must:

- find a product when the cashier **scans** its barcode;
- add it to the customer's basket (the **cart**), with the right price and tax;
- take the payment (cash or card) and calculate the change;
- print a **receipt**;
- subtract what was sold from the **stock** (how many are left on the shelf);
- keep a record that can never be secretly changed, so the owner can trust the numbers.

**Cachier** is that program for a real supermarket in Egypt. It also does much more: shifts and cash-drawer counting, returns, stock counts, suppliers and purchase orders, customers and promotions, reports, low-stock alerts, offline selling when the internet drops, and an AI assistant that answers questions about the shop's data.

It speaks **Arabic and English**. Arabic is written right-to-left (**RTL**), so every screen flips direction when you switch language.

---

## 2. The big picture

Cachier is **one website**. Everything else (the desktop app, the Android app) is a "window" that opens that website.

```
  Cashier at the counter            Manager on the phone           Anyone with a browser
  ┌───────────────────────┐        ┌───────────────────────┐       ┌──────────────────┐
  │ Desktop app (Electron)│        │ Android app (Capacitor)│       │ Chrome / Edge    │
  └──────────┬────────────┘        └───────────┬───────────┘       └────────┬─────────┘
             └──────────────── all open the same website ──────────────────┘
                                         │  internet (HTTPS)
                                         ▼
              ┌──────────────────────────────────────────────────────┐
              │  THE WEBSITE  — Next.js, hosted on Vercel            │
              │  • pages the user sees (register, products, reports) │
              │  • "server actions": code that runs on the server     │
              └───────────────────────────┬──────────────────────────┘
                                          ▼
              ┌──────────────────────────────────────────────────────┐
              │  THE DATABASE — Supabase (PostgreSQL)                │
              │  • tables: products, sales, shifts, …                │
              │  • login accounts (Auth)                             │
              │  • security rules (RLS) and checkout function (RPC)  │
              └──────────────────────────────────────────────────────┘
```

Think of it like a restaurant:

- the **browser / app** is the dining room where customers (cashiers) sit;
- the **website server (Next.js on Vercel)** is the waiter who takes orders and brings food;
- the **database (Supabase)** is the kitchen and the storeroom, with a strict head chef (the security rules) who refuses any order that breaks the rules — even if the waiter makes a mistake.

That last point is the most important design idea in this project: **the database itself enforces the rules**, so a bug in the website or a cashier trying tricks cannot corrupt the money records.

---

## 3. Glossary — every word you need

| Word                         | Plain meaning                                                                                                                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Server**                   | A computer on the internet that runs code for many users. Ours is on Vercel.                                                                                                          |
| **Client / browser**         | The program on the user's device that shows the pages (Chrome, Edge, or our apps).                                                                                                    |
| **Database**                 | An organised, permanent store of data. Ours is PostgreSQL ("Postgres").                                                                                                               |
| **Table**                    | Like a spreadsheet sheet: rows (one product each) and columns (name, price…).                                                                                                         |
| **Migration**                | A file of SQL that changes the database structure (adds a table, a column, a rule). They live in `supabase/migrations/` and run in date order. Never edit an old one — add a new one. |
| **SQL**                      | The language used to talk to the database (`select`, `insert`, `update`).                                                                                                             |
| **Supabase**                 | A hosted service that gives us Postgres + user logins + security rules + an automatic API.                                                                                            |
| **API**                      | A way for one program to ask another for data. Supabase gives each table an API automatically.                                                                                        |
| **RLS (Row Level Security)** | Rules inside Postgres that decide, row by row, who may read or change data. Example: "a cashier can see only their own shifts".                                                       |
| **RPC / database function**  | A function stored inside Postgres that does a whole job in one go. `create_sale` is the checkout function.                                                                            |
| **Transaction**              | A group of database changes that either **all** happen or **none** happen. A sale is one transaction: no half-sales.                                                                  |
| **Next.js**                  | The framework the website is built with. It makes pages and runs server code.                                                                                                         |
| **React**                    | The library that draws the screens out of small pieces called **components**.                                                                                                         |
| **Component**                | A reusable piece of screen, e.g. a button, the cart, the whole register. Files in `components/`.                                                                                      |
| **TypeScript**               | JavaScript with types — the editor warns you if you pass text where a number is expected.                                                                                             |
| **Server Component**         | A component that runs on the server and sends ready HTML. Default in Next.js.                                                                                                         |
| **Client Component**         | A component that runs in the browser because it needs clicks/typing. Starts with `"use client"`.                                                                                      |
| **Server action**            | A function in `lib/actions/` that runs on the server but is called from a button like a normal function. All writes go through these.                                                 |
| **Zod**                      | A library that checks data has the right shape ("price must be a whole number ≥ 0") before using it.                                                                                  |
| **Zustand**                  | A small library to keep shared state in the browser — we use it for the cart.                                                                                                         |
| **TanStack Query**           | A library that fetches data from the server and caches it.                                                                                                                            |
| **next-intl**                | The translation library. Texts are in `messages/ar.json` and `messages/en.json`.                                                                                                      |
| **Tailwind / shadcn/ui**     | Styling tools: Tailwind gives short CSS class names; shadcn/ui gives ready components (dialogs, tables) in `components/ui/`.                                                          |
| **PWA**                      | Progressive Web App — a website that can be "installed" and work like an app.                                                                                                         |
| **Service worker**           | A small script the browser keeps running in the background; it caches pages so the site opens without internet (`app/sw.ts`).                                                         |
| **IndexedDB**                | A database inside the browser. We keep offline sales and a copy of the product list there (`lib/offline/`).                                                                           |
| **Outbox**                   | The queue of sales made while offline, waiting to be sent.                                                                                                                            |
| **Idempotency key**          | A unique id per sale so that sending the same sale twice only records it once.                                                                                                        |
| **Electron**                 | A tool to make a desktop program (Windows/Mac/Linux) out of a website. Folder `desktop/`.                                                                                             |
| **Capacitor**                | A tool to make an Android/iOS app out of a website. Folder `mobile/`.                                                                                                                 |
| **Environment variable**     | A setting given to the program from outside (passwords, URLs), never written in code. See `.env.example`.                                                                             |
| **Service role key**         | The Supabase "master key" that bypasses RLS. Only the server may have it. Never in the browser, never in git.                                                                         |
| **CI**                       | Continuous Integration — GitHub runs all checks and tests automatically on every change (`.github/workflows/ci.yml`).                                                                 |
| **Deploy**                   | Putting a new version on the internet (Vercel does it on every merge to `main`).                                                                                                      |
| **ESC/POS**                  | The command language of receipt printers (`lib/receipts/escpos.ts`).                                                                                                                  |
| **WebUSB**                   | A browser feature that lets a web page talk to a USB device (our printer). Chrome/Edge only.                                                                                          |
| **Piaster**                  | 1/100 of an Egyptian pound. All money is stored as whole piasters.                                                                                                                    |

---

## 4. A tour of the folders

```
cashier-1/
├── app/                    the pages (each folder = a web address)
│   ├── [locale]/           "ar" or "en" — the language is part of the address: /ar/register
│   │   ├── (auth)/login/   the login page
│   │   └── (app)/          every page behind the side menu
│   │       ├── register/   the till screen
│   │       ├── products/   product list, new, edit, CSV import
│   │       ├── shifts/     open/close shifts, Z-report
│   │       ├── receipts/   past receipts, returns
│   │       ├── reports/    sales, VAT, stock, reorder
│   │       └── …           customers, suppliers, purchase-orders, stocktakes, users, devices, audit
│   ├── api/                endpoints called by machines (health check, cron, payment webhook, AI)
│   ├── manifest.ts         PWA install info (name, icons)
│   └── sw.ts               service worker (offline cache)
├── components/             screen pieces, grouped by feature (register/, products/, ui/ …)
├── hooks/                  reusable browser logic: barcode scanner, online status, printer
├── lib/                    the "brain" (no screens here)
│   ├── actions/            server actions — every change to data goes through here
│   ├── supabase/           database clients + queries/ (all reads) + generated types
│   ├── validation/         Zod schemas (rules for every form)
│   ├── money.ts            piaster maths and formatting
│   ├── store/cart.ts       the cart (Zustand)
│   ├── offline/            outbox, offline catalog, sync
│   ├── receipts/           building receipts, PDF, ESC/POS, Z-report
│   ├── devices/            printer transport and print jobs
│   ├── barcode/            scanner-burst detection, camera decoding
│   ├── payments/           payment providers and webhook checking
│   ├── ai/                 the assistant and its read-only tools
│   └── ops/, observability/ alerts, logging, health
├── messages/               ar.json and en.json — every text on screen
├── i18n/                   language settings for next-intl
├── supabase/migrations/    the database, built step by step in SQL
├── scripts/                seed data, backups, and the 36 test suites (test-*.ts)
├── desktop/                the Electron desktop app
├── mobile/                 the Capacitor Android/iOS app
├── docs/                   documentation (you are here)
├── prompts/                the phase-by-phase instructions used to build the project
├── proxy.ts                runs before every page: language + "are you logged in?"
├── next.config.ts          Next.js settings and security headers
└── .github/workflows/      CI (tests on every change) and app builds
```

Rule of thumb: **screens in `components/` and `app/`, logic in `lib/`, data rules in `supabase/migrations/`.** Components never talk to the database directly; they call `lib/actions/` (to change) or `lib/supabase/queries/` (to read).

---

## 5. The life of one sale, step by step

Follow a customer buying 2 bottles of water and 1.25 kg of tomatoes, paying 100 EGP cash.

1. **Shift is open.** Before selling, the cashier opens a shift and types the starting cash in the drawer (the _opening float_). Without an open shift the register is blocked (`components/register/open-shift-gate.tsx`).
2. **Scan.** The USB scanner behaves like a very fast keyboard: it "types" the barcode in a few milliseconds and presses Enter. `hooks/use-barcode-scanner.ts` listens to every key on the page, and `lib/barcode/scan-detector.ts` decides: keys arriving less than 50 ms apart ending in Enter = a scan; slower = a human typing.
3. **Look up the product.** `components/register/register.tsx` asks the server for the product with that barcode (or, if offline, the copy in IndexedDB).
4. **Add to cart.** The product is added to the cart in `lib/store/cart.ts`. Scanning again adds +1. For tomatoes (unit = kg) the cashier types `1.25` as the quantity.
5. **Totals.** The cart calculates each line in piasters with `lib/money.ts`: price × qty, minus discounts, and how much of it is VAT. Promotions are calculated by the server so the preview and the real sale agree.
6. **Checkout.** The cashier presses **F2**. `components/register/checkout-dialog.tsx` asks for the payment method and the amount given (10000 piasters = 100 EGP) and shows the change.
7. **Server action.** Confirming calls `createSale` in `lib/actions/sales.ts`. It checks the data with Zod (`lib/validation/sale.ts`) and calls the database function.
8. **The database does everything at once** in `create_sale` (one transaction):
   - locks the product rows so two tills cannot sell the last bottle twice;
   - re-reads the real prices from the database (the browser's prices are not trusted);
   - checks there is enough stock;
   - inserts the sale with the next sale number, and one `sale_items` row per line with a **snapshot** of name, price and tax;
   - subtracts stock and writes a `stock_movements` row per product;
   - records the cash in the drawer ledger and the payment record.
     If anything fails, **nothing** is saved.
9. **Receipt.** The browser shows the receipt (`components/receipts/receipt-80mm.tsx`) and prints it — on the thermal printer through ESC/POS, or through the normal print dialog / PDF.
10. **End of day.** At shift close the cashier counts the drawer. The system knows how much _should_ be there (float + cash sales − cash refunds ± paid-in/out). A big difference needs a manager's PIN. The **Z-report** summarises the shift.

---

## 6. Business rules

**Money in piasters.** 48.95 EGP is stored as the whole number `4895`. Computers make tiny errors with decimal numbers (0.1 + 0.2 = 0.30000000000000004), which would make the till drift by piasters. Whole numbers never drift. Conversions are only done in `lib/money.ts`.

**VAT.** Egypt's standard VAT is 14%. Each product has its own `tax_rate` (0.14, or 0 for exempt basic foods). Shelf prices **include** VAT; the system calculates how much of each price is tax for the receipt and the VAT report.

**Per-piece and per-kg.** `unit` is `piece` or `kg`. Kg items allow up to 3 decimals (1.250 kg).

**Snapshots.** Each sold line copies the product's name, price and tax at that moment. If you change the price of water tomorrow, yesterday's receipt still shows yesterday's price. Receipts can **never** be edited or deleted — mistakes are corrected with a **return**.

**Roles.**

- **admin** — everything.
- **cashier** — the register and their own shifts.
- **Capabilities** — extra permissions an admin can grant (e.g. approve discounts, do stock corrections).
- **Manager approval** — some actions (big discount, big return, cash variance) need a manager to type their PIN on the cashier's screen. The approval works once only and is recorded.

These rules are enforced by **RLS policies and database functions**, not only by hiding buttons.

---

## 7. The other features

| Feature                     | What it does                                                                                   | Where                                                  |
| --------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Shifts & cash drawer        | Opening float, paid-in/out, safe drops, closing count, variance approval, Z-report             | `app/[locale]/(app)/shifts/`, `components/shifts/`     |
| Returns & exchanges         | A return is its own document linked to the original sale; choose restock or not; refund tender | `components/receipts/return-dialog.tsx`                |
| Products & stock            | Add/edit products, CSV import, stock adjustments with reasons, movement history                | `components/products/`                                 |
| Stocktakes                  | Count the shelves, compare with the system, manager approves the adjustments                   | `components/stocktakes/`                               |
| Suppliers & purchase orders | Order from suppliers, receive goods (stock goes up, cost recorded)                             | `components/purchasing/`                               |
| Customers & promotions      | Optional customer by phone, rule-based promotions and codes                                    | `components/customers/`, `components/promotions/`      |
| Payments                    | Cash and card records, split tender, reconciliation screen                                     | `app/[locale]/(app)/payments/`, `lib/payments/`        |
| Offline mode                | When the internet drops, cash sales are saved in the browser and sent later, once, in order    | `lib/offline/`, `components/offline/`                  |
| Printing & devices          | Thermal printer via WebUSB, cash drawer kick, device registry                                  | `lib/devices/`, `app/[locale]/(app)/devices/`          |
| Reports                     | Daily summary, sales, VAT, stock value, reorder suggestions, business day in Cairo time        | `app/[locale]/(app)/reports/`                          |
| Audit log                   | Who did what sensitive action, when                                                            | `app/[locale]/(app)/audit/`                            |
| AI assistant                | Answers questions about the shop's data; read-only, rate-limited                               | `components/chat-widget.tsx`, `lib/ai/`                |
| Operations                  | Health check, alert cron every 15 minutes, backups                                             | `app/api/`, `scripts/backup-db.sh`, `docs/operations/` |

---

## 8. The desktop app and the Android app

Both apps are **thin shells**: a frame that opens the real website. That is why they are small and why **a website update reaches every device at once** — you only rebuild an app when the app frame itself changes.

### Desktop (Electron) — `desktop/`

- `main.cjs` creates the window, allows only our website inside it (other links open in the normal browser), blocks Node.js access from the page, gives camera/USB permission only to our site, shows `offline.html` if the site can't be reached on first start.
- **Kiosk mode** (`"kiosk": true` in `desktop/app-config.json`) makes it full-screen and locked — good for the counter.
- `preload.cjs` is the only bridge between the page and the computer. Today it shares only the version and OS; the plan adds native printing here.
- Build: `cd desktop && npm install && npm run dist:win` produces a Windows installer in `desktop/dist/`.

### Android (Capacitor) — `mobile/`

- `capacitor.config.json` → `server.url` is the website address the app opens.
- `mobile/android/` is a normal Android Studio project generated by Capacitor.
- In our plan the Android app is for the **manager**: reports, alerts (push notifications), stock counts and receiving with a fast native camera scanner.
- Build: `cd mobile && npm install && npm run android` opens Android Studio; press Run, or Build → Generate Signed Bundle for Google Play.

### PWA (no store needed)

Any Chrome/Edge can "install" the website (address bar → install icon). It is the fallback if you don't want installers.

---

## 9. Running the project on your computer

You need: **Node.js 22** (nodejs.org), **Git**, a free **Supabase** account, and a code editor (VS Code).

```bash
# 1. get the code
git clone https://github.com/abdallah894/cashier-1.git
cd cashier-1

# 2. install the libraries (creates node_modules/)
npm install

# 3. settings: copy the example and fill it
cp .env.example .env.local
#    open .env.local and paste from Supabase → Project Settings → API:
#    NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY

# 4. build the database in your Supabase project
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push           # runs every file in supabase/migrations/

# 5. demo data (admin + cashier users, categories, products) — NEVER on production
npm run seed

# 6. start
npm run dev                    # open http://localhost:3000
```

Log in with the `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` from `.env.local`.

Checks you should run before every commit (CI runs the same):

```bash
npm run lint         # code style problems
npm run typecheck    # type errors
npm run test:all     # the 36 test suites (in-memory database, no internet needed)
npm run build        # can it build for production?
```

---

## 10. Putting it on the internet and building the apps

1. **Supabase production project** (Pro plan), `supabase db push` to it. Disable public sign-ups.
2. **Vercel**: import the GitHub repo, add the environment variables from `.env.example` (Production), deploy. Add your domain.
3. Create the real admin user, set PINs, enter store settings, import products.
4. **Desktop**: put the production URL in `desktop/app-config.json`, then build — or use GitHub → Actions → "Build apps" → Run workflow, entering the URL.
5. **Android**: put the URL in `mobile/capacitor.config.json`, build a signed bundle, upload to Google Play internal testing.

The complete, tick-box version is `docs/operations/go-live-checklist.md`, and the full roadmap is [PRODUCTION-PLAN.md](PRODUCTION-PLAN.md).

---

## 11. Daily operations and troubleshooting

| Situation                          | What to do                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------ |
| Internet dropped                   | Keep selling cash; the banner shows queued sales; they send by themselves when it returns. |
| Queued sale "rejected"             | A manager opens **Offline sales**, reads the reason (e.g. out of stock), and resolves it.  |
| Printer not printing               | Check paper/power/USB; reprint from **Receipts**; use the browser print as backup.         |
| Scanner types into the wrong place | Check it is set to send Enter after the code with no prefix (docs/hardware.md).            |
| Cash doesn't match at close        | Recount; record paid-outs you forgot; a manager approves the variance with a PIN.          |
| Someone left the job               | Admin → **Users** → deactivate; change any shared passwords.                               |
| Site down                          | Check `https://YOUR-DOMAIN/api/health`; see `docs/operations/runbook.md`.                  |
| Backup alert                       | Run `scripts/backup-db.sh`; see the runbook.                                               |

---

## 12. React ↔ Vue cheat sheet

You know Vue 3 / Nuxt 3; here is the same idea in this codebase.

| Vue / Nuxt                              | React / Next.js in this project                                     |
| --------------------------------------- | ------------------------------------------------------------------- |
| `<template>` with `v-if`, `v-for`       | JSX: `{cond && <X/>}`, `{list.map(i => <Row key={i.id}/>)}`         |
| `ref()` / `reactive()`                  | `useState()` — call the setter to change, never mutate              |
| `computed()`                            | just compute in the function body, or `useMemo`                     |
| `watch()` / `onMounted` / `onUnmounted` | `useEffect(() => { …; return cleanup }, [deps])`                    |
| Composables (`useX`)                    | Custom hooks in `hooks/` (`useBarcodeScanner`)                      |
| Pinia `defineStore`                     | Zustand `create()` — `lib/store/cart.ts`                            |
| `provide` / `inject`                    | React Context (`components/providers.tsx`)                          |
| Nuxt `server/api/*.ts`                  | Server actions in `lib/actions/` (+ `app/api/` route handlers)      |
| Nuxt pages folder                       | `app/` folder; `page.tsx`, `layout.tsx`, `loading.tsx`, `error.tsx` |
| Nuxt route middleware                   | `proxy.ts` (Next 16's name for middleware)                          |
| `useFetch`                              | Server Components fetch directly; TanStack Query in the browser     |
| `vue-i18n` `$t()`                       | next-intl `useTranslations()` / `getTranslations()`                 |
| Vuetify components                      | shadcn/ui components in `components/ui/`                            |

---

## 13. Where to go next

1. [PROJECT-REVIEW.md](PROJECT-REVIEW.md) — what is wrong or missing today, with exact files.
2. [PRODUCTION-PLAN.md](PRODUCTION-PLAN.md) — the step-by-step plan to production, desktop and Android.
3. `docs/operations/go-live-checklist.md` and `docs/operations/runbook.md` — launch and daily operations.
4. `docs/apps.md`, `docs/hardware.md`, `docs/offline-plan.md`, `docs/payments.md`, `docs/reporting.md` — deep dives.
5. `CLAUDE.md` — the project's rules (stack, business rules, architecture).
