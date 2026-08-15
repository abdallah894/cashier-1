# Phase 4 — Receipts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Receipt rendering behind `lib/receipts/`, an 80mm print view with print flow, Arabic-correct PDF download, and a searchable sales-history page rendered from snapshots.

**Architecture:** A pure `buildReceipt(sale) → ReceiptData` transform in `lib/receipts/` is the seam: the 80mm React view, the client-side jsPDF renderer, and the future ESC/POS driver all consume `ReceiptData` and never touch database row shapes. The receipt detail page (`/receipts/[id]`) is rewritten around it; a new `/receipts` index page lists past sales from the `sales` + `sale_items` snapshots.

**Tech Stack:** Next.js 16 App Router (Server Components by default), next-intl v4, `qrcode` (sync SVG QR + PNG data URL for PDF), `jspdf` + embedded Amiri TTF (Arabic shaping), Tailwind v4 print CSS.

## Global Constraints

- All money is **integer piasters** in app code; display via `formatEgp` from `lib/money.ts`. NEVER float arithmetic on currency.
- Prices are **VAT-inclusive**; VAT extracted per line as `round(gross / (1 + tax_rate))` — use `extractNet(gross, rateBp)` from `lib/money.ts` (rateBp = tax_rate × 10000). Per-rate VAT must be summed from per-line extractions, never extracted from a per-rate gross sum.
- Every user-facing string goes through next-intl (`messages/en.json` + `messages/ar.json`); test layouts in RTL.
- TypeScript strict, no `any`. Server Components by default; `"use client"` only where interactivity demands.
- Historical receipts render **only** from `sale_items` snapshots (`name_ar`, `name_en`, `unit_price`, `tax_rate`, `qty`, `line_discount`, `line_total`) — never join current `products`.
- Receipt rendering stays behind `lib/receipts/` — register/page logic must not know how receipts are printed (ESC/POS plugs in later; do NOT build thermal now).
- `lib/receipts/build.ts` and `lib/receipts/types.ts` must NOT import `"server-only"` (client components and the tsx test script import them).
- **This project directory is not a git repository** — commit steps are intentionally omitted. Do not `git init` unless the user asks.
- Platform is Windows; run shell steps through the Bash tool (Git Bash) or PowerShell as noted.

---

### Task 1: Receipt data builder (`lib/receipts/`)

**Files:**
- Create: `lib/receipts/types.ts`
- Create: `lib/receipts/store-info.ts`
- Create: `lib/receipts/build.ts`
- Create: `scripts/test-receipt.ts`
- Modify: `lib/supabase/queries/sales.ts` (reuse the new type)
- Modify: `package.json` (add `test:receipt` script)

**Interfaces:**
- Consumes: `Tables<>` from `lib/supabase/database.types`, `extractNet` from `lib/money.ts`.
- Produces: `buildReceipt(sale: SaleForReceipt): ReceiptData` (types below) — Tasks 2, 4 render from `ReceiptData`; Task 2's page passes the result of `getSaleWithItems` straight in (its `SaleWithItems` becomes an alias of `SaleForReceipt`).

- [x] **Step 1: Write the failing test**

Create `scripts/test-receipt.ts`:

```ts
/**
 * Receipt builder tests — run with: npm run test:receipt
 *
 * buildReceipt must mirror create_sale's money math exactly: VAT is
 * extracted PER LINE (round(gross/(1+rate))) and then summed by rate.
 */
import { buildReceipt } from "../lib/receipts/build";
import type { SaleForReceipt } from "../lib/receipts/types";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!cond) failures++;
}

function fakeSale(over: Partial<SaleForReceipt>): SaleForReceipt {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    sale_number: 42,
    shift_id: null,
    cashier_id: "00000000-0000-0000-0000-000000000002",
    subtotal: 0,
    tax_total: 0,
    discount_total: 0,
    total: 0,
    payment_method: "cash",
    amount_tendered: null,
    change_due: null,
    created_at: "2026-07-05T10:30:00Z",
    sale_items: [],
    profiles: { full_name: "Test Cashier" },
    ...over,
  };
}

type FakeItem = SaleForReceipt["sale_items"][number];
let itemSeq = 0;
function fakeItem(over: Partial<FakeItem>): FakeItem {
  itemSeq++;
  return {
    id: `00000000-0000-0000-0000-0000000010${String(itemSeq).padStart(2, "0")}`,
    sale_id: "00000000-0000-0000-0000-000000000001",
    product_id: `00000000-0000-0000-0000-0000000020${String(itemSeq).padStart(2, "0")}`,
    name_ar: "منتج",
    name_en: "Product",
    unit_price: 1000,
    tax_rate: 0.14,
    qty: 1,
    line_discount: 0,
    line_total: 1000,
    created_at: "2026-07-05T10:30:00Z",
    ...over,
  };
}

// ---------- per-line VAT extraction (the rounding-sensitive case) ----------
// gross 63 @14%: net = round(630000/11400) = 55, tax 8 → two lines = tax 16.
// Extracting from the SUM (126) would give round(1260000/11400)=111, tax 15.
{
  const sale = fakeSale({
    subtotal: 110,
    tax_total: 16,
    total: 126,
    sale_items: [
      fakeItem({ unit_price: 63, line_total: 63 }),
      fakeItem({ unit_price: 63, line_total: 63 }),
    ],
  });
  const r = buildReceipt(sale);
  check(
    "per-line VAT: 2×63 @14% → tax 16 (not 15)",
    r.vatBreakdown.length === 1 && r.vatBreakdown[0].tax === 16,
    JSON.stringify(r.vatBreakdown)
  );
  check("per-line VAT: nets sum to 110", r.vatBreakdown[0].net === 110);
  check(
    "breakdown tax sums to sale.tax_total",
    r.vatBreakdown.reduce((a, b) => a + b.tax, 0) === r.taxTotal
  );
}

// ---------- multi-rate grouping, ascending order ----------
{
  const sale = fakeSale({
    sale_items: [
      fakeItem({ tax_rate: 0.14, unit_price: 2600, line_total: 2600 }),
      fakeItem({ tax_rate: 0, unit_price: 4800, qty: 2, line_total: 9600 }),
    ],
  });
  const r = buildReceipt(sale);
  check(
    "two rates → two rows, ascending",
    r.vatBreakdown.length === 2 &&
      r.vatBreakdown[0].rateBp === 0 &&
      r.vatBreakdown[1].rateBp === 1400
  );
  check("0% row: tax 0, net = gross", r.vatBreakdown[0].net === 9600 && r.vatBreakdown[0].tax === 0);
  check(
    "14% row: 2600 → net 2281, tax 319",
    r.vatBreakdown[1].net === 2281 && r.vatBreakdown[1].tax === 319
  );
}

// ---------- snapshots + passthrough fields ----------
{
  const sale = fakeSale({
    sale_number: 1234,
    subtotal: 2394,
    tax_total: 0,
    discount_total: 100,
    total: 2394,
    amount_tendered: 20000,
    change_due: 17606,
    sale_items: [
      fakeItem({
        name_ar: "أرز",
        name_en: "Rice",
        tax_rate: 0,
        unit_price: 1995,
        qty: 1.25,
        line_discount: 100,
        line_total: 2394,
      }),
    ],
  });
  const r = buildReceipt(sale);
  check("qrValue encodes sale_number", r.qrValue === "1234");
  check(
    "line snapshots copied",
    r.lines[0].nameAr === "أرز" &&
      r.lines[0].nameEn === "Rice" &&
      r.lines[0].qty === 1.25 &&
      r.lines[0].unitPrice === 1995 &&
      r.lines[0].lineDiscount === 100 &&
      r.lines[0].lineTotal === 2394
  );
  check("cash fields pass through", r.amountTendered === 20000 && r.changeDue === 17606);
  check("cashier name from join", r.cashierName === "Test Cashier");
  check("store info attached", r.store.nameAr.length > 0 && r.store.nameEn.length > 0);
  check("createdAt passthrough", r.createdAt === "2026-07-05T10:30:00Z");
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failing`);
  process.exit(1);
}
console.log("\nAll receipt tests passed.");
```

Add the script to `package.json` (after `"test:cart"`):

```json
    "test:cart": "tsx scripts/test-cart-math.ts",
    "test:receipt": "tsx scripts/test-receipt.ts"
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npm run test:receipt`
Expected: FAIL — `Cannot find module '../lib/receipts/build'` (or similar resolution error).

- [x] **Step 3: Implement the receipt module**

Create `lib/receipts/types.ts`:

```ts
import type { Tables } from "@/lib/supabase/database.types";

