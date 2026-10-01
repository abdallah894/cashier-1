import { z } from "zod";

export const cashDrawerEventSchema = z.object({
  shiftId: z.uuid(),
  type: z.enum(["paid_in", "paid_out", "safe_drop"]),
  amount: z.number().int().positive().max(100_000_000),
  reason: z.string().trim().min(1).max(500),
});

export type CashDrawerEventInput = z.infer<typeof cashDrawerEventSchema>;
