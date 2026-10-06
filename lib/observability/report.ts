import "server-only";
import { redactString } from "./log";

/**
 * Posts one line to ERROR_WEBHOOK_URL (Slack/Teams/any JSON receiver) when it
 * is configured. Never throws: reporting an error must not become another one.
 * The text is redacted first (no tokens, emails or card-like numbers).
 */
export async function forwardToErrorWebhook(text: string): Promise<void> {
  const url = process.env.ERROR_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: redactString(text) }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // swallowed on purpose
  }
}
