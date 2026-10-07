import { log } from "@/lib/observability/log";

/**
 * Runs a lookup a page can live without. If it fails, the page still renders
 * with `fallback`, and the log names the lookup and the database's own error,
 * so a broken extra (printer list, store details...) never hides a receipt.
 */
export async function optionalQuery<T>(name: string, run: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await run();
  } catch (error) {
    log.error("optional_query_failed", { query: name, ...describeError(error) });
    return fallback;
  }
}

/** The useful parts of a thrown Supabase/PostgREST error (or any error) for a log line. */
export function describeError(error: unknown): { message: string; code?: string; details?: string; hint?: string } {
  if (error && typeof error === "object") {
    const e = error as { message?: unknown; code?: unknown; details?: unknown; hint?: unknown };
    return {
      message: typeof e.message === "string" ? e.message : String(error),
      ...(typeof e.code === "string" ? { code: e.code } : {}),
      ...(typeof e.details === "string" ? { details: e.details } : {}),
      ...(typeof e.hint === "string" ? { hint: e.hint } : {}),
    };
  }
  return { message: String(error) };
}
