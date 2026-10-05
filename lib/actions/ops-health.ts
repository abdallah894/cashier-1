"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "./result";

const schema = z.object({
  queued: z.number().int().min(0).max(100_000),
  rejected: z.number().int().min(0).max(100_000),
  oldestAgeSeconds: z.number().int().min(0).max(31_536_000),
});

/** A till reports the state of its offline queue so a stuck backlog raises an alert. */
export async function reportSyncBacklog(input: unknown): Promise<ActionResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalidInput" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("report_client_health", {
    p_queued: parsed.data.queued,
    p_rejected: parsed.data.rejected,
    p_oldest_age_seconds: parsed.data.oldestAgeSeconds,
  });
  return error ? { ok: false, error: "unknown" } : { ok: true, data: undefined };
}
