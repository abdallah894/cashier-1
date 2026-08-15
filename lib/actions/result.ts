// Shared action result. `error` is an i18n key under "errors.*" —
// the client translates it into the current language for toasts.
export type ActionResult<T = void> = { ok: true; data: T } | { ok: false; error: string };

/** Map raw Postgres/PostgREST errors to i18n error keys. */
export function mapDbError(error: { code?: string; message?: string }): string {
  if (error.code === "23505") return "duplicateBarcode";
  if (error.code === "23503") return "productInUse";
  if (error.code === "42501") return "notAuthorized";
  const msg = error.message ?? "";
  if (msg.includes("admin only")) return "notAuthorized";
  if (msg.includes("negative")) return "stockNegative";
  if (msg.includes("whole number")) return "wholeNumberRequired";
  return "unknown";
}