// The sale shape the builder consumes — the `sales + sale_items + profiles`
// join from lib/supabase/queries/sales.ts. Defined here, free of
// "server-only", so client components and the tsx test script can import it.
export type SaleForReceipt = Tables<"sales"> & {
  sale_items: Tables<"sale_items">[];
  profiles: Pick<Tables<"profiles">, "full_name"> | null;
};

export type StoreInfo = {
  nameAr: string;
  nameEn: string;
  addressAr: string;
  addressEn: string;
  phone: string;
  /** Egyptian tax registration number — printed on every receipt. */
  taxId: string;
};

export type ReceiptLine = {
  nameAr: string;
  nameEn: string;
  qty: number;
  unitPrice: number; // piasters
  lineDiscount: number; // piasters
  lineTotal: number; // piasters, after discount
};

export type VatBreakdownRow = {
  rateBp: number; // basis points: 1400 = 14%
  net: number; // piasters
  tax: number; // piasters
};

export type ReceiptData = {
  store: StoreInfo;
  saleId: string;
  saleNumber: number;
  createdAt: string; // ISO timestamp
  cashierName: string | null;
  paymentMethod: Tables<"sales">["payment_method"];
  lines: ReceiptLine[];
  /** per-line VAT summed by rate, rate ascending — matches create_sale math */
  vatBreakdown: VatBreakdownRow[];
  subtotal: number; // piasters, net of VAT
  taxTotal: number;
  discountTotal: number;
  total: number;
  amountTendered: number | null;
  changeDue: number | null;
  /** encoded in the receipt's QR code */
  qrValue: string;
};
```

Create `lib/receipts/store-info.ts`:

```ts
import type { StoreInfo } from "./types";

// Store identity printed on every receipt. Configurable constants for now;
// moves to a settings table when multi-branch arrives (deferred).
export const STORE_INFO: StoreInfo = {
  nameAr: "سوبر ماركت كاشير",
  nameEn: "Cachier Supermarket",
  addressAr: "١٥ شارع التحرير، الدقي، الجيزة",
  addressEn: "15 Tahrir St., Dokki, Giza",
  phone: "0100 000 0000",
  taxId: "100-200-300",
};
```

Create `lib/receipts/build.ts`:

```ts
import { extractNet } from "@/lib/money";
import { STORE_INFO } from "./store-info";
import type { ReceiptData, SaleForReceipt, VatBreakdownRow } from "./types";

/**
 * Pure sale → receipt transform. Every renderer (80mm print view, PDF,
 * and the future ESC/POS driver) consumes ReceiptData; none of them ever
 * touch the database row shape.
 *
 * VAT is re-derived PER LINE — round(gross / (1 + rate)), exactly like
 * create_sale — then summed by rate. Extracting from a per-rate gross sum
 * would round differently and drift from sale.tax_total.
 */
export function buildReceipt(sale: SaleForReceipt): ReceiptData {
  const byRate = new Map<number, VatBreakdownRow>();
  for (const item of sale.sale_items) {
    const rateBp = Math.round(Number(item.tax_rate) * 10000);
    const gross = Number(item.line_total);
    const net = extractNet(gross, rateBp);
    const row = byRate.get(rateBp) ?? { rateBp, net: 0, tax: 0 };
    row.net += net;
    row.tax += gross - net;
    byRate.set(rateBp, row);
  }

  return {
    store: STORE_INFO,
    saleId: sale.id,
    saleNumber: Number(sale.sale_number),
    createdAt: sale.created_at,
    cashierName: sale.profiles?.full_name ?? null,
    paymentMethod: sale.payment_method,
    lines: sale.sale_items.map((i) => ({
      nameAr: i.name_ar,
      nameEn: i.name_en,
      qty: Number(i.qty),
      unitPrice: Number(i.unit_price),
      lineDiscount: Number(i.line_discount),
      lineTotal: Number(i.line_total),
    })),
    vatBreakdown: [...byRate.values()].sort((a, b) => a.rateBp - b.rateBp),
    subtotal: Number(sale.subtotal),
    taxTotal: Number(sale.tax_total),
    discountTotal: Number(sale.discount_total),
    total: Number(sale.total),
    amountTendered: sale.amount_tendered === null ? null : Number(sale.amount_tendered),
    changeDue: sale.change_due === null ? null : Number(sale.change_due),
    qrValue: String(sale.sale_number),
  };
}
```

In `lib/supabase/queries/sales.ts`, replace the locally-defined type with the shared one — change:

```ts
import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/lib/supabase/database.types";

export type SaleWithItems = Tables<"sales"> & {
  sale_items: Tables<"sale_items">[];
  profiles: Pick<Tables<"profiles">, "full_name"> | null;
};
```

to:

```ts
import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { SaleForReceipt } from "@/lib/receipts/types";

