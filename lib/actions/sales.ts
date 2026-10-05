"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { routing } from "@/i18n/routing";
import { checkoutSchema } from "@/lib/validation/sale";
import type { ActionResult } from "./result";

export type SaleReceipt = {
  saleId: string;
  saleNumber: number;
  subtotal: number;
  taxTotal: number;
  discountTotal: number;
  total: number;
  changeDue: number | null;
};

function mapSaleError(message: string): string {
  if (message.includes("terminal approval reference")) return "paymentReferenceRequired";
  if (message.includes("invalid reference")) return "paymentReferenceInvalid";
  if (message.includes("reference already used")) return "paymentReferenceUsed";
  if (message.includes("total changed")) return "totalChanged";
  if (message.includes("customer not found")) return "customerNotFound";
  if (message.includes("code not valid")) return "promoInvalid";
  if (message.includes("needs a customer")) return "promoNeedsCustomer";
  if (message.includes("minimum spend")) return "promoMinSpend";
  if (message.includes("redemption limit")) return "promoLimit";
  if (message.includes("no eligible items")) return "promoNoItems";
  if (message.includes("manager approval") || message.includes("approval:")) return "managerApprovalRequired";
  if (message.includes("insufficient stock")) return "insufficientStock";
  if (message.includes("tendered")) return "tenderedTooLow";
  if (message.includes("not found or inactive")) return "productUnavailable";
  if (message.includes("whole number")) return "wholeNumberRequired";
  if (message.includes("no cashier")) return "notAuthorized";
  if (message.includes("no open shift")) return "noOpenShift";
  if (message.includes("shift is closed") || message.includes("shift not open")) return "shiftClosed";
  if (message.includes("idempotency key")) return "duplicateSaleKey";
  if (message.includes("sold_at")) return "checkoutFailed";
  return "checkoutFailed";
}

export async function createSale(input: unknown): Promise<ActionResult<SaleReceipt>> {
  const parsed = checkoutSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalidInput" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "notAuthorized" };

  // The sale is recorded against the cashier's own open shift — looked up
  // server-side so the client can neither omit nor forge it. The DB trigger
  // (sales_validate_shift) re-checks ownership + openness transactionally.
  // A queued (offline) sale names the shift it was rung in; it is never
  // silently re-homed to a later shift, because that would misstate the
  // drawer of both shifts.
  let shiftQuery = supabase.from("shifts").select("id, closed_at").eq("cashier_id", user.id);
  shiftQuery = parsed.data.shiftId ? shiftQuery.eq("id", parsed.data.shiftId) : shiftQuery.is("closed_at", null);
  const { data: shift, error: shiftError } = await shiftQuery.maybeSingle();
  if (shiftError) return { ok: false, error: "checkoutFailed" };
  if (!shift) return { ok: false, error: "noOpenShift" };
  // A keyed request may be a replay of a sale already recorded in that shift: the RPC answers that.
  if (shift.closed_at && !parsed.data.idempotencyKey) return { ok: false, error: "shiftClosed" };

  // ONE transaction server-side: sale + snapshot items + stock + movements.
  const { data, error } = await supabase.rpc("create_sale", {
    p_items: parsed.data.items,
    p_payment_method: parsed.data.payment_method,
    p_shift_id: shift.id,
    p_amount_tendered:
      parsed.data.payment_method === "cash" ? (parsed.data.amount_tendered ?? undefined) : undefined,
    p_approval_id: parsed.data.approvalId,
    p_idempotency_key: parsed.data.idempotencyKey,
    p_client_sold_at: parsed.data.soldAt,
    p_customer_id: parsed.data.customerId,
    p_card_reference: parsed.data.payment_method === "card" ? parsed.data.cardReference : undefined,
    p_promotion_codes: parsed.data.promotionCodes,
    p_apply_promotions: parsed.data.applyPromotions,
    p_expected_total: parsed.data.expectedTotal,
  });

  if (error) return { ok: false, error: mapSaleError(error.message) };
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { ok: false, error: "checkoutFailed" };

  // stock changed — refresh cached product pages
  for (const locale of routing.locales) {
    revalidatePath(`/${locale}/products`);
  }

  return {
    ok: true,
    data: {
      saleId: row.sale_id,
      saleNumber: Number(row.sale_number),
      subtotal: Number(row.subtotal),
      taxTotal: Number(row.tax_total),
      discountTotal: Number(row.discount_total),
      total: Number(row.total),
      changeDue: row.change_due === null ? null : Number(row.change_due),
    },
  };
}
