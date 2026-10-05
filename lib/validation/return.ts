import { z } from "zod";

const quantity = z
  .number()
  .positive()
  .refine((value) => Math.round(value * 1000) === value * 1000, {
    message: "Quantity may have at most three decimal places.",
  });

export const returnInputSchema = z.object({
  saleId: z.uuid(),
  items: z.array(z.object({ saleItemId: z.uuid(), qty: quantity })).min(1),
  refundTender: z.enum(["cash", "card"]),
  reason: z.string().trim().min(1).max(500),
  restock: z.boolean(),
  approvalId: z.uuid().optional(),
});

export type ReturnInput = z.infer<typeof returnInputSchema>;