export type SaleWithItems = SaleForReceipt;
```

(The `Tables` import returns in Task 5; remove it here if the linter flags it as unused.)

- [x] **Step 4: Run the tests to verify they pass**

Run: `npm run test:receipt`
Expected: all `PASS`, exit 0, `All receipt tests passed.`

- [x] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: exit 0, no errors.

---

### Task 2: 80mm receipt view, print CSS, page rewrite

**Files:**
- Create: `components/receipts/receipt-qr.tsx`
- Create: `components/receipts/receipt-80mm.tsx`
- Create: `components/receipts/receipt-actions.tsx`
- Modify: `app/[locale]/(app)/receipts/[id]/page.tsx` (full rewrite)
- Modify: `app/globals.css` (append print rules)
- Modify: `messages/en.json`, `messages/ar.json` (receipt namespace)
- Modify: `package.json` / lockfile via `npm install qrcode @types/qrcode`

**Interfaces:**
- Consumes: `buildReceipt`, `ReceiptData` from Task 1; `getSaleWithItems` from `lib/supabase/queries/sales.ts`; `formatEgp` from `lib/money.ts`.
- Produces: `<Receipt80mm receipt={ReceiptData} />` (server component), `<ReceiptActions />` (client; extended with props in Tasks 3–4), and the global `.receipt-print-area` CSS contract: the element with that class is the ONLY thing that prints, at 80mm.

- [x] **Step 1: Install the QR dependency**

Run: `npm install qrcode @types/qrcode`
Expected: exit 0; `qrcode` appears in `package.json` dependencies.

- [x] **Step 2: Add print CSS**

Append to the END of `app/globals.css`:

```css
/* ---------- 80mm receipt printing ----------
   Printing = the receipt and nothing else: hide everything, then lift
   .receipt-print-area to the top of an 80mm-wide page. App chrome
   (sidebar, header, action buttons) never reaches the printer. */
@media print {
  @page {
    size: 80mm auto;
    margin: 0;
  }
  html,
  body {
    height: auto !important;
    background: white !important;
  }
  body * {
    visibility: hidden;
  }
  .receipt-print-area,
  .receipt-print-area * {
    visibility: visible;
  }
  .receipt-print-area {
    position: absolute;
    top: 0;
    left: 0;
    width: 80mm;
    margin: 0;
    padding: 0;
    border: none !important;
    box-shadow: none !important;
  }
}
```

- [x] **Step 3: Replace the `receipt` i18n namespace**

In `messages/en.json`, replace the whole `"receipt": { … }` object with:

```json
  "receipt": {
    "title": "Sale #{number}",
    "payment": {
      "cash": "Cash",
      "card": "Card"
    },
    "taxId": "Tax ID: {id}",
    "saleNo": "Receipt #",
    "date": "Date",
    "cashier": "Cashier",
    "paymentMethod": "Payment",
    "subtotal": "Subtotal (before VAT)",
    "vat": "VAT",
    "vatRate": "VAT {rate}%",
    "discount": "Discount",
    "total": "Total",
    "tendered": "Received",
    "change": "Change",
    "thankYou": "Thank you for shopping with us!",
    "newSale": "New sale",
    "print": "Print",
    "downloadPdf": "Download PDF",
    "autoPrint": "Auto-print after checkout"
  },
```

In `messages/ar.json`, replace the whole `"receipt": { … }` object with:

```json
  "receipt": {
    "title": "فاتورة رقم {number}",
    "payment": {
      "cash": "نقدي",
      "card": "بطاقة"
    },
    "taxId": "الرقم الضريبي: {id}",
    "saleNo": "رقم الفاتورة",
    "date": "التاريخ",
    "cashier": "الكاشير",
    "paymentMethod": "طريقة الدفع",
    "subtotal": "الإجمالي قبل الضريبة",
    "vat": "الضريبة",
    "vatRate": "ض.ق.م {rate}٪",
    "discount": "الخصم",
    "total": "الإجمالي",
    "tendered": "المستلم",
    "change": "الباقي",
    "thankYou": "شكرًا لتسوقكم معنا!",
    "newSale": "عملية جديدة",
    "print": "طباعة",
    "downloadPdf": "تحميل PDF",
    "autoPrint": "طباعة تلقائية بعد الدفع"
  },
```

(The old `printSoon` key is gone — the placeholder page that used it is rewritten in Step 6.)

- [x] **Step 4: Create the QR component**

Create `components/receipts/receipt-qr.tsx`:

```tsx
import QRCode from "qrcode";

/**
 * Synchronous SVG QR — no canvas, no effects, no async. Renders
 * server-side, so the code is guaranteed on the page before the print
 * dialog can open (a data-URL <img> could still be loading).
 */
export function ReceiptQr({ value, className }: { value: string; className?: string }) {
  const qr = QRCode.create(value, { errorCorrectionLevel: "M" });
  const size = qr.modules.size;
  const data = qr.modules.data;
  let path = "";
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (data[y * size + x]) path += `M${x} ${y}h1v1h-1z`;
    }
  }
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className={className}
      shapeRendering="crispEdges"
      role="img"
      aria-label={value}
    >
      <path d={path} fill="#000" />
    </svg>
  );
}
```

- [x] **Step 5: Create the 80mm receipt component**

Create `components/receipts/receipt-80mm.tsx`:

```tsx
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { formatEgp } from "@/lib/money";
import type { ReceiptData } from "@/lib/receipts/types";
import { ReceiptQr } from "./receipt-qr";

// Server component — next-intl's use* hooks work in RSC (in Vue terms:
// this is like useI18n() working inside a server-rendered component).
// Deliberately black-on-white: paper has no dark mode.
export function Receipt80mm({ receipt }: { receipt: ReceiptData }) {
  const t = useTranslations("receipt");
  const format = useFormatter();
  const locale = useLocale();
  const isAr = locale === "ar";
  const money = (v: number) => formatEgp(v, locale);

  return (
    <div className="w-[80mm] bg-white px-[4mm] py-[5mm] text-[11px] leading-snug text-black">
      {/* store header — configurable constants from lib/receipts/store-info */}
      <div className="text-center">
        <div className="text-sm font-bold">{isAr ? receipt.store.nameAr : receipt.store.nameEn}</div>
        <div>{isAr ? receipt.store.addressAr : receipt.store.addressEn}</div>
        <div dir="ltr">{receipt.store.phone}</div>
        <div>{t("taxId", { id: receipt.store.taxId })}</div>
      </div>

      <Dashes />

      <Row label={t("saleNo")} value={`#${receipt.saleNumber}`} />
      <Row
        label={t("date")}
        value={format.dateTime(new Date(receipt.createdAt), {
          dateStyle: "short",
          timeStyle: "short",
        })}
      />
      {receipt.cashierName && <Row label={t("cashier")} value={receipt.cashierName} ltr={false} />}

      <Dashes />

      {/* line items — names in the current UI language, from the snapshots */}
      {receipt.lines.map((line, i) => (
        <div key={i} className="mb-1">
          <div className="font-semibold">{isAr ? line.nameAr : line.nameEn}</div>
          <Row
            label={
              <span className="tabular-nums" dir="ltr">
                {format.number(line.qty)} × {money(line.unitPrice)}
              </span>
            }
            value={money(line.lineTotal + line.lineDiscount)}
          />
          {line.lineDiscount > 0 && (
            <Row label={t("discount")} value={`-${money(line.lineDiscount)}`} />
          )}
        </div>
      ))}

      <Dashes />

      <Row label={t("subtotal")} value={money(receipt.subtotal)} />
      {receipt.vatBreakdown.map((row) => (
        <Row
          key={row.rateBp}
          label={t("vatRate", { rate: row.rateBp / 100 })}
          value={money(row.tax)}
        />
      ))}
      {receipt.discountTotal > 0 && (
        <Row label={t("discount")} value={`-${money(receipt.discountTotal)}`} />
      )}

      <div className="mt-1 flex items-baseline justify-between border-t border-dashed border-black pt-1 text-sm font-bold">
        <span>{t("total")}</span>
        <span className="tabular-nums" dir="ltr">
          {money(receipt.total)}
        </span>
      </div>

      <Row label={t("paymentMethod")} value={t(`payment.${receipt.paymentMethod}`)} ltr={false} />
      {receipt.amountTendered !== null && (
        <>
          <Row label={t("tendered")} value={money(receipt.amountTendered)} />
          <Row label={t("change")} value={money(receipt.changeDue ?? 0)} />
        </>
      )}

      <Dashes />

      <div className="flex flex-col items-center gap-1 pt-1 text-center">
        <ReceiptQr value={receipt.qrValue} className="size-[18mm]" />
        <div className="tabular-nums" dir="ltr">
          #{receipt.saleNumber}
        </div>
        <div>{t("thankYou")}</div>
      </div>
    </div>
  );
}

