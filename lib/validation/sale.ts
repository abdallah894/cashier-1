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
    /** Optional loyalty-free customer link (privacy: lookup is by exact phone only). */
    customerId: z.uuid().optional(),
    promotionCodes: z.array(z.string().trim().min(1).max(40)).max(5).optional(),
    /** false for queued offline sales: promotions need the server's live rules. */
    applyPromotions: z.boolean().optional(),
    /** the total the cashier and customer saw; the server refuses if it moved */
    expectedTotal: z.number().int().min(0).optional(),
    /** Client-generated; makes a retried or queued sale idempotent. */
    idempotencyKey: z.uuid().optional(),
    /** Shift the sale was rung in (queued sales sync later). Defaults to the open shift. */
    shiftId: z.uuid().optional(),
    /** When the till rang the sale (ISO); the server bounds it. */
    soldAt: z.iso.datetime().optional(),
  })
  .refine((v) => v.payment_method !== "cash" || v.amount_tendered !== null, {
    message: "tenderedRequired",
  });

export type CheckoutInput = z.infer<typeof checkoutSchema>;
