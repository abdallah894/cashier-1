/**
 * Turns the database's alert rules (ops_alerts) into notifications.
 * Pure orchestration with injected I/O so it is unit-tested: the route
 * wires the service-role client and the real fetch.
 *
 * Notification policy: an alert is sent to the webhook at most once per
 * DEDUPE_MINUTES while it stays active; if the webhook call fails the alert
 * is NOT marked as sent, so the next poll retries it.
 */
export type AlertSeverity = "info" | "warning" | "critical";

export type OpsAlert = {
  alert: string;
  severity: AlertSeverity;
  detail: string;
  since: string | null;
};

export const DEDUPE_MINUTES = 60;

const ORDER: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };

export function sortAlerts(alerts: OpsAlert[]): OpsAlert[] {
  return [...alerts].sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || a.alert.localeCompare(b.alert));
}

/** Slack/Teams-compatible text plus the raw alerts for programmatic consumers. */
export function formatAlertPayload(alerts: OpsAlert[], storeName = "Cachier POS") {
  const lines = sortAlerts(alerts).map((a) => `[${a.severity.toUpperCase()}] ${a.alert}: ${a.detail}`);
  return { text: `${storeName}: ${alerts.length} active alert(s)\n${lines.join("\n")}`, alerts: sortAlerts(alerts) };
}

export type DispatchDeps = {
  webhookUrl: string | undefined;
  /** alert keys already notified within the dedupe window */
  recentlySent: ReadonlySet<string>;
  fetchImpl: typeof fetch;
  timeoutMs?: number;
};

export type DispatchResult = {
  /** alerts delivered in this run */
  sent: string[];
  /** active alerts not re-sent because they were notified recently */
  deduped: string[];
  delivered: boolean;
  error?: string;
};

export async function dispatchAlerts(alerts: OpsAlert[], deps: DispatchDeps): Promise<DispatchResult> {
  const fresh = alerts.filter((a) => !deps.recentlySent.has(a.alert));
  const deduped = alerts.filter((a) => deps.recentlySent.has(a.alert)).map((a) => a.alert);
  if (fresh.length === 0) return { sent: [], deduped, delivered: false };
  if (!deps.webhookUrl) return { sent: [], deduped, delivered: false, error: "ALERT_WEBHOOK_URL is not configured" };

  try {
    const response = await deps.fetchImpl(deps.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(formatAlertPayload(fresh)),
      signal: AbortSignal.timeout(deps.timeoutMs ?? 8000),
    });
    if (!response.ok) return { sent: [], deduped, delivered: false, error: `webhook answered HTTP ${response.status}` };
    return { sent: fresh.map((a) => a.alert), deduped, delivered: true };
  } catch (error) {
    return { sent: [], deduped, delivered: false, error: error instanceof Error ? error.message : "webhook failed" };
  }
}
