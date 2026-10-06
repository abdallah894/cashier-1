import type { EtaProvider } from "./types";

/**
 * Chooses the provider from ETA_PROVIDER. Today there is none: the queue
 * fills, the alert rules (eta_backlog / eta_rejected) tell you, and nothing is
 * ever sent. A real provider is added here once the authority's
 * specification, the shop's registration and its credentials are in hand
 * (see docs/eta.md). An unknown name is an error, never a silent no-op.
 */
export function getEtaProvider(name: string | undefined): EtaProvider | null {
  const wanted = (name ?? "").trim().toLowerCase();
  if (wanted === "" || wanted === "none") return null;
  throw new Error(`unknown ETA_PROVIDER "${wanted}" (implemented: none)`);
}
