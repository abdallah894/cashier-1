import { NextResponse } from "next/server";
import { log } from "@/lib/observability/log";
import { clientIp, memoryRateLimit } from "@/lib/ops/rate-limit-core";

// Receives browser CSP violation reports (report-only rollout). Public by
// necessity (browsers send it without credentials), so it is tiny, bounded,
// rate limited per IP, and only ever logs a short summary.
export const dynamic = "force-dynamic";

const MAX_BYTES = 8_192;
const clip = (value: unknown, n = 200) => (typeof value === "string" ? value.slice(0, n) : undefined);

export async function POST(request: Request) {
  if (!memoryRateLimit(`csp:${clientIp(request)}`, 30, 60_000).allowed) return new NextResponse(null, { status: 429 });
  const text = await request.text().catch(() => "");
  if (text.length === 0 || text.length > MAX_BYTES) return new NextResponse(null, { status: 204 });
  try {
    const body = JSON.parse(text) as Record<string, unknown>;
    // legacy shape {"csp-report": {...}}; the Reporting API sends an array of {body: {...}}
    const report = (body["csp-report"] ?? (Array.isArray(body) ? (body[0] as { body?: unknown })?.body : body)) as Record<string, unknown> | undefined;
    if (report) {
      log.warn("csp_violation", {
        directive: clip(report["violated-directive"] ?? report["effectiveDirective"]),
        blocked: clip(report["blocked-uri"] ?? report["blockedURL"]),
        page: clip(report["document-uri"] ?? report["documentURL"]),
        source: clip(report["source-file"] ?? report["sourceFile"]),
        line: typeof report["line-number"] === "number" ? report["line-number"] : undefined,
      });
    }
  } catch {
    // not JSON: ignore
  }
  return new NextResponse(null, { status: 204 });
}