/** Label/value line; money values keep LTR digits inside the RTL layout. */
function Row({
  label,
  value,
  ltr = true,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  ltr?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="min-w-0">{label}</span>
      {ltr ? (
        <span className="tabular-nums" dir="ltr">
          {value}
        </span>
      ) : (
        <span>{value}</span>
      )}
    </div>
  );
}

function Dashes() {
  return <div className="my-1 border-t border-dashed border-black" />;
}
```

- [x] **Step 6: Create the actions bar and rewrite the receipt page**

Create `components/receipts/receipt-actions.tsx` (Print + New sale for now; auto-print lands in Task 3, PDF in Task 4):

```tsx
"use client";

import { Printer } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";

export function ReceiptActions() {
  const t = useTranslations("receipt");

  return (
    <div className="flex w-full flex-wrap items-center gap-2 print:hidden">
      <Button onClick={() => window.print()}>
        <Printer className="size-4" />
        {t("print")}
      </Button>
      <Button variant="outline" asChild className="ms-auto">
        <Link href="/register">{t("newSale")}</Link>
      </Button>
    </div>
  );
}
```

Replace the ENTIRE contents of `app/[locale]/(app)/receipts/[id]/page.tsx` with:

```tsx
import { notFound } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { getSaleWithItems } from "@/lib/supabase/queries/sales";
import { buildReceipt } from "@/lib/receipts/build";
import { Receipt80mm } from "@/components/receipts/receipt-80mm";
import { ReceiptActions } from "@/components/receipts/receipt-actions";

export default async function ReceiptPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const [t, sale] = await Promise.all([getTranslations("receipt"), getSaleWithItems(id)]);
  if (!sale) notFound();
  const receipt = buildReceipt(sale);

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">
        {t("title", { number: receipt.saleNumber })}
      </h1>
      <ReceiptActions />
      <div className="receipt-print-area self-center overflow-hidden rounded-md border shadow-sm">
        <Receipt80mm receipt={receipt} />
      </div>
    </div>
  );
}
```

- [x] **Step 7: Verify**

Run: `npm run typecheck` — expected: exit 0.
Run: `npm run dev`, sign in, complete a sale on the register (or open an existing sale via `/en/receipts/<id>`), and check:
- The receipt shows store header, tax ID, date/time, receipt #, cashier, items (qty × unit price, line totals), per-rate VAT rows, discount (if any), bold total, payment method, tendered/change (cash), QR, thank-you line.
- Print button opens the browser dialog showing ONLY the receipt at 80mm paper size (pick "Save as PDF" to inspect; no sidebar/header/buttons).
- Switch locale to `ar` — layout is RTL, labels Arabic, amounts render with Arabic-Indic digits, print preview still clean.

---

### Task 3: Auto-print flow after checkout

**Files:**
- Modify: `components/receipts/receipt-actions.tsx` (auto-print toggle + effect)
- Modify: `app/[locale]/(app)/receipts/[id]/page.tsx` (pass `justCompleted` from searchParams)
- Modify: `components/register/checkout-dialog.tsx` (redirect with `?new=1`)

**Interfaces:**
- Consumes: Task 2's components.
- Produces: `ReceiptActions` now takes `{ justCompleted: boolean }`. Checkout navigates to `/receipts/{id}?new=1`; localStorage key `cachier.autoPrintReceipt` (`"1"`/`"0"`) persists the toggle. Task 4 extends this same component.

- [x] **Step 1: Extend ReceiptActions with the auto-print option**

Replace the ENTIRE contents of `components/receipts/receipt-actions.tsx` with:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { Printer } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

const AUTO_PRINT_KEY = "cachier.autoPrintReceipt";

export function ReceiptActions({ justCompleted }: { justCompleted: boolean }) {
  const t = useTranslations("receipt");
  const [autoPrint, setAutoPrint] = useState(false);
  const firedRef = useRef(false);

  // localStorage is client-only — read it after mount (the React version of
  // guarding with onMounted in Vue) so SSR and first client render agree.
  useEffect(() => {
    setAutoPrint(localStorage.getItem(AUTO_PRINT_KEY) === "1");
  }, []);

  // fresh from checkout + toggle on → open the print dialog exactly once
  useEffect(() => {
    if (!justCompleted || firedRef.current) return;
    if (localStorage.getItem(AUTO_PRINT_KEY) !== "1") return;
    firedRef.current = true;
    const id = setTimeout(() => window.print(), 300);
    return () => clearTimeout(id);
  }, [justCompleted]);

  function toggleAutoPrint(next: boolean) {
    setAutoPrint(next);
    localStorage.setItem(AUTO_PRINT_KEY, next ? "1" : "0");
  }

  return (
    <div className="flex w-full flex-col gap-3 print:hidden">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => window.print()}>
          <Printer className="size-4" />
          {t("print")}
        </Button>
        <Button variant="outline" asChild className="ms-auto">
          <Link href="/register">{t("newSale")}</Link>
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <Switch id="auto-print" checked={autoPrint} onCheckedChange={toggleAutoPrint} />
        <Label htmlFor="auto-print" className="text-muted-foreground font-normal">
          {t("autoPrint")}
        </Label>
      </div>
    </div>
  );
}
```

- [x] **Step 2: Pass `justCompleted` from the page**

In `app/[locale]/(app)/receipts/[id]/page.tsx`, change the component signature and the two lines that use it:

```tsx
export default async function ReceiptPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ new?: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const [t, sale, sp] = await Promise.all([
    getTranslations("receipt"),
    getSaleWithItems(id),
    searchParams,
  ]);
  if (!sale) notFound();
  const receipt = buildReceipt(sale);
```

