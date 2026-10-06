/** A queued document waiting for the tax authority (a row of public.eta_submissions). */
export type EtaSubmission = {
  id: string;
  document_kind: "sale" | "return";
  sale_id: string | null;
  return_id: string | null;
  /** 1 on the first attempt (the claim increments it) */
  attempts: number;
};

export type EtaOutcome =
  /** the authority accepted it; `etaUuid` is the identifier it (or the spec) assigns */
  | { kind: "accepted"; etaUuid: string; submissionId?: string }
  /** permanent refusal (invalid data, unknown POS…): a person must look at it */
  | { kind: "rejected"; error: string }
  /** temporary problem (network, portal down, rate limit): try again later */
  | { kind: "retry"; error: string };

/**
 * The only part that talks to the authority. A provider turns a queued
 * document into a submission (building the document, signing, calling the
 * API); everything around it — queueing, retry/backoff, alerts — is
 * provider-independent and lives in worker.ts and the database.
 */
export interface EtaProvider {
  readonly name: string;
  submit(doc: EtaSubmission): Promise<EtaOutcome>;
}
