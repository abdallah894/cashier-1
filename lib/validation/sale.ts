import { z } from "zod";

export const saleItemSchema = z.object({
  product_id: z.uuid(),
  qty: z.number().positive().max(9_999_999),
  line_discount: z.number().int().min(0),
});

export const checkoutSchema = z
  .object({
    items: z.array(saleItemSchema).min(1).max(200),
    payment_method: z.enum(["cash", "card"]),
    amount_tendered: z.number().int().min(0).nullable(),
    approvalId: z.uuid().optional(),
  })
  .refine((v) => v.payment_method !== "cash" || v.amount_tendered !== null, {
    message: "tenderedRequired",
  });

export type CheckoutInput = z.infer<typeof checkoutSchema>;
