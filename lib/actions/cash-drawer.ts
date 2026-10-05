"use server";

import { revalidatePath } from "next/cache";
import { routing } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import { cashDrawerEventSchema } from "@/lib/validation/cash-drawer";
import type { ActionResult } from "./result";

export async function recordCashDrawerEvent(input: unknown): Promise<ActionResult> {
  const parsed = cashDrawerEventSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalidInput" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_cash_drawer_event", {
    p_shift_id: parsed.data.shiftId,
    p_type: parsed.data.type,
    p_amount: parsed.data.amount,
    p_reason: parsed.data.reason,
  });
  if (error) return { ok: false, error: error.message.includes("not your shift") ? "notAuthorized" : "unknown" };
  for (const locale of routing.locales) {
    revalidatePath(`/${locale}/shifts`);
    revalidatePath(`/${locale}/shifts/${parsed.data.shiftId}`);
  }
  return { ok: true, data: undefined };
}
