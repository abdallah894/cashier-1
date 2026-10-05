import { z } from "zod";

const quantity = z
  .number()
  .min(0)
  .max(9_999_999)
  .refine((value) => Math.round(value * 1000) === value * 1000, {
    message: "At most three decimal places.",
  });

export const createStocktakeSchema = z
  .object({
    scope: z.enum(["full", "cycle"]),
    categoryId: z.uuid().optional(),
    note: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.scope === "full" || v.categoryId !== undefined, { message: "categoryRequired" });

export const saveCountsSchema = z.object({
  stocktakeId: z.uuid(),
  counts: z
    .array(
      z.object({
        productId: z.uuid(),
        /** null clears a count */
        countedQty: quantity.nullable(),
        reason: z.string().trim().max(300).optional(),
      })
    )
    .min(1)
    .max(500),
});

export const stocktakeIdSchema = z.object({ stocktakeId: z.uuid() });

export const approveStocktakeSchema = z.object({
  stocktakeId: z.uuid(),
  /** product id -> how to settle a line whose stock moved during the count */
  resolutions: z.record(z.uuid(), z.enum(["use_count", "keep_current"])).default({}),
});

export type CreateStocktakeInput = z.infer<typeof createStocktakeSchema>;
