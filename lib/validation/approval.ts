import { z } from "zod";

export const managerApprovalSchema = z.object({
  action: z.enum(["cash_drawer_event", "stock_correction", "return", "sale_discount", "shift_close", "cart_void"]),
  requestHash: z.string().regex(/^[0-9a-f]{64}$/),
  pin: z.string().regex(/^\d{4}$/),
});
