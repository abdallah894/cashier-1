// CSV import: column definitions + per-row validation.
// Pure functions — used client-side for the preview AND re-run
// server-side before inserting (never trust the preview).
import { normalizeDigits, parseEgpToPiasters, parseQty } from "@/lib/money";
import type { ProductInput } from "./product";

export const CSV_COLUMNS = [
  "barcode",
  "name_ar",
  "name_en",
  "category",
  "price_egp",
  "cost_egp",
  "tax_rate_percent",
  "unit",
  "stock_qty",
  "low_stock_threshold",
  "active",
] as const;

export type CsvColumn = (typeof CSV_COLUMNS)[number];
export type RawCsvRow = Partial<Record<CsvColumn, string>>;

export type RowIssue = { field: CsvColumn; message: string };

export type CategoryRef = { id: string; name_ar: string; name_en: string };

const TRUE_WORDS = new Set(["", "1", "true", "yes", "y", "نعم"]);
const FALSE_WORDS = new Set(["0", "false", "no", "n", "لا"]);

function parseUnit(raw: string): "piece" | "kg" | null {
  const v = raw.trim().toLowerCase();
  if (v === "" || v === "piece" || v === "قطعة") return "piece";
  if (v === "kg" || v === "كجم" || v === "كيلو") return "kg";
  return null;
}

/** Template rows shown in the downloadable CSV (also used by tests). */
export const TEMPLATE_ROWS: RawCsvRow[] = [
  {
    barcode: "6221001234560",
    name_ar: "أرز بسمتي ١ كجم",
    name_en: "Basmati Rice 1kg",
    category: "Groceries",
    price_egp: "89.95",
    cost_egp: "75",
    tax_rate_percent: "0",
    unit: "piece",
    stock_qty: "50",
    low_stock_threshold: "10",
    active: "yes",
  },
  {
    barcode: "6221001234577",
    name_ar: "برتقال",
    name_en: "Oranges",
    category: "Produce",
    price_egp: "25.50",
    cost_egp: "18",
    tax_rate_percent: "0",
    unit: "kg",
    stock_qty: "35.5",
    low_stock_threshold: "8",
    active: "yes",
  },
];

export function validateCsvRow(
  row: RawCsvRow,
  categories: CategoryRef[]
): { input: ProductInput | null; issues: RowIssue[] } {
  const issues: RowIssue[] = [];
  const get = (col: CsvColumn) => (row[col] ?? "").trim();

  const barcode = get("barcode");
  if (!barcode) issues.push({ field: "barcode", message: "required" });
  else if (!/^[0-9A-Za-z-]{1,32}$/.test(barcode))
    issues.push({ field: "barcode", message: "invalidBarcode" });

  const nameAr = get("name_ar");
  if (!nameAr) issues.push({ field: "name_ar", message: "required" });
  const nameEn = get("name_en");
  if (!nameEn) issues.push({ field: "name_en", message: "required" });

  let categoryId: string | null = null;
  const categoryName = get("category");
  if (categoryName) {
    const needle = categoryName.toLowerCase();
    const match = categories.find(
      (c) => c.name_en.toLowerCase() === needle || c.name_ar === categoryName
    );
    if (!match) issues.push({ field: "category", message: "unknownCategory" });
    else categoryId = match.id;
  }

  const price = parseEgpToPiasters(get("price_egp"));
  if (price === null) issues.push({ field: "price_egp", message: "invalidAmount" });

  const costRaw = get("cost_egp");
  const cost = costRaw === "" ? 0 : parseEgpToPiasters(costRaw);
  if (cost === null) issues.push({ field: "cost_egp", message: "invalidAmount" });

  const taxRaw = normalizeDigits(get("tax_rate_percent")).replace("%", "");
  let taxRate = 0.14;
  if (taxRaw !== "") {
    const pct = Number(taxRaw);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      issues.push({ field: "tax_rate_percent", message: "invalidTaxRate" });
    } else {
      taxRate = Math.round(pct * 100) / 10000;
    }
  }

  const unit = parseUnit(get("unit"));
  if (unit === null) issues.push({ field: "unit", message: "invalidUnit" });

  let stockQty = 0;
  const stockRaw = get("stock_qty");
  if (stockRaw !== "" && unit !== null) {
    const parsed = parseQty(stockRaw, unit);
    if (parsed === null) issues.push({ field: "stock_qty", message: "invalidQty" });
    else stockQty = parsed;
  }

  let threshold = 10;
  const thresholdRaw = get("low_stock_threshold");
  if (thresholdRaw !== "" && unit !== null) {
    const parsed = parseQty(thresholdRaw, unit);
    if (parsed === null) issues.push({ field: "low_stock_threshold", message: "invalidQty" });
    else threshold = parsed;
  }

  const activeRaw = get("active").toLowerCase();
  let active = true;
  if (FALSE_WORDS.has(activeRaw)) active = false;
  else if (!TRUE_WORDS.has(activeRaw)) issues.push({ field: "active", message: "invalidBoolean" });

  if (issues.length > 0) return { input: null, issues };

  return {
    input: {
      barcode,
      name_ar: nameAr,
      name_en: nameEn,
      category_id: categoryId,
      price: price!,
      cost: cost!,
      tax_rate: taxRate,
      unit: unit!,
      stock_qty: stockQty,
      low_stock_threshold: threshold,
      active,
      image_url: null,
    },
    issues: [],
  };
}
