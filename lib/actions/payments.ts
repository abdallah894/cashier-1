"use server";

import { revalidatePath } from "next/cache";
import { routing } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import { confirmPaymentSchema, failPaymentSchema, resolvePaymentSchema } from "@/lib/validation/payments";
import type { ActionResult } from "./result";
import { requireAdminAction } from "./guard";

function paymentError(message: string): string {
  if (message.includes("admin only") || message.includes("not yours")) return "notAuthorized";
  if (message.includes("reference is required")) return "paymentReferenceRequired";
  if (message.includes("invalid reference")) return "paymentReferenceInvalid";
  if (message.includes("reference already used")) return "paymentReferenceUsed";
  if (message.includes("illegal status")) return "paymentWrongState";
  if (message.includes("already resolved")) return "paymentWrongState";
  if (message.includes("note is required")) return "invalidInput";
  return "paymentFailed";
}

function revalidate() {
  for (const locale of routing.locales) revalidatePath(`/${locale}/payments`);
}

/** Staff confirm a terminal charge or refund after seeing it approved on the terminal. */
export async function confirmPayment(input: unknown): Promise<ActionResult> {
  const parsed = confirmPaymentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "paymentReferenceInvalid" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_payment_result", {
    p_payment_id: parsed.data.paymentId,
    p_status: "captured",
    p_reference: parsed.data.reference,
  });
  if (error) return { ok: false, error: paymentError(error.message) };
  revalidate();
  return { ok: true, data: undefined };
}

/** The terminal declined or the attempt was abandoned: record why, so it never looks like a missing payment. */
export async function failPayment(input: unknown): Promise<ActionResult> {
  const parsed = failPaymentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalidInput" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_payment_result", {
    p_payment_id: parsed.data.paymentId,
    p_status: parsed.data.status,
    p_note: parsed.data.note,
  });
  if (error) return { ok: false, error: paymentError(error.message) };
  revalidate();
  return { ok: true, data: undefined };
}

/** Admin closes out an exception (for example an orphan charge refunded on the terminal) with a note. */
export async function resolvePayment(input: unknown): Promise<ActionResult> {
  const denied = await requireAdminAction();
  if (denied) return denied;
  const parsed = resolvePaymentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalidInput" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("resolve_payment", {
    p_payment_id: parsed.data.paymentId,
    p_note: parsed.data.note,
  });
  if (error) return { ok: false, error: paymentError(error.message) };
  revalidate();
  return { ok: true, data: undefined };
}
