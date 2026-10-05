import { z } from "zod";

export const pinSchema = z.string().regex(/^\d{4}$/);

export const switchCashierSchema = z.object({
  targetUserId: z.uuid(),
  pin: pinSchema,
});

export const createStaffSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8).max(72),
  fullName: z.string().trim().min(1).max(120),
  role: z.enum(["admin", "cashier"]),
  pin: pinSchema.optional().or(z.literal("").transform(() => undefined)),
});

export const setStaffPinSchema = z.object({
  userId: z.uuid(),
  pin: pinSchema,
});

export const setStaffRoleSchema = z.object({
  userId: z.uuid(),
  role: z.enum(["admin", "cashier"]),
});

export const toggleStaffActiveSchema = z.object({
  userId: z.uuid(),
  active: z.boolean(),
});

export const setStaffCapabilitiesSchema = z.object({
  userId: z.uuid(),
  capabilities: z.array(z.enum([
    "return.approve", "cart.void", "discount.override", "stock.correct", "cash.drawer.adjust", "shift.close.override",
  ])).max(6),
});
