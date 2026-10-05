import { z } from "zod";

const dateTime = z.iso.datetime({ offset: true }).or(z.iso.datetime());

export const createPromotionSchema = z
  .object({
    nameAr: z.string().trim().min(1).max(120),
    nameEn: z.string().trim().min(1).max(120),
    code: z
      .string()
      .trim()
      .max(40)
      .regex(/^[A-Za-z0-9_-]*$/, "codeFormat")
      .optional()
      .transform((value) => (value ? value : undefined)),
    scope: z.enum(["items", "order"]),
    discountKind: z.enum(["percent", "fixed"]),
    /** 1..10000 (basis points) when percent */
    percentBp: z.number().int().min(1).max(10_000).optional(),
    /** piasters; per unit for item scope, per order for order scope */
    fixedAmount: z.number().int().min(1).max(1_000_000_000).optional(),
    categoryId: z.uuid().optional(),
    productIds: z.array(z.uuid()).max(500).optional(),
    minSpend: z.number().int().min(0).max(1_000_000_000).default(0),
    startsAt: dateTime.optional(),
    endsAt: dateTime.optional(),
    customerRequired: z.boolean().default(false),
    maxRedemptions: z.number().int().min(1).max(10_000_000).optional(),
    maxPerCustomer: z.number().int().min(1).max(10_000).optional(),
    stackable: z.boolean().default(false),
    priority: z.number().int().min(0).max(10_000).default(100),
  })
  .refine((v) => v.discountKind !== "percent" || v.percentBp !== undefined, { message: "percentRequired", path: ["percentBp"] })
  .refine((v) => v.discountKind !== "fixed" || v.fixedAmount !== undefined, { message: "fixedRequired", path: ["fixedAmount"] })
  .refine((v) => !v.startsAt || !v.endsAt || new Date(v.endsAt) > new Date(v.startsAt), {
    message: "windowOrder",
    path: ["endsAt"],
  });

export const togglePromotionSchema = z.object({ promotionId: z.uuid(), active: z.boolean() });

export const previewPromotionsSchema = z.object({
  items: z
    .array(
      z.object({
        product_id: z.uuid(),
        qty: z.number().positive().max(9_999_999),
        line_discount: z.number().int().min(0),
      })
    )
    .min(1)
    .max(200),
  customerId: z.uuid().optional(),
  codes: z.array(z.string().trim().min(1).max(40)).max(5).optional(),
});

export type CreatePromotionInput = z.infer<typeof createPromotionSchema>;