and render `<ReceiptActions justCompleted={sp.new === "1"} />` instead of `<ReceiptActions />`.

- [x] **Step 3: Tag the post-checkout navigation**

In `components/register/checkout-dialog.tsx`, change:

```tsx
      router.push(`/receipts/${result.data.saleId}`);
```

to:

```tsx
      router.push(`/receipts/${result.data.saleId}?new=1`);
```

- [x] **Step 4: Verify**

Run: `npm run typecheck` — expected: exit 0.
Manual (dev server): open any receipt → enable the auto-print switch → go to register → complete a sale → the receipt opens AND the print dialog appears by itself. Cancel it; reload the page (still `?new=1`) — because `firedRef`/effect re-runs on reload, the dialog fires again on reload: acceptable (reload of a "just completed" URL re-offers printing). Turn the switch off → complete another sale → no dialog. The Print button still works as reprint on any old receipt.

---

### Task 4: PDF download with correct Arabic

**Files:**
- Create: `lib/receipts/pdf.ts`
- Create: `public/fonts/Amiri-Regular.ttf` (downloaded)
- Modify: `components/receipts/receipt-actions.tsx` (Download PDF button)
- Modify: `app/[locale]/(app)/receipts/[id]/page.tsx` (pass `receipt` prop)
- Modify: `messages/en.json`, `messages/ar.json` (`errors.pdfFailed`)
- Modify: `package.json` / lockfile via `npm install jspdf`

**Interfaces:**
- Consumes: `ReceiptData` from Task 1; `formatEgp` from `lib/money.ts`.
- Produces: `downloadReceiptPdf(receipt: ReceiptData, locale: string, labels: ReceiptPdfLabels): Promise<void>` — client-only, dynamically imported. `ReceiptActions` props become `{ receipt: ReceiptData; justCompleted: boolean }`.

- [x] **Step 1: Install jsPDF and download the Arabic font**

Run: `npm install jspdf`
Expected: exit 0.

Run (Bash tool):
```bash
mkdir -p public/fonts && curl -sL -o public/fonts/Amiri-Regular.ttf "https://github.com/google/fonts/raw/main/ofl/amiri/Amiri-Regular.ttf" && ls -la public/fonts/
```
Expected: `Amiri-Regular.ttf` ~431,116 bytes (URL verified working on 2026-07-05). Amiri is SIL OFL licensed — bundling is fine. jsPDF ships an Arabic contextual shaper + bidi engine, but only an embedded Arabic-capable TTF makes it usable; the built-in Helvetica has no Arabic glyphs.

- [x] **Step 2: Add the pdfFailed error message**

In `messages/en.json`, inside `"errors"`, add after `"imageUploadFailed"`:

```json
    "pdfFailed": "Could not create the PDF. Try again.",
```

In `messages/ar.json`, inside `"errors"`, add after `"imageUploadFailed"`:

```json
    "pdfFailed": "تعذّر إنشاء ملف PDF. حاول مرة أخرى.",
```

- [x] **Step 3: Implement the PDF renderer**

Create `lib/receipts/pdf.ts`:

```ts
// Client-side PDF receipt (80mm-wide page, mirrors the print view).
// jsPDF + embedded Amiri: jsPDF's Arabic shaper/bidi engine produces
// correctly connected RTL Arabic once an Arabic-capable font is active.
// Imported dynamically from ReceiptActions so jsPDF stays out of the
// main bundle.
import { formatEgp } from "@/lib/money";
import type { ReceiptData } from "./types";

export type ReceiptPdfLabels = {
  taxId: string; // pre-interpolated, e.g. "Tax ID: 100-200-300"
  saleNo: string;
  date: string;
  cashier: string;
  discount: string;
  subtotal: string;
  vatRate: (ratePercent: number) => string;
  total: string;
  paymentMethod: string;
  payment: string; // localized "Cash"/"Card"
  tendered: string;
  change: string;
  thankYou: string;
};

const FONT_URL = "/fonts/Amiri-Regular.ttf";
let cachedFontBase64: string | null = null;

async function loadFontBase64(): Promise<string> {
  if (cachedFontBase64) return cachedFontBase64;
  const res = await fetch(FONT_URL);
  if (!res.ok) throw new Error(`receipt font fetch failed: ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  let bin = "";
  const CHUNK = 0x8000; // stay under the fn-arg-count limit
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  cachedFontBase64 = btoa(bin);
  return cachedFontBase64;
}

const W = 80; // page width, mm — same as the thermal paper
const M = 5; // side margin, mm
const LH = 4.6; // base line height, mm

