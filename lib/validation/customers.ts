import { z } from "zod";

export const findCustomerSchema = z.object({ phone: z.string().trim().min(8).max(25) });

export const createCustomerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().min(8).max(25),
  email: z.union([z.literal(""), z.email()]).optional().transform((value) => (value ? value : undefined)),
  /** explicit opt-in; never defaulted to true */
  marketingConsent: z.boolean().default(false),
});

export const customerConsentSchema = z.object({
  customerId: z.uuid(),
  consent: z.boolean(),
  source: z.enum(["register", "admin"]).default("register"),
});

export const customerIdSchema = z.object({ customerId: z.uuid() });
