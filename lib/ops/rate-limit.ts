import { NextResponse } from "next/server";
import { log } from "@/lib/observability/log";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientIp, ipRateLimitKey } from "./rate-limit-core";

/**
 * Database-backed limit shared by every server instance, for token-protected
 * machine routes. Returns a 429 response when the caller is over the limit,
 * otherwise null. If the limiter itself fails it fails OPEN (logged): a
 * database hiccup must not stop the cron or payment callbacks — those routes
 * still require their own secret.
 */
export async function limitByIp(request: Request, scope: string, limit: number, windowSeconds: number): Promise<NextResponse | null> {
  try {
    const { data, error } = await createAdminClient().rpc("consume_ip_rate_limit", {
      p_key: ipRateLimitKey(scope, clientIp(request)),
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
    if (error) {
      log.warn("ip_rate_limit_unavailable", { scope, reason: error.message });
      return null;
    }
    const row = data?.[0];
    if (row && !row.allowed) {
      const retry = Math.max(1, Number(row.retry_after_seconds));
      return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "retry-after": String(retry), "cache-control": "no-store" } });
    }
  } catch (error) {
    log.warn("ip_rate_limit_unavailable", { scope, reason: error instanceof Error ? error.message : "unknown" });
  }
  return null;
}
