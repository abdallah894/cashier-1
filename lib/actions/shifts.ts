"use server";

import { revalidatePath } from "next/cache";
import { routing } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import { openShiftSchema, closeShiftSchema } from "@/lib/validation/shift";
import type { ActionResult } from "./result";

function revalidateShiftPages() {
  for (const locale of routing.locales) {
    revalidatePath(`/${locale}/shifts`);
    revalidatePath(`/${locale}/register`);
  }
}

export async function openShift(input: unknown): Promise<ActionResult<{ shiftId: string }>> {
  const parsed = openShiftSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalidInput" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "notAuthorized" };

  const { data, error } = await supabase
    .from("shifts")
    .insert({ cashier_id: user.id, opening_float: parsed.data.openingFloat })
    .select("id")
    .single();
  if (error) {
    return { ok: false, error: error.code === "23505" ? "shiftAlreadyOpen" : "unknown" };
  }

  revalidateShiftPages();
  return { ok: true, data: { shiftId: data.id } };
}

export async function closeShift(input: unknown): Promise<ActionResult<{ shiftId: string }>> {
  const parsed = closeShiftSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalidInput" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("close_shift", {
    p_shift_id: parsed.data.shiftId,
    p_counted: parsed.data.counted,
  });
  if (error) {
    if (error.message.includes("not your shift")) return { ok: false, error: "notAuthorized" };
    return { ok: false, error: "shiftCloseFailed" };
  }

  revalidateShiftPages();
  return { ok: true, data: { shiftId: parsed.data.shiftId } };
}
