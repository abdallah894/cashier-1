import { drawerPulse } from "@/lib/receipts/escpos";
import type { PrinterTransport } from "./transport";

/**
 * Orchestrates "do something on the hardware" so that every attempt is
 * recorded server-side and a failure is a visible, retryable job rather than
 * a lost print. Dependencies are injected: the browser wires the server
 * actions and WebUSB, tests wire fakes.
 *
 * A print job never touches the sale: failing, retrying or reprinting only
 * creates print_jobs rows.
 */
export type RequestPrintResult =
  | { ok: true; jobId: string; copyNumber: number }
  | { ok: false; error: string };

export type PrintDeps = {
  /** creates the job server-side (and enforces who may print what) */
  requestJob(kind: "original" | "reprint" | "gift", reason: string | null): Promise<RequestPrintResult>;
  completeJob(jobId: string, ok: boolean, error: string | null): Promise<void>;
  /** bytes for this copy (ESC/POS text or raster); only called when a printer transport exists */
  build(copyNumber: number, kind: "original" | "reprint" | "gift"): Promise<Uint8Array> | Uint8Array;
  /** null when no thermal printer is paired in this browser */
  transport: PrinterTransport | null;
  /** fallback: the browser print dialog (cannot report success, so it counts as printed) */
  browserPrint?: () => void;
};

export type PrintOutcome =
  | { status: "printed"; jobId: string; via: "printer" | "browser"; copyNumber: number }
  | { status: "failed"; jobId: string | null; error: string };

export async function runPrint(deps: PrintDeps, kind: "original" | "reprint" | "gift", reason: string | null = null): Promise<PrintOutcome> {
  const request = await deps.requestJob(kind, reason);
  if (!request.ok) return { status: "failed", jobId: null, error: request.error };

  if (deps.transport) {
    try {
      const bytes = await deps.build(request.copyNumber, kind);
      await deps.transport.send(bytes);
      await deps.completeJob(request.jobId, true, null);
      return { status: "printed", jobId: request.jobId, via: "printer", copyNumber: request.copyNumber };
    } catch (error) {
      const message = error instanceof Error ? error.message : "print failed";
      await deps.completeJob(request.jobId, false, message).catch(() => undefined);
      return { status: "failed", jobId: request.jobId, error: message };
    }
  }

  if (deps.browserPrint) {
    try {
      deps.browserPrint();
      await deps.completeJob(request.jobId, true, null);
      return { status: "printed", jobId: request.jobId, via: "browser", copyNumber: request.copyNumber };
    } catch (error) {
      const message = error instanceof Error ? error.message : "print failed";
      await deps.completeJob(request.jobId, false, message).catch(() => undefined);
      return { status: "failed", jobId: request.jobId, error: message };
    }
  }

  await deps.completeJob(request.jobId, false, "no printer available").catch(() => undefined);
  return { status: "failed", jobId: request.jobId, error: "no printer available" };
}

export type DrawerDeps = {
  /** server-side authorisation tied to an approved event; the drawer never opens without one */
  authorize(): Promise<{ ok: true; openingId: string } | { ok: false; error: string }>;
  complete(openingId: string, ok: boolean, error: string | null): Promise<void>;
  transport: PrinterTransport | null;
};

export type DrawerOutcome = { status: "opened"; openingId: string } | { status: "denied" | "failed"; error: string };

/** Authorise, kick the drawer through the printer, then report what happened. */
export async function runDrawerOpen(deps: DrawerDeps): Promise<DrawerOutcome> {
  const authorization = await deps.authorize();
  if (!authorization.ok) return { status: "denied", error: authorization.error };
  if (!deps.transport) {
    await deps.complete(authorization.openingId, false, "no printer available").catch(() => undefined);
    return { status: "failed", error: "no printer available" };
  }
  try {
    await deps.transport.send(drawerPulse());
    await deps.complete(authorization.openingId, true, null);
    return { status: "opened", openingId: authorization.openingId };
  } catch (error) {
    const message = error instanceof Error ? error.message : "drawer did not open";
    await deps.complete(authorization.openingId, false, message).catch(() => undefined);
    return { status: "failed", error: message };
  }
}
