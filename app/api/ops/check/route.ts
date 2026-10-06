import { NextResponse } from "next/server";
import { log } from "@/lib/observability/log";
import { dispatchAlerts, DEDUPE_MINUTES, type OpsAlert } from "@/lib/ops/alerts";
import { verifyBearer } from "@/lib/ops/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { limitByIp } from "@/lib/ops/rate-limit";

// Cron entry point (vercel.json): evaluates the alert rules and pushes new
// alerts to ALERT_WEBHOOK_URL. Vercel Cron authenticates with
// `Authorization: Bearer $CRON_SECRET`.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // before the secret check, so guessing the token is rate limited too
  const limited = await limitByIp(request, "ops", 30, 60);
  if (limited) return limited;
  if (!verifyBearer(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("ops_alerts");
  if (error) {
    log.error("ops_check_failed", { reason: error.message });
    return NextResponse.json({ error: "alert evaluation failed" }, { status: 500 });
  }
  const alerts = (data ?? []) as OpsAlert[];
  if (alerts.length === 0) return NextResponse.json({ ok: true, alerts: 0 });

  const since = new Date(Date.now() - DEDUPE_MINUTES * 60_000).toISOString();
  const { data: recent } = await admin.from("ops_events").select("detail").eq("kind", "alert_sent").gte("created_at", since);
  const recentlySent = new Set((recent ?? []).map((row) => String((row.detail as { alert?: string } | null)?.alert ?? "")));

  const result = await dispatchAlerts(alerts, {
    webhookUrl: process.env.ALERT_WEBHOOK_URL,
    recentlySent,
    fetchImpl: fetch,
  });
  for (const key of result.sent) {
    await admin.rpc("record_ops_event", { p_kind: "alert_sent", p_severity: "info", p_detail: { alert: key } });
  }
  if (result.error) log.error("alert_dispatch_failed", { reason: result.error, alerts: alerts.map((a) => a.alert) });
  else log.info("alerts_dispatched", { sent: result.sent, deduped: result.deduped });
  return NextResponse.json({ ok: false, alerts: alerts.length, sent: result.sent, deduped: result.deduped, delivered: result.delivered, error: result.error ?? null });
}
