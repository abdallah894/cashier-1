"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { log } from "@/lib/observability/log";
import { forwardToErrorWebhook } from "@/lib/observability/report";
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

const clientErrorSchema = z.object({
  message: z.string().trim().max(200),
  digest: z.string().trim().max(64).optional(),
  path: z.string().trim().max(200).optional(),
});

/**
 * A page crashed in a cashier's browser (the error boundary shows "something
 * went wrong"). Without this the owner would never hear about it. Signed-in
 * staff only, 10 reports a minute each, and only a short redacted summary is
 * logged and forwarded.
 */
export async function reportClientError(input: unknown): Promise<ActionResult> {
  const parsed = clientErrorSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalidInput" };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "notAuthorized" };
  const { data } = await supabase.rpc("consume_rate_limit", { p_scope: "client-error", p_limit: 10, p_window_seconds: 60 });
  if (data?.[0] && !data[0].allowed) return { ok: false, error: "rateLimited" };

  log.error("client_render_error", { message: parsed.data.message, digest: parsed.data.digest, path: parsed.data.path, userId: user.id });
  await forwardToErrorWebhook(`Cachier POS page crashed in a browser (${parsed.data.path ?? "unknown page"}): ${parsed.data.message}${parsed.data.digest ? ` [${parsed.data.digest}]` : ""}`);
  return { ok: true, data: undefined };
}
