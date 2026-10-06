import { z } from "zod";
import { parseEgpToPiasters, parseQty, piastersToEgpInput } from "@/lib/money";
import type { Tables } from "@/lib/supabase/database.types";

// Error messages are i18n KEYS (translated by FieldError / toasts),
// never English prose — the same schema serves AR and EN.

// ---------- server-side input (what actions validate and insert) ----------

export const productInputSchema = z.object({
  barcode: z
    .string()
    .trim()
    .min(1, "required")
    .max(32, "tooLong")
    .regex(/^[0-9A-Za-z-]+$/, "invalidBarcode"),
  name_ar: z.string().trim().min(1, "required").max(200, "tooLong"),
  name_en: z.string().trim().min(1, "required").max(200, "tooLong"),
  category_id: z.uuid().nullable(),
  price: z.number().int("invalidAmount").min(0, "invalidAmount"),
  cost: z.number().int("invalidAmount").min(0, "invalidAmount"),
  tax_rate: z.number().min(0, "invalidTaxRate").max(1, "invalidTaxRate"),
  unit: z.enum(["piece", "kg"]),
  stock_qty: z.number().min(0, "invalidQty"),
  low_stock_threshold: z.number().min(0, "invalidQty"),
  active: z.boolean(),
  image_url: z.url().nullable(),
});

export type ProductInput = z.infer<typeof productInputSchema>;

/**
 * Editing a product never touches stock: stock changes only through the
 * ledgered paths (sales, returns, receiving, stocktakes, adjust_stock).
 * Writing the quantity the form loaded earlier would silently undo any sale
 * made while the form was open. z.object strips unknown keys, so a client
 * that still sends stock_qty is simply ignored.
 */
export const productUpdateSchema = productInputSchema.omit({ stock_qty: true });

export const idSchema = z.uuid();

// ---------- form values (react-hook-form works in strings) ----------

export const productFormSchema = z.object({
  barcode: productInputSchema.shape.barcode,
  name_ar: productInputSchema.shape.name_ar,
  name_en: productInputSchema.shape.name_en,
  category_id: z.string(), // "" = no category
  price: z.string().refine((v) => parseEgpToPiasters(v) !== null, "invalidAmount"),
  cost: z.string().refine((v) => parseEgpToPiasters(v) !== null, "invalidAmount"),
  taxRatePercent: z.string().refine((v) => {
    const n = Number(v.trim());
    return Number.isFinite(n) && n >= 0 && n <= 100;
  }, "invalidTaxRate"),
  unit: z.enum(["piece", "kg"]),
  stock_qty: z.string(),
  low_stock_threshold: z.string(),
  active: z.boolean(),
});

export type ProductFormValues = z.infer<typeof productFormSchema>;

/** Form strings → validated server input. qty fields depend on unit. */
export function toProductInput(
  values: ProductFormValues,
  imageUrl: string | null
): ProductInput | { fieldError: { field: keyof ProductFormValues; message: string } } {
  const stockQty = parseQty(values.stock_qty || "0", values.unit);
  if (stockQty === null) return { fieldError: { field: "stock_qty", message: "invalidQty" } };
  const threshold = parseQty(values.low_stock_threshold || "0", values.unit);
  if (threshold === null)
    return { fieldError: { field: "low_stock_threshold", message: "invalidQty" } };

  return {
    barcode: values.barcode.trim(),
    name_ar: values.name_ar.trim(),
    name_en: values.name_en.trim(),
    category_id: values.category_id === "" ? null : values.category_id,
    price: parseEgpToPiasters(values.price)!,
    cost: parseEgpToPiasters(values.cost)!,
    // percent → fraction in integer math (basis points / 10000)
    tax_rate: Math.round(Number(values.taxRatePercent) * 100) / 10000,
    unit: values.unit,
    stock_qty: stockQty,
    low_stock_threshold: threshold,
    active: values.active,
    image_url: imageUrl,
  };
}

/** DB row → form default values (for the edit form). */
export function toFormValues(product: Tables<"products">): ProductFormValues {
  return {
    barcode: product.barcode,
    name_ar: product.name_ar,
    name_en: product.name_en,
    category_id: product.category_id ?? "",
    price: piastersToEgpInput(product.price),
    cost: piastersToEgpInput(product.cost),
    taxRatePercent: String(Math.round(product.tax_rate * 10000) / 100),
    unit: product.unit,
    stock_qty: String(product.stock_qty),
    low_stock_threshold: String(product.low_stock_threshold),
    active: product.active,
  };
}

// ---------- categories ----------

export const categoryInputSchema = z.object({
  name_ar: z.string().trim().min(1, "required").max(100, "tooLong"),
  name_en: z.string().trim().min(1, "required").max(100, "tooLong"),
  sort_order: z.number().int().min(0),
});

export type CategoryInput = z.infer<typeof categoryInputSchema>;

// ---------- stock adjustment ----------

export const stockAdjustmentSchema = z.object({
  product_id: z.uuid(),
  qty_change: z
    .number()
    .refine((n) => n !== 0, "qtyChangeZero")
    .refine((n) => Number.isFinite(n) && Math.abs(n) < 10_000_000, "invalidQty"),
  reason: z.enum(["received", "damaged", "correction"]),
  note: z.string().trim().max(500, "tooLong").optional(),
  approvalId: z.uuid().optional(),
});

export type StockAdjustmentInput = z.infer<typeof stockAdjustmentSchema>;
