import { NextResponse } from "next/server";
import { getEtaProvider } from "@/lib/eta/providers";
import { processEtaQueue } from "@/lib/eta/worker";
import type { EtaSubmission } from "@/lib/eta/types";
import { log } from "@/lib/observability/log";
import { verifyBearer } from "@/lib/ops/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { limitByIp } from "@/lib/ops/rate-limit";

// Cron entry point (vercel.json): sends queued sales/returns to the tax
// authority through the configured provider. Authenticated like /api/ops/check.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  // before the secret check, so guessing the token is rate limited too
  const limited = await limitByIp(request, "ops", 30, 60);
  if (limited) return limited;
  if (!verifyBearer(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let provider;
  try {
    provider = getEtaProvider(process.env.ETA_PROVIDER);
  } catch (error) {
    log.error("eta_provider_misconfigured", { reason: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ error: "provider misconfigured" }, { status: 500 });
  }
  // No provider: leave the queue alone (rows stay queued and the eta_backlog alert fires).
  if (!provider) return NextResponse.json({ status: "no_provider" });

  const admin = createAdminClient();
  const result = await processEtaQueue({
    provider,
    claim: async (limit) => {
      const { data, error } = await admin.rpc("eta_claim_batch", { p_limit: limit });
      if (error) throw error;
      return (data ?? []) as EtaSubmission[];
    },
    record: async (id, outcome) => {
      const { error } = await admin.rpc("eta_record_result", {
        p_id: id,
        p_outcome: outcome.kind,
        p_eta_uuid: outcome.kind === "accepted" ? outcome.etaUuid : undefined,
        p_submission_id: outcome.kind === "accepted" ? outcome.submissionId : undefined,
        p_error: outcome.kind === "accepted" ? undefined : outcome.error,
      });
      if (error) throw error;
    },
    log: (event, fields) => log.warn(event, fields),
  });
  log.info("eta_queue_processed", result);
  return NextResponse.json({ status: "ok", provider: provider.name, ...result });
}
