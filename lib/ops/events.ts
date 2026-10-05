import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { log } from "@/lib/observability/log";

export type OpsEventKind = "checkout_failed" | "rpc_failed" | "ai_provider_down";

/**
 * Records a system failure for the alert rules. Best-effort by design: a
 * failure to record must never turn into a failed checkout, so every error
 * is swallowed (and logged). `detail` is for codes and counts, never secrets;
 * the database rejects sensitive-looking keys anyway.
 */
export async function recordOpsEvent(
  kind: OpsEventKind,
  detail: Record<string, string | number | boolean | null> = {},
  severity: "info" | "warning" | "critical" = "warning"
): Promise<void> {
  try {
    const admin = createAdminClient();
    const { error } = await admin.rpc("record_ops_event", { p_kind: kind, p_severity: severity, p_detail: detail });
    if (error) log.warn("ops_event_not_recorded", { kind, reason: error.message });
  } catch (error) {
    log.warn("ops_event_not_recorded", { kind, reason: error instanceof Error ? error.message : "unknown" });
  }
}
