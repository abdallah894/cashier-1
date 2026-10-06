import type { EtaOutcome, EtaProvider, EtaSubmission } from "./types";

export type EtaWorkerDeps = {
  provider: EtaProvider;
  /** claims due rows (public.eta_claim_batch) */
  claim: (limit: number) => Promise<EtaSubmission[]>;
  /** stores the outcome (public.eta_record_result) */
  record: (id: string, outcome: EtaOutcome) => Promise<void>;
  batchSize?: number;
  /** stop after this many batches so one cron run stays inside its time limit */
  maxBatches?: number;
  log?: (event: string, fields: Record<string, unknown>) => void;
};

export type EtaWorkerResult = { claimed: number; accepted: number; rejected: number; retried: number; recordFailed: number };

const clip = (text: string) => text.slice(0, 300);

/**
 * Drains the queue through the provider. A provider that throws is a
 * temporary failure (retry with backoff), never a lost document; a failure to
 * save an outcome leaves the row "submitting", which the database hands out
 * again after 10 minutes — the provider must therefore treat resubmitting the
 * same document as safe (idempotent), as the authority's API requires anyway.
 */
export async function processEtaQueue(deps: EtaWorkerDeps): Promise<EtaWorkerResult> {
  const result: EtaWorkerResult = { claimed: 0, accepted: 0, rejected: 0, retried: 0, recordFailed: 0 };
  const batchSize = deps.batchSize ?? 20;
  for (let batch = 0; batch < (deps.maxBatches ?? 5); batch++) {
    const rows = await deps.claim(batchSize);
    if (rows.length === 0) break;
    result.claimed += rows.length;
    for (const row of rows) {
      let outcome: EtaOutcome;
      try {
        outcome = await deps.provider.submit(row);
      } catch (error) {
        outcome = { kind: "retry", error: clip(error instanceof Error ? error.message : "provider failed") };
      }
      if (outcome.kind === "accepted") result.accepted++;
      else if (outcome.kind === "rejected") result.rejected++;
      else result.retried++;
      try {
        await deps.record(row.id, outcome);
      } catch (error) {
        result.recordFailed++;
        deps.log?.("eta_record_failed", { id: row.id, reason: error instanceof Error ? error.message : "unknown" });
      }
    }
    if (rows.length < batchSize) break;
  }
  return result;
}
