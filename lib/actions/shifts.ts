"use server";

import { revalidatePath } from "next/cache";
import { routing } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import { log } from "@/lib/observability/log";
import { recordOpsEvent } from "@/lib/ops/events";
import { createHash } from "node:crypto";
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
  let { error } = await supabase.rpc("close_shift", {
    p_shift_id: parsed.data.shiftId,
    p_counted: parsed.data.counted,
    p_approval_id: parsed.data.approvalId ?? null,
  });
  if (error?.message.includes("manager approval") && parsed.data.managerPin) {
    const [{ data: shift }, { data: events }] = await Promise.all([
      supabase.from("shifts").select("opening_float").eq("id", parsed.data.shiftId).single(),
      supabase.from("cash_drawer_events").select("amount").eq("shift_id", parsed.data.shiftId),
    ]);
    const expected = Number(shift?.opening_float ?? 0) + (events ?? []).reduce((total, event) => total + Number(event.amount), 0);
    const requestHash = createHash("sha256")
      .update(`shift_close|${parsed.data.shiftId}|${parsed.data.counted}|${expected}`)
      .digest("hex");
    const approval = await supabase.rpc("create_manager_approval", {
      p_action: "shift_close", p_request_hash: requestHash, p_pin: parsed.data.managerPin,
    });
    if (!approval.error && approval.data) {
      ({ error } = await supabase.rpc("close_shift", {
        p_shift_id: parsed.data.shiftId, p_counted: parsed.data.counted, p_approval_id: approval.data,
      }));
    }
  }
  if (error) {
    if (error.message.includes("not your shift")) return { ok: false, error: "notAuthorized" };
    if (error.message.includes("manager approval")) {
      return { ok: false, error: "managerApprovalRequired" };
    }
    log.error("shift_close_failed", { code: error.code, message: error.message });
    await recordOpsEvent("rpc_failed", { rpc: "close_shift", code: error.code ?? "unknown" });
    return { ok: false, error: "shiftCloseFailed" };
  }

  revalidateShiftPages();
  return { ok: true, data: { shiftId: parsed.data.shiftId } };
}
