import { log } from "@/lib/observability/log";

// Shared action result. `error` is an i18n key under "errors.*" —
// the client translates it into the current language for toasts.
export type ActionResult<T = void> = { ok: true; data: T } | { ok: false; error: string };

/** Map raw Postgres/PostgREST errors to i18n error keys. */
export function mapDbError(error: { code?: string; message?: string; details?: string | null; hint?: string | null }): string {
  if (error.code === "23505") return (error.message ?? "").includes("products_plu_code_key") ? "duplicatePlu" : "duplicateBarcode";
  if (error.code === "23503") return "productInUse";
  if (error.code === "42501") return "notAuthorized";
  const msg = error.message ?? "";
  if (msg.includes("admin only")) return "notAuthorized";
  if (msg.includes("negative")) return "stockNegative";
  if (msg.includes("whole number")) return "wholeNumberRequired";
  // the user only sees "something went wrong": keep the real reason for whoever reads the logs
  log.error("db_error_unmapped", { code: error.code, message: msg, details: error.details ?? undefined, hint: error.hint ?? undefined });
  return "unknown";
}
