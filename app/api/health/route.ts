import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Liveness + database reachability for uptime monitors. Deliberately
// minimal and public: it never reveals versions, counts or error text.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("store_settings").select("id").limit(1);
    if (error) return NextResponse.json({ status: "degraded" }, { status: 503, headers: { "cache-control": "no-store" } });
    return NextResponse.json({ status: "ok" }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ status: "degraded" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
