import { NextResponse } from "next/server";
import { runAssistant } from "@/lib/ai/assistant";
import { AI_LIMITS, parseAssistantRequest } from "@/lib/ai/guard";
import { providerHealth } from "@/lib/ai/health";
import { createPosExecutors } from "@/lib/ai/pos-data";
import { geminiProvider } from "@/lib/ai/providers/gemini";
import { groqProvider } from "@/lib/ai/providers/groq";
import type { ChatProvider } from "@/lib/ai/types";
import { log } from "@/lib/observability/log";
import { recordOpsEvent } from "@/lib/ops/events";
import { createClient } from "@/lib/supabase/server";

// The advisory POS assistant. Security model:
//  * signed-in, active staff only (the proxy skips /api, so this route checks itself);
//  * per-user rate limits in the database (works across serverless instances);
//  * bounded, plain-text-only request body (no system/tool injection);
//  * tools are read-only and run with the caller's own session (RLS applies);
//  * provider failures degrade to a clear message; nothing here is on the checkout path.
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const PROVIDERS: Record<string, () => ChatProvider> = { groq: () => groqProvider(), gemini: () => geminiProvider() };

function providerOrder(): ChatProvider[] {
  const order = (process.env.AI_PROVIDER_ORDER ?? "groq,gemini").split(",").map((p) => p.trim()).filter((p) => p in PROVIDERS);
  return (order.length ? order : ["groq", "gemini"]).map((id) => PROVIDERS[id]());
}

function json(body: Record<string, unknown>, status: number, headers: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store", ...headers } });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json({ error: "unauthorized" }, 401);
  const { data: profile } = await supabase.from("profiles").select("active").eq("id", user.id).maybeSingle();
  if (!profile?.active) return json({ error: "forbidden" }, 403);

  for (const limit of AI_LIMITS) {
    const { data, error } = await supabase.rpc("consume_rate_limit", {
      p_scope: limit.scope,
      p_limit: limit.limit,
      p_window_seconds: limit.windowSeconds,
    });
    if (error) {
      log.error("rate_limit_check_failed", { reason: error.message });
      return json({ error: "ai_unavailable" }, 503);
    }
    const row = data?.[0];
    if (row && !row.allowed) {
      const retry = Math.max(1, Number(row.retry_after_seconds));
      return json({ error: "rate_limited", retryAfterSeconds: retry }, 429, { "retry-after": String(retry) });
    }
  }

  const parsed = parseAssistantRequest(await request.json().catch(() => null));
  if (!parsed.ok) return json({ error: parsed.error }, parsed.status);

  const result = await runAssistant({
    providers: providerOrder(),
    health: providerHealth,
    executors: createPosExecutors(supabase),
    history: parsed.value.history,
    message: parsed.value.message,
    onProviderFailure: (provider, kind, message) => log.warn("ai_provider_failed", { provider, kind, message }),
  });

  if (result.ok) {
    return json({ received: result.text, provider: result.provider, degraded: result.degraded, advisory: true }, 200);
  }

  if (result.code === "ai_unavailable" || result.code === "ai_quota") {
    await recordOpsEvent("ai_provider_down", { code: result.code, attempts: result.attempts.map((a) => `${a.provider}:${a.outcome}`).join(",") }, "info");
  }
  const status = result.code === "ai_quota" ? 429 : result.code === "ai_loop_limit" ? 502 : 503;
  const headers: Record<string, string> = result.retryAfterSeconds ? { "retry-after": String(result.retryAfterSeconds) } : {};
  return json({ error: result.code, retryAfterSeconds: result.retryAfterSeconds ?? null, pos: "unaffected" }, status, headers);
}
