"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "./result";

const voidCartSchema = z.object({
  itemCount: z.number().int().positive().max(1000),
  value: z.number().int().min(0),
  approvalId: z.uuid().optional(),
});

/**
 * Records that a non-empty cart was abandoned. Only the audit trail is
 * written — a cart has no database row — and the RPC decides whether the
 * caller may void on their own authority or needs a manager approval.
 */
export async function voidCart(input: unknown): Promise<ActionResult> {
  const parsed = voidCartSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalidInput" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "notAuthorized" };

  const { error } = await supabase.rpc("record_cart_void", {
    p_item_count: parsed.data.itemCount,
    p_value: parsed.data.value,
    p_approval_id: parsed.data.approvalId,
  });
  if (error) {
    if (error.message.includes("approval")) return { ok: false, error: "managerApprovalRequired" };
    if (error.message.includes("no open shift")) return { ok: false, error: "noOpenShift" };
    return { ok: false, error: "unknown" };
  }
  return { ok: true, data: undefined };
}
