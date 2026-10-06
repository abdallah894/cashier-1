"use server";

import { revalidatePath } from "next/cache";
import { routing } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import { closeDaySchema, handleAlertSchema, productSupplierSchema, storeSettingsSchema } from "@/lib/validation/ops";
import type { ActionResult } from "./result";
import { requireAdminAction } from "./guard";

function opsError(message: string): string {
  if (message.includes("admin only") || message.includes("capability required")) return "notAuthorized";
  if (message.includes("has not ended")) return "dayNotEnded";
  if (message.includes("shifts are still open")) return "dayShiftsOpen";
  if (message.includes("already closed")) return "dayAlreadyClosed";
  if (message.includes("unknown timezone")) return "timezoneInvalid";
  if (message.includes("note is required")) return "reorderNoteRequired";
  if (message.includes("choose an order")) return "reorderChooseOrder";
  if (message.includes("already resolved")) return "reorderResolved";
  return "opsFailed";
}

function revalidate() {
  for (const locale of routing.locales) {
    revalidatePath(`/${locale}/reports`, "layout");
    revalidatePath(`/${locale}/stock-alerts`);
  }
}

export async function closeBusinessDay(input: unknown): Promise<ActionResult> {
  const denied = await requireAdminAction();
  if (denied) return denied;
  const parsed = closeDaySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalidInput" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("close_business_day", { p_day: parsed.data.day });
  if (error) return { ok: false, error: opsError(error.message) };
  revalidate();
  return { ok: true, data: undefined };
}

export async function updateStoreSettings(input: unknown): Promise<ActionResult> {
  const denied = await requireAdminAction();
  if (denied) return denied;
  const parsed = storeSettingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalidInput" };
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_store_settings", {
    p: {
      ...(v.timezone === undefined ? {} : { timezone: v.timezone }),
      ...(v.businessDayCutoffMinutes === undefined ? {} : { business_day_cutoff_minutes: v.businessDayCutoffMinutes }),
      ...(v.reorderCoverDays === undefined ? {} : { reorder_cover_days: v.reorderCoverDays }),
      ...(v.reorderLookbackDays === undefined ? {} : { reorder_lookback_days: v.reorderLookbackDays }),
      ...(v.defaultLeadTimeDays === undefined ? {} : { default_lead_time_days: v.defaultLeadTimeDays }),
      ...(v.storeNameAr === undefined ? {} : { store_name_ar: v.storeNameAr }),
      ...(v.storeNameEn === undefined ? {} : { store_name_en: v.storeNameEn }),
      ...(v.addressAr === undefined ? {} : { address_ar: v.addressAr }),
      ...(v.addressEn === undefined ? {} : { address_en: v.addressEn }),
      ...(v.phone === undefined ? {} : { phone: v.phone }),
      ...(v.taxRegistrationNumber === undefined ? {} : { tax_registration_number: v.taxRegistrationNumber }),
      ...(v.receiptFooterAr === undefined ? {} : { receipt_footer_ar: v.receiptFooterAr }),
      ...(v.receiptFooterEn === undefined ? {} : { receipt_footer_en: v.receiptFooterEn }),
      ...(v.weighedBarcodeEnabled === undefined ? {} : { weighed_barcode_enabled: v.weighedBarcodeEnabled }),
      ...(v.weighedPrefixMin === undefined ? {} : { weighed_prefix_min: v.weighedPrefixMin }),
      ...(v.weighedPrefixMax === undefined ? {} : { weighed_prefix_max: v.weighedPrefixMax }),
      ...(v.weighedItemCodeLength === undefined ? {} : { weighed_item_code_length: v.weighedItemCodeLength }),
      ...(v.weighedValueKind === undefined ? {} : { weighed_value_kind: v.weighedValueKind }),
    },
  });
  if (error) return { ok: false, error: opsError(error.message) };
  revalidate();
  return { ok: true, data: undefined };
}

export async function handleReorderAlert(input: unknown): Promise<ActionResult> {
  const parsed = handleAlertSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalidInput" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("handle_reorder_alert", {
    p_id: parsed.data.alertId,
    p_action: parsed.data.action,
    p_note: parsed.data.note,
    p_po_id: parsed.data.poId,
  });
  if (error) return { ok: false, error: opsError(error.message) };
  revalidate();
  return { ok: true, data: undefined };
}

export async function setProductSupplier(input: unknown): Promise<ActionResult> {
  const denied = await requireAdminAction();
  if (denied) return denied;
  const parsed = productSupplierSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalidInput" };
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_product_supplier", {
    p: {
      product_id: v.productId,
      supplier_id: v.supplierId,
      is_preferred: v.isPreferred,
      supplier_sku: v.supplierSku ?? null,
      lead_time_days: v.leadTimeDays ?? null,
      pack_size: v.packSize,
      min_order_qty: v.minOrderQty,
      unit_cost: v.unitCost ?? null,
    },
  });
  if (error) return { ok: false, error: opsError(error.message) };
  revalidate();
  return { ok: true, data: undefined };
}
