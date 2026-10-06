import { NextResponse } from "next/server";
import { providerHealth } from "@/lib/ai/health";
import { verifyBearer } from "@/lib/ops/auth";
import { createAdminClient } from "@/lib/supabase/admin";

// Liveness + database reachability for uptime monitors.
//  * Public (no token): minimal and cheap. The database answer is cached for a
//    few seconds so a flood of requests cannot turn into a flood of
//    service-role queries. It never reveals versions, counts or error text.
//  * `?deep=1` with `Authorization: Bearer $OPS_API_TOKEN`: always checks the
//    database now and also reports the AI provider circuit state.
export const dynamic = "force-dynamic";

const headers = { "cache-control": "no-store" };
const CACHE_MS = 5_000;
let cached: { at: number; ok: boolean } | null = null;

async function databaseOk(): Promise<boolean> {
  try {
    const { error } = await createAdminClient().from("store_settings").select("id").limit(1);
    return !error;
  } catch {
    return false;
  }
}

export async function GET(request: Request) {
  const deep = new URL(request.url).searchParams.get("deep") === "1";

  if (deep) {
    if (!verifyBearer(request.headers.get("authorization"), process.env.OPS_API_TOKEN)) {
      return NextResponse.json({ status: "unauthorized" }, { status: 401, headers });
    }
    const ok = await databaseOk();
    return NextResponse.json(
      { status: ok ? "ok" : "degraded", database: ok ? "ok" : "down", ai: providerHealth.snapshot() },
      { status: ok ? 200 : 503, headers }
    );
  }

  if (!cached || Date.now() - cached.at > CACHE_MS) cached = { at: Date.now(), ok: await databaseOk() };
  return NextResponse.json({ status: cached.ok ? "ok" : "degraded" }, { status: cached.ok ? 200 : 503, headers });
}
