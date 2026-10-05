import { z } from "zod";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : undefined));

export const supplierSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: optionalText(40),
  email: z.union([z.literal(""), z.email()]).optional().transform((value) => (value ? value : undefined)),
  taxId: optionalText(40),
  paymentTerms: optionalText(120),
  notes: optionalText(500),
});

export const updateSupplierSchema = supplierSchema.extend({
  id: z.uuid(),
  active: z.boolean(),
});

const quantity = z
  .number()
  .positive()
  .max(9_999_999)
  .refine((value) => Math.round(value * 1000) === value * 1000, { message: "At most three decimal places." });

export const createPurchaseOrderSchema = z.object({
  supplierId: z.uuid(),
  expectedDate: z.iso.date().optional(),
  note: optionalText(500),
  lines: z
    .array(
      z.object({
        productId: z.uuid(),
        orderedQty: quantity,
        /** piasters, ex-VAT */
        unitCost: z.number().int().min(0).max(1_000_000_000),
        /** fraction 0..1; omitted = the product's own rate */
        taxRate: z.number().min(0).max(1).optional(),
      })
    )
    .min(1)
    .max(200)
    .refine((lines) => new Set(lines.map((line) => line.productId)).size === lines.length, {
      message: "duplicateProduct",
    }),
});

export const purchaseOrderIdSchema = z.object({ poId: z.uuid() });

export const receivePurchaseOrderSchema = z.object({
  poId: z.uuid(),
  invoiceReference: optionalText(80),
  note: optionalText(500),
  /** one per receiving attempt: a double submit never receives twice */
  idempotencyKey: z.uuid(),
  lines: z
    .array(
      z.object({
        poLineId: z.uuid(),
        qty: quantity,
        /** piasters actually invoiced; omitted = the ordered cost */
        unitCost: z.number().int().min(0).max(1_000_000_000).optional(),
      })
    )
    .min(1)
    .max(200),
});

export const reportRangeSchema = z.object({ from: z.iso.datetime(), to: z.iso.datetime() });
