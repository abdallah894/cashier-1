import { z } from "zod";

export const requestPrintSchema = z.object({
  documentType: z.enum(["sale_receipt", "return_receipt", "z_report"]),
  documentId: z.uuid(),
  kind: z.enum(["original", "reprint", "gift"]),
  reason: z.string().trim().max(300).optional(),
});

export const completePrintSchema = z.object({
  jobId: z.uuid(),
  ok: z.boolean(),
  error: z.string().trim().max(300).optional(),
  deviceId: z.uuid().optional(),
});

export const authorizeDrawerSchema = z.object({
  reason: z.enum(["cash_sale", "cash_refund", "cash_drawer_event", "no_sale"]),
  referenceId: z.uuid().optional(),
  note: z.string().trim().max(300).optional(),
  approvalId: z.uuid().optional(),
  /** manager PIN for a manual no-sale opening by someone without the capability */
  managerPin: z.string().regex(/^\d{4}$/).optional(),
});

export const completeDrawerSchema = z.object({
  openingId: z.uuid(),
  ok: z.boolean(),
  error: z.string().trim().max(300).optional(),
  deviceId: z.uuid().optional(),
});

export const saveDeviceSchema = z.object({
  id: z.uuid().optional(),
  tillId: z.uuid(),
  kind: z.enum(["printer", "scanner", "cash_drawer"]),
  name: z.string().trim().min(1).max(80),
  profile: z.string().trim().min(1).max(60),
  active: z.boolean().default(true),
  settings: z
    .object({
      vendorId: z.number().int().min(0).max(0xffff).optional(),
      productId: z.number().int().min(0).max(0xffff).optional(),
      columns: z.number().int().min(24).max(64).optional(),
    })
    .default({}),
});

export const reportHealthSchema = z.object({
  deviceId: z.uuid(),
  health: z.enum(["ok", "degraded", "offline"]),
  detail: z.string().trim().max(300).optional(),
});