export async function downloadReceiptPdf(
  receipt: ReceiptData,
  locale: string,
  labels: ReceiptPdfLabels
): Promise<void> {
  const [{ jsPDF }, qrcodeModule, font] = await Promise.all([
    import("jspdf"),
    import("qrcode"),
    loadFontBase64(),
  ]);
  const QRCode = qrcodeModule.default;
  const isAr = locale === "ar";
  const money = (v: number) => formatEgp(v, locale);

  // jsPDF pages can't grow after creation — estimate the height up front
  const itemRows = receipt.lines.reduce((n, l) => n + 2 + (l.lineDiscount > 0 ? 1 : 0), 0);
  const totalRows = 4 + receipt.vatBreakdown.length + (receipt.amountTendered !== null ? 2 : 0);
  const height = 40 + (itemRows + totalRows) * LH + 45;

  const doc = new jsPDF({ unit: "mm", format: [W, height] });
  doc.addFileToVFS("Amiri-Regular.ttf", font);
  doc.addFont("Amiri-Regular.ttf", "Amiri", "normal");
  doc.setFont("Amiri");
  doc.setFontSize(10);

  let y = 10;

  const center = (text: string, size = 10) => {
    doc.setFontSize(size);
    doc.text(text, W / 2, y, { align: "center" });
    y += LH * (size / 10);
    doc.setFontSize(10);
  };
  // label at the reading start, value at the end — mirrors under RTL
  const row = (label: string, value: string, size = 10) => {
    doc.setFontSize(size);
    if (isAr) {
      doc.text(label, W - M, y, { align: "right" });
      doc.text(value, M, y, { align: "left" });
    } else {
      doc.text(label, M, y, { align: "left" });
      doc.text(value, W - M, y, { align: "right" });
    }
    y += LH * (size / 10);
    doc.setFontSize(10);
  };
  const dashes = () => {
    doc.setLineDashPattern([1, 1], 0);
    doc.line(M, y - 1.5, W - M, y - 1.5);
    y += 2.5;
  };

  center(isAr ? receipt.store.nameAr : receipt.store.nameEn, 13);
  center(isAr ? receipt.store.addressAr : receipt.store.addressEn);
  center(receipt.store.phone);
  center(labels.taxId);
  dashes();

  row(labels.saleNo, `#${receipt.saleNumber}`);
  row(
    labels.date,
    new Intl.DateTimeFormat(isAr ? "ar-EG" : "en-EG", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(receipt.createdAt))
  );
  if (receipt.cashierName) row(labels.cashier, receipt.cashierName);
  dashes();

  for (const line of receipt.lines) {
    const name = isAr ? line.nameAr : line.nameEn;
    if (isAr) doc.text(name, W - M, y, { align: "right" });
    else doc.text(name, M, y, { align: "left" });
    y += LH;
    row(`${line.qty} × ${money(line.unitPrice)}`, money(line.lineTotal + line.lineDiscount));
    if (line.lineDiscount > 0) row(labels.discount, `-${money(line.lineDiscount)}`);
  }
  dashes();

  row(labels.subtotal, money(receipt.subtotal));
  for (const rate of receipt.vatBreakdown) {
    row(labels.vatRate(rate.rateBp / 100), money(rate.tax));
  }
  if (receipt.discountTotal > 0) row(labels.discount, `-${money(receipt.discountTotal)}`);
  row(labels.total, money(receipt.total), 13);
  row(labels.paymentMethod, labels.payment);
  if (receipt.amountTendered !== null) {
    row(labels.tendered, money(receipt.amountTendered));
    row(labels.change, money(receipt.changeDue ?? 0));
  }
  dashes();

  const qr = await QRCode.toDataURL(receipt.qrValue, { margin: 0, width: 256 });
  doc.addImage(qr, "PNG", (W - 20) / 2, y, 20, 20);
  y += 24;
  center(`#${receipt.saleNumber}`);
  center(labels.thankYou);

  doc.save(`receipt-${receipt.saleNumber}.pdf`);
}
```

- [x] **Step 4: Wire the Download PDF button**

Replace the ENTIRE contents of `components/receipts/receipt-actions.tsx` with:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { FileDown, Loader2, Printer } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { ReceiptData } from "@/lib/receipts/types";

const AUTO_PRINT_KEY = "cachier.autoPrintReceipt";

export function ReceiptActions({
  receipt,
  justCompleted,
}: {
  receipt: ReceiptData;
  justCompleted: boolean;
}) {
  const t = useTranslations("receipt");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const [autoPrint, setAutoPrint] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const firedRef = useRef(false);

  // localStorage is client-only — read it after mount (the React version of
  // guarding with onMounted in Vue) so SSR and first client render agree.
  useEffect(() => {
    setAutoPrint(localStorage.getItem(AUTO_PRINT_KEY) === "1");
  }, []);

  // fresh from checkout + toggle on → open the print dialog exactly once
  useEffect(() => {
    if (!justCompleted || firedRef.current) return;
    if (localStorage.getItem(AUTO_PRINT_KEY) !== "1") return;
    firedRef.current = true;
    const id = setTimeout(() => window.print(), 300);
    return () => clearTimeout(id);
  }, [justCompleted]);

  function toggleAutoPrint(next: boolean) {
    setAutoPrint(next);
    localStorage.setItem(AUTO_PRINT_KEY, next ? "1" : "0");
  }

  async function downloadPdf() {
    if (downloading) return;
    setDownloading(true);
    try {
      // dynamic import ≈ defineAsyncComponent for plain modules: jsPDF
      // (~350KB) loads only when someone actually downloads a PDF
      const { downloadReceiptPdf } = await import("@/lib/receipts/pdf");
      await downloadReceiptPdf(receipt, locale, {
        taxId: t("taxId", { id: receipt.store.taxId }),
        saleNo: t("saleNo"),
        date: t("date"),
        cashier: t("cashier"),
        discount: t("discount"),
        subtotal: t("subtotal"),
        vatRate: (rate) => t("vatRate", { rate }),
        total: t("total"),
        paymentMethod: t("paymentMethod"),
        payment: t(`payment.${receipt.paymentMethod}`),
        tendered: t("tendered"),
        change: t("change"),
        thankYou: t("thankYou"),
      });
    } catch {
      toast.error(tErrors("pdfFailed"));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="flex w-full flex-col gap-3 print:hidden">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => window.print()}>
          <Printer className="size-4" />
          {t("print")}
        </Button>
        <Button variant="outline" onClick={downloadPdf} disabled={downloading}>
          {downloading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <FileDown className="size-4" />
          )}
          {t("downloadPdf")}
        </Button>
        <Button variant="outline" asChild className="ms-auto">
          <Link href="/register">{t("newSale")}</Link>
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <Switch id="auto-print" checked={autoPrint} onCheckedChange={toggleAutoPrint} />
        <Label htmlFor="auto-print" className="text-muted-foreground font-normal">
          {t("autoPrint")}
        </Label>
      </div>
    </div>
  );
}
```

In `app/[locale]/(app)/receipts/[id]/page.tsx`, change:

```tsx
      <ReceiptActions justCompleted={sp.new === "1"} />
```

to:

```tsx
      <ReceiptActions receipt={receipt} justCompleted={sp.new === "1"} />
```

- [x] **Step 5: Verify — including the Arabic rendering gate**

Run: `npm run typecheck` — expected: exit 0.
Manual (dev server):
- On an English receipt, click Download PDF → `receipt-<n>.pdf` downloads; open it: layout mirrors the print view, QR present.
- Switch to Arabic, download again → **inspect the Arabic text closely**: letters must be CONNECTED (e.g. "شكرًا" as one joined word, not ش ك ر ا as isolated glyphs) and read right-to-left. Arabic-Indic digits from `formatEgp` must render.
- **If Arabic renders disconnected or reversed:** jsPDF's shaper didn't engage. Fix by calling `doc.setR2L(false)` explicitly after `setFont` (the shaper handles direction; setR2L(true) would double-reverse), and verify the font actually loaded (a failed `addFont` silently falls back to Helvetica → tofu boxes). Debug before moving on — this is a phase "done when" criterion.

---

### Task 5: Sales history page

**Files:**
- Modify: `lib/supabase/queries/sales.ts` (add `getSales`, `getCashiers`)
- Create: `app/[locale]/(app)/receipts/page.tsx`
- Modify: `components/layout/app-sidebar.tsx` (nav item)
- Modify: `messages/en.json`, `messages/ar.json` (`nav.sales` + new `sales` namespace)

**Interfaces:**
- Consumes: `createClient` from `lib/supabase/server`, `normalizeDigits` from `lib/money.ts`.
- Produces: `getSales({ q, from, to, cashierId, page }) → { rows: SaleListRow[], total, page, pageCount }` and `getCashiers() → { id, full_name }[]`. RLS already scopes cashiers to their own sales/profile — no extra gating needed.

- [x] **Step 1: Add the list queries**

In `lib/supabase/queries/sales.ts`, restore the `Tables` type import and append the list API. The full file becomes:

