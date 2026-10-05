import { z } from "zod";
import { isValidPaymentReference } from "@/lib/payments/providers";

/** Terminal approval code / RRN. Card-number-shaped values are rejected on purpose. */
export const paymentReferenceSchema = z
  .string()
  .trim()
  .refine(isValidPaymentReference, { message: "paymentReferenceInvalid" });

export const confirmPaymentSchema = z.object({
  paymentId: z.uuid(),
  reference: paymentReferenceSchema.optional(),
});

export const failPaymentSchema = z.object({
  paymentId: z.uuid(),
  status: z.enum(["declined", "failed", "voided"]),
  note: z.string().trim().min(1).max(300),
});

export const resolvePaymentSchema = z.object({
  paymentId: z.uuid(),
  note: z.string().trim().min(1).max(500),
});
