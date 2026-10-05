import { dispatchAlerts, formatAlertPayload, sortAlerts, type OpsAlert } from "../lib/ops/alerts";
import { verifyBearer } from "../lib/ops/auth";

let failures = 0;
function check(name: string, condition: boolean, detail = "") {
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!condition) failures++;
}

const alerts: OpsAlert[] = [
  { alert: "sync_backlog", severity: "warning", detail: "1 till has unsynced sales", since: null },
  { alert: "backup_overdue", severity: "critical", detail: "no backup in 26 hours", since: null },
];

function fakeFetch(status = 200, fail = false) {
  const calls: { url: string; body: { text: string; alerts: OpsAlert[] } }[] = [];
  const impl = (async (url: string, init?: RequestInit) => {
    if (fail) throw new Error("network down");
    calls.push({ url, body: JSON.parse(String(init?.body)) });
    return new Response("{}", { status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

async function main() {
  check("critical alerts sort first", sortAlerts(alerts)[0].alert === "backup_overdue");
  const payload = formatAlertPayload(alerts, "Test Store");
  check("the message lists severity and detail", payload.text.includes("[CRITICAL] backup_overdue: no backup in 26 hours") && payload.text.startsWith("Test Store: 2 active alert(s)"));

  {
    const f = fakeFetch();
    const r = await dispatchAlerts(alerts, { webhookUrl: "https://hooks.example/x", recentlySent: new Set(), fetchImpl: f.impl });
    check("new alerts are delivered once, in one message", r.delivered && r.sent.length === 2 && f.calls.length === 1 && f.calls[0].body.alerts.length === 2);
  }
  {
    const f = fakeFetch();
    const r = await dispatchAlerts(alerts, { webhookUrl: "https://hooks.example/x", recentlySent: new Set(["backup_overdue"]), fetchImpl: f.impl });
    check("an alert already notified recently is not re-sent", r.sent.join() === "sync_backlog" && r.deduped.join() === "backup_overdue");
  }
  {
    const f = fakeFetch();
    const r = await dispatchAlerts(alerts, { webhookUrl: "https://hooks.example/x", recentlySent: new Set(["backup_overdue", "sync_backlog"]), fetchImpl: f.impl });
    check("nothing is sent when every alert was already notified", !r.delivered && f.calls.length === 0 && r.deduped.length === 2);
  }
  {
    const f = fakeFetch(500);
    const r = await dispatchAlerts(alerts, { webhookUrl: "https://hooks.example/x", recentlySent: new Set(), fetchImpl: f.impl });
    check("a webhook error is reported and nothing is marked as sent", !r.delivered && r.sent.length === 0 && (r.error ?? "").includes("500"));
  }
  {
    const f = fakeFetch(200, true);
    const r = await dispatchAlerts(alerts, { webhookUrl: "https://hooks.example/x", recentlySent: new Set(), fetchImpl: f.impl });
    check("a network failure never throws and is retried next poll", !r.delivered && r.sent.length === 0 && r.error === "network down");
  }
  {
    const f = fakeFetch();
    const r = await dispatchAlerts(alerts, { webhookUrl: undefined, recentlySent: new Set(), fetchImpl: f.impl });
    check("without a webhook the alerts stay unsent and the gap is explained", !r.delivered && f.calls.length === 0 && (r.error ?? "").includes("ALERT_WEBHOOK_URL"));
  }
  {
    const r = await dispatchAlerts([], { webhookUrl: "https://hooks.example/x", recentlySent: new Set(), fetchImpl: fakeFetch().impl });
    check("no alerts means no notification", !r.delivered && r.sent.length === 0);
  }

  const secret = "a-sufficiently-long-secret-123";
  check("the correct bearer token is accepted", verifyBearer(`Bearer ${secret}`, secret));
  check("a wrong token is rejected", !verifyBearer("Bearer nope-nope-nope-nope-nope", secret));
  check("a missing header is rejected", !verifyBearer(null, secret));
  check("a non-bearer scheme is rejected", !verifyBearer(`Basic ${secret}`, secret));
  check("an unset secret never authorises (fail closed)", !verifyBearer("Bearer anything-anything-1234", undefined) && !verifyBearer("Bearer ", ""));
  check("a short secret is refused even if it matches", !verifyBearer("Bearer short", "short"));

  if (failures > 0) process.exit(1);
  console.log("Ops alert dispatch and auth pass.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