```ts
import "server-only";
import { createClient } from "@/lib/supabase/server";
import { normalizeDigits } from "@/lib/money";
import type { Tables } from "@/lib/supabase/database.types";
import type { SaleForReceipt } from "@/lib/receipts/types";

export type SaleWithItems = SaleForReceipt;

export async function getSaleWithItems(id: string): Promise<SaleWithItems | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sales")
    .select("*, sale_items(*), profiles(full_name)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data as SaleWithItems | null;
}

export const SALES_PAGE_SIZE = 20;

export type SalesListParams = {
  /** sale_number search — digits, Arabic-Indic accepted */
  q?: string;
  /** inclusive YYYY-MM-DD bounds. UTC day edges — good enough until a
   *  store-timezone setting exists (Cairo is UTC+2/+3). */
  from?: string;
  to?: string;
  cashierId?: string;
  page?: number;
};

export type SaleListRow = Tables<"sales"> & {
  profiles: Pick<Tables<"profiles">, "full_name"> | null;
  sale_items: { count: number }[];
};

export async function getSales({ q, from, to, cashierId, page = 1 }: SalesListParams) {
  const supabase = await createClient();
  let query = supabase
    .from("sales")
    .select("*, profiles(full_name), sale_items(count)", { count: "exact" });

  if (q?.trim()) {
    const n = Number(normalizeDigits(q.trim()));
    // a non-numeric query can never match a sale_number
    query = query.eq("sale_number", Number.isSafeInteger(n) && n > 0 ? n : -1);
  }
  if (from) query = query.gte("created_at", `${from}T00:00:00Z`);
  if (to) query = query.lte("created_at", `${to}T23:59:59.999Z`);
  if (cashierId) query = query.eq("cashier_id", cashierId);

  const fromRow = (page - 1) * SALES_PAGE_SIZE;
  const { data, count, error } = await query
    .order("created_at", { ascending: false })
    .range(fromRow, fromRow + SALES_PAGE_SIZE - 1);
  if (error) throw error;
  return {
    rows: (data ?? []) as SaleListRow[],
    total: count ?? 0,
    page,
    pageCount: Math.max(1, Math.ceil((count ?? 0) / SALES_PAGE_SIZE)),
  };
}

/** Cashier filter options. RLS trims this to the caller's own profile for
 *  non-admins, so cashiers effectively filter within their own sales. */
export async function getCashiers(): Promise<Pick<Tables<"profiles">, "id" | "full_name">[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name")
    .order("full_name");
  if (error) throw error;
  return data ?? [];
}
```

- [x] **Step 2: Add i18n keys**

In `messages/en.json`: change the `nav` object to include sales after register:

```json
  "nav": {
    "register": "Register",
    "sales": "Sales",
    "products": "Products",
    "categories": "Categories",
    "reports": "Reports",
    "shifts": "Shifts"
  },
```

and add a top-level `sales` namespace right before `"receipt"`:

```json
  "sales": {
    "title": "Sales history",
    "count": "{count} sales",
    "searchNumber": "Sale #",
    "from": "From",
    "to": "To",
    "cashier": "Cashier",
    "allCashiers": "All",
    "apply": "Filter",
    "reset": "Reset",
    "colNumber": "No.",
    "colDate": "Date",
    "colCashier": "Cashier",
    "colItems": "Items",
    "colPayment": "Payment",
    "colTotal": "Total",
    "empty": "No sales match these filters.",
    "pageOf": "Page {page} of {pageCount}",
    "previousPage": "Previous page",
    "nextPage": "Next page"
  },
```

In `messages/ar.json`: nav:

```json
  "nav": {
    "register": "الكاشير",
    "sales": "المبيعات",
    "products": "المنتجات",
    "categories": "الأقسام",
    "reports": "التقارير",
    "shifts": "الورديات"
  },
```

and the `sales` namespace right before `"receipt"`:

```json
  "sales": {
    "title": "سجل المبيعات",
    "count": "{count} عملية بيع",
    "searchNumber": "رقم الفاتورة",
    "from": "من",
    "to": "إلى",
    "cashier": "الكاشير",
    "allCashiers": "الكل",
    "apply": "بحث",
    "reset": "مسح",
    "colNumber": "رقم",
    "colDate": "التاريخ",
    "colCashier": "الكاشير",
    "colItems": "الأصناف",
    "colPayment": "الدفع",
    "colTotal": "الإجمالي",
    "empty": "لا توجد مبيعات مطابقة.",
    "pageOf": "صفحة {page} من {pageCount}",
    "previousPage": "الصفحة السابقة",
    "nextPage": "الصفحة التالية"
  },
```

- [x] **Step 3: Add the sidebar entry**

In `components/layout/app-sidebar.tsx`, add `ReceiptText` to the lucide import:

```tsx
import { ShoppingCart, Package, Tags, BarChart3, Clock, Store, ReceiptText } from "lucide-react";
```

and add the nav item right after register:

```tsx
const navItems = [
  { key: "register", href: "/register", icon: ShoppingCart },
  { key: "sales", href: "/receipts", icon: ReceiptText },
  { key: "products", href: "/products", icon: Package },
  { key: "categories", href: "/categories", icon: Tags },
  { key: "reports", href: "/reports", icon: BarChart3 },
  { key: "shifts", href: "/shifts", icon: Clock },
] as const;
```

(The existing `isActive` check uses `startsWith(item.href + "/")`, so `/receipts/<id>` highlights the Sales item too.)

- [x] **Step 4: Create the sales history page**

Create `app/[locale]/(app)/receipts/page.tsx`:

