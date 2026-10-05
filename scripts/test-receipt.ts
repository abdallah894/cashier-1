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
    client_sold_at: null,
    idempotency_key: null,
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
