import { NextResponse } from "next/server";
import { log } from "@/lib/observability/log";
import { sortAlerts, type OpsAlert } from "@/lib/ops/alerts";
import { verifyBearer } from "@/lib/ops/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { limitByIp } from "@/lib/ops/rate-limit";

// Active operational alerts for an external monitor (UptimeRobot, Better
// Stack...). Requires `Authorization: Bearer $OPS_API_TOKEN`. Answers 200
// with an empty list when healthy and 200 with alerts otherwise; monitors
// should alert on a non-empty `alerts` array or on any non-200.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // before the secret check, so guessing the token is rate limited too
  const limited = await limitByIp(request, "ops", 30, 60);
  if (limited) return limited;
  if (!verifyBearer(request.headers.get("authorization"), process.env.OPS_API_TOKEN)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("ops_alerts");
  if (error) {
    log.error("ops_alerts_failed", { reason: error.message });
    return NextResponse.json({ error: "alert evaluation failed" }, { status: 500 });
  }
  const alerts = sortAlerts((data ?? []) as OpsAlert[]);
  return NextResponse.json({ ok: alerts.length === 0, alerts }, { headers: { "cache-control": "no-store" } });
}