```tsx
import { setRequestLocale, getTranslations, getFormatter } from "next-intl/server";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { getSales, getCashiers } from "@/lib/supabase/queries/sales";
import { formatEgp } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type SearchParams = { q?: string; from?: string; to?: string; cashier?: string; page?: string };

// Server component end to end: the filter bar is a plain GET form, so
// searching needs zero client JS (in Vue terms: no reactive state — the
// URL is the state, like classic SSR).
export default async function SalesHistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);

  const [t, tReceipt, format, cashiers, result] = await Promise.all([
    getTranslations("sales"),
    getTranslations("receipt"),
    getFormatter(),
    getCashiers(),
    getSales({ q: sp.q, from: sp.from, to: sp.to, cashierId: sp.cashier, page }),
  ]);

  const pageHref = (p: number) => {
    const qs = new URLSearchParams();
    if (sp.q) qs.set("q", sp.q);
    if (sp.from) qs.set("from", sp.from);
    if (sp.to) qs.set("to", sp.to);
    if (sp.cashier) qs.set("cashier", sp.cashier);
    if (p > 1) qs.set("page", String(p));
    const s = qs.toString();
    return `/receipts${s ? `?${s}` : ""}`;
  };

  const inputClass = "h-9 w-auto";
  const selectClass =
    "border-input h-9 rounded-md border bg-transparent px-3 text-sm shadow-xs outline-none";

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <span className="text-muted-foreground text-sm">{t("count", { count: result.total })}</span>
      </div>

      <form method="get" className="flex flex-wrap items-center gap-2">
        <Input
          name="q"
          defaultValue={sp.q ?? ""}
          inputMode="numeric"
          placeholder={t("searchNumber")}
          className={`${inputClass} w-36`}
          aria-label={t("searchNumber")}
        />
        <label className="text-muted-foreground flex items-center gap-1 text-sm">
          {t("from")}
          <Input type="date" name="from" defaultValue={sp.from ?? ""} className={inputClass} />
        </label>
        <label className="text-muted-foreground flex items-center gap-1 text-sm">
          {t("to")}
          <Input type="date" name="to" defaultValue={sp.to ?? ""} className={inputClass} />
        </label>
        <select
          name="cashier"
          defaultValue={sp.cashier ?? ""}
          className={selectClass}
          aria-label={t("cashier")}
        >
          <option value="">{t("allCashiers")}</option>
          {cashiers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.full_name}
            </option>
          ))}
        </select>
        <Button type="submit" size="sm">
          <Search className="size-4" />
          {t("apply")}
        </Button>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/receipts">{t("reset")}</Link>
        </Button>
      </form>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("colNumber")}</TableHead>
              <TableHead>{t("colDate")}</TableHead>
              <TableHead>{t("colCashier")}</TableHead>
              <TableHead>{t("colItems")}</TableHead>
              <TableHead>{t("colPayment")}</TableHead>
              <TableHead className="text-end">{t("colTotal")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground h-24 text-center">
                  {t("empty")}
                </TableCell>
              </TableRow>
            )}
            {result.rows.map((sale) => (
              <TableRow key={sale.id}>
                <TableCell>
                  <Link
                    href={`/receipts/${sale.id}`}
                    className="font-medium tabular-nums underline-offset-4 hover:underline"
                    dir="ltr"
                  >
                    #{Number(sale.sale_number)}
                  </Link>
                </TableCell>
                <TableCell>
                  {format.dateTime(new Date(sale.created_at), {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </TableCell>
                <TableCell>{sale.profiles?.full_name ?? "—"}</TableCell>
                <TableCell className="tabular-nums">{sale.sale_items[0]?.count ?? 0}</TableCell>
                <TableCell>
                  <Badge variant="secondary">{tReceipt(`payment.${sale.payment_method}`)}</Badge>
                </TableCell>
                <TableCell className="text-end tabular-nums" dir="ltr">
                  {formatEgp(Number(sale.total), locale)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {result.pageCount > 1 && (
        <div className="flex items-center justify-end gap-2">
          <span className="text-muted-foreground text-sm">
            {t("pageOf", { page: result.page, pageCount: result.pageCount })}
          </span>
          <Button
            variant="outline"
            size="icon"
            asChild
            disabled={result.page <= 1}
            aria-label={t("previousPage")}
          >
            <Link href={pageHref(result.page - 1)}>
              <ChevronLeft className="size-4 rtl:rotate-180" />
            </Link>
          </Button>
          <Button
            variant="outline"
            size="icon"
            asChild
            disabled={result.page >= result.pageCount}
            aria-label={t("nextPage")}
          >
            <Link href={pageHref(result.page + 1)}>
              <ChevronRight className="size-4 rtl:rotate-180" />
            </Link>
          </Button>
        </div>
      )}
    </div>
  );
}
```

Note: shadcn `Button asChild disabled` does not actually disable a `Link` — if the executor finds the disabled page-nav buttons still clickable, render a plain disabled `<Button>` (no `asChild`, no Link) for the boundary case:

```tsx
          {result.page <= 1 ? (
            <Button variant="outline" size="icon" disabled aria-label={t("previousPage")}>
              <ChevronLeft className="size-4 rtl:rotate-180" />
            </Button>
          ) : (
            <Button variant="outline" size="icon" asChild aria-label={t("previousPage")}>
              <Link href={pageHref(result.page - 1)}>
                <ChevronLeft className="size-4 rtl:rotate-180" />
              </Link>
            </Button>
          )}
```

(and the mirror image for next).

- [x] **Step 5: Verify**

Run: `npm run typecheck` — expected: exit 0.
Manual (dev server):
- Sidebar shows "Sales"/"المبيعات" between Register and Products; `/en/receipts` lists sales newest-first with count, cashier, items, payment badge, total.
- Search an exact sale number (try Arabic digits too, e.g. `٤٢`) → one row. Filter a date range → only sales in range. Cashier filter works (admin sees all cashiers; a cashier account sees only itself and only its own sales — RLS).
- Click a row's number → detail receipt opens with Print + Download PDF working (reprint/re-download from history ✓).

---

### Task 6: Phase verification & wrap-up

**Files:** none created — verification and the phase-end report.

- [x] **Step 1: Full check suite**

Run each; all must pass:
- `npm run typecheck` — exit 0
- `npm run lint` — exit 0
- `npm run test:receipt` — all PASS
- `npm run test:cart` — all PASS (regression: cart math untouched)
- `npm run build` — compiles with no errors

- [ ] **Step 2: Manual "done when" walkthrough (dev server)**

1. Complete a sale on the register → receipt page opens; with auto-print enabled, the print dialog opens by itself; preview shows ONLY the 80mm receipt.
2. Download the PDF in Arabic → connected RTL Arabic, embedded font, QR present.
3. **Snapshot proof:** note a sale's line prices on its receipt → edit that product's price (+ rename it) in Products → reopen the old receipt from Sales history → the receipt is UNCHANGED (names and prices come from `sale_items` snapshots). New sales pick up the new price.
4. Both locales: receipt prints correctly in AR (RTL) and EN (LTR).

- [x] **Step 3: Phase-end report to the user**

Write the phase summary in the final message: what was built (file list), manual test steps (condensed from above), and 2–3 React↔Vue notes — suggested topics: (a) next-intl `useTranslations` working inside Server Components vs Vue's client-only `useI18n`; (b) `dynamic import()` of jsPDF as the plain-module analog of `defineAsyncComponent`; (c) URL-as-state GET-form filtering in RSC vs Vue reactive `ref` + watcher driving a fetch.

---

## Self-review notes

- **Spec coverage:** renderer seam (T1), 80mm print view with every required field incl. VAT-by-rate and QR-of-sale_number (T2), print flow with auto-print + reprint + chrome-free dialog (T2/T3), Arabic-correct PDF with embedded font (T4), searchable history by number/date/cashier rendered from snapshots with reprint/re-download (T5), AR/EN throughout (all), snapshot proof + done-when gates (T6). No gaps found.
- **Type consistency:** `SaleForReceipt`/`ReceiptData`/`ReceiptLine`/`VatBreakdownRow` defined once in T1 and imported everywhere; `ReceiptActions` prop evolution is explicit per task (T2 none → T3 `justCompleted` → T4 `receipt + justCompleted`); `ReceiptPdfLabels.vatRate` is a function to keep interpolation in next-intl.
- **Known simplifications (accepted):** date filters use UTC day edges (comment in code; store-timezone setting is future work); reloading a `?new=1` URL re-fires auto-print (noted in T3 verify); `getCashiers` returns one row for cashiers, which is correct behavior via RLS.
