/**
 * Turns an audit event's metadata (a JSON object of whitelisted keys, see
 * write_audit_event) into typed rows the page can label and format.
 * Technical keys nobody reads (hash prefixes, ids, lengths) are dropped.
 */
export type AuditDetail =
  | { key: string; kind: "money"; value: number } // piasters
  | { key: string; kind: "number"; value: number }
  | { key: string; kind: "signed"; value: number }
  | { key: string; kind: "bool"; value: boolean }
  | { key: string; kind: "tender"; value: string }
  | { key: string; kind: "text"; value: string };

const MONEY = new Set(["amount", "discount_total", "expected_cash", "refund_total", "variance"]);
const HIDDEN = new Set(["hash_prefix", "shift_id", "reason_length"]);

export function auditDetails(metadata: unknown): AuditDetail[] {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return [];
  const details: AuditDetail[] = [];
  for (const [key, raw] of Object.entries(metadata as Record<string, unknown>)) {
    if (HIDDEN.has(key) || raw === null || raw === undefined) continue;
    const num = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
    if (MONEY.has(key) && Number.isFinite(num)) details.push({ key, kind: "money", value: Math.round(num) });
    else if (key === "signed_qty_change" && Number.isFinite(num)) details.push({ key, kind: "signed", value: num });
    else if (key === "item_count" && Number.isFinite(num)) details.push({ key, kind: "number", value: num });
    else if (typeof raw === "boolean") details.push({ key, kind: "bool", value: raw });
    else if (key === "payment_method" && typeof raw === "string") details.push({ key, kind: "tender", value: raw });
    else details.push({ key, kind: "text", value: typeof raw === "string" ? raw : JSON.stringify(raw) });
  }
  return details;
}
