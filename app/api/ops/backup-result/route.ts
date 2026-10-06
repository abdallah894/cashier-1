import { NextResponse } from "next/server";
import { z } from "zod";
import { log } from "@/lib/observability/log";
import { verifyBearer } from "@/lib/ops/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { limitByIp } from "@/lib/ops/rate-limit";

// Backup jobs (scripts/backup-db.sh, a scheduled workflow...) report their
// outcome here so a missing or failed backup raises an alert. Requires
// `Authorization: Bearer $OPS_API_TOKEN`.
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  status: z.enum(["ok", "failed"]),
  sizeBytes: z.number().int().min(0).optional(),
  location: z.string().trim().max(120).optional(),
  detail: z.string().trim().max(500).optional(),
  startedAt: z.iso.datetime().optional(),
});

export async function POST(request: Request) {
  // before the secret check, so guessing the token is rate limited too
  const limited = await limitByIp(request, "ops", 30, 60);
  if (limited) return limited;
  if (!verifyBearer(request.headers.get("authorization"), process.env.OPS_API_TOKEN)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const admin = createAdminClient();
  const { error } = await admin.rpc("record_backup_run", {
    p_status: parsed.data.status,
    // generated types cannot express nullable arguments; the function accepts null for these three
    p_size_bytes: (parsed.data.sizeBytes ?? null) as number,
    p_location: parsed.data.location ?? "unspecified",
    p_detail: (parsed.data.detail ?? null) as string,
    p_started_at: (parsed.data.startedAt ?? null) as string,
  });
  if (error) {
    log.error("backup_result_not_recorded", { reason: error.message });
    return NextResponse.json({ error: "could not record" }, { status: 500 });
  }
  log[parsed.data.status === "ok" ? "info" : "error"]("backup_run", { status: parsed.data.status, location: parsed.data.location });
  return NextResponse.json({ ok: true });
}
