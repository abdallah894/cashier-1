"use server";

import { revalidatePath } from "next/cache";
import { routing } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import { returnInputSchema } from "@/lib/validation/return";
import type { ActionResult } from "@/lib/actions/result";

function returnError(message: string) {
  if (message.includes("not authenticated") || message.includes("not your sale")) {
    return "notAuthorized";
  }
  if (message.includes("manager approval")) return "managerApprovalRequired";
  if (message.includes("return quantity") || message.includes("refund tender")) return "invalidReturn";
  return "returnFailed";
}

export async function submitReturn(
  input: unknown
): Promise<ActionResult<{ returnId: string; returnNumber: number }>> {
  const parsed = returnInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalidInput" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "notAuthorized" };

  const { data, error } = await supabase.rpc("create_return", {
    p_sale_id: parsed.data.saleId,
    p_items: parsed.data.items.map((item) => ({ sale_item_id: item.saleItemId, qty: item.qty })),
    p_refund_tender: parsed.data.refundTender,
    p_reason: parsed.data.reason,
    p_restock: parsed.data.restock,
    p_approval_id: parsed.data.approvalId ?? null,
  });
  if (error || !data?.[0]) return { ok: false, error: returnError(error?.message ?? "") };

  for (const locale of routing.locales) {
    revalidatePath(`/${locale}/receipts/${parsed.data.saleId}`);
  }
  return { ok: true, data: { returnId: data[0].return_id, returnNumber: data[0].return_number } };
}
