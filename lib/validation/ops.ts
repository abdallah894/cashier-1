import { z } from "zod";

const day = z.iso.date();

export const closeDaySchema = z.object({ day });

export const storeSettingsSchema = z.object({
  timezone: z.string().trim().min(1).max(64).optional(),
  businessDayCutoffMinutes: z.number().int().min(0).max(1439).optional(),
  reorderCoverDays: z.number().int().min(1).max(365).optional(),
  reorderLookbackDays: z.number().int().min(7).max(365).optional(),
  defaultLeadTimeDays: z.number().int().min(0).max(120).optional(),
});

export const handleAlertSchema = z.object({
  alertId: z.uuid(),
  action: z.enum(["acknowledge", "dismiss", "ordered"]),
  note: z.string().trim().max(300).optional(),
  poId: z.uuid().optional(),
});

export const productSupplierSchema = z.object({
  productId: z.uuid(),
  supplierId: z.uuid(),
  isPreferred: z.boolean().default(false),
  supplierSku: z.string().trim().max(60).optional(),
  leadTimeDays: z.number().int().min(0).max(120).optional(),
  packSize: z.number().positive().max(100_000).default(1),
  minOrderQty: z.number().min(0).max(1_000_000).default(0),
  unitCost: z.number().int().min(0).max(1_000_000_000).optional(),
});
