"use server";

import { createClient } from "@/lib/supabase/server";
import { managerApprovalSchema } from "@/lib/validation/approval";
import type { ActionResult } from "./result";

export async function createManagerApproval(input: unknown): Promise<ActionResult<{ approvalId: string }>> {
  const parsed = managerApprovalSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalidInput" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_manager_approval", {
    p_action: parsed.data.action,
    p_request_hash: parsed.data.requestHash,
    p_pin: parsed.data.pin,
  });
  if (error || !data) return { ok: false, error: "managerApprovalRequired" };
  return { ok: true, data: { approvalId: data } };
}
