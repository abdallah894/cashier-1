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
  if (message.includes("insufficient stock")) return "insufficientStock";
  if (message.includes("tendered")) return "tenderedTooLow";
  if (message.includes("not found or inactive")) return "productUnavailable";
  if (message.includes("whole number")) return "wholeNumberRequired";
  if (message.includes("no cashier")) return "notAuthorized";
  if (message.includes("no open shift")) return "noOpenShift";
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
  const { data: shift, error: shiftError } = await supabase
    .from("shifts")
    .select("id")
    .eq("cashier_id", user.id)
    .is("closed_at", null)
    .maybeSingle();
  if (shiftError) return { ok: false, error: "checkoutFailed" };
  if (!shift) return { ok: false, error: "noOpenShift" };

  // ONE transaction server-side: sale + snapshot items + stock + movements.
  const { data, error } = await supabase.rpc("create_sale", {
    p_items: parsed.data.items,
    p_payment_method: parsed.data.payment_method,
    p_shift_id: shift.id,
    p_amount_tendered:
      parsed.data.payment_method === "cash" ? (parsed.data.amount_tendered ?? undefined) : undefined,
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
