import { normalizeDigits } from "@/lib/money";

/**
 * "3*" typed in the search box (then Enter) means "the next item counts 3".
 * Accepts Arabic-Indic digits, an optional 3-decimal weight ("0.5*"), and a
 * trailing "*" or "×". Returns the quantity, or null when the text is not a
 * multiplier (so ordinary searches are never swallowed).
 */
export function parseMultiplier(text: string): number | null {
  const match = /^(\d{1,7}(?:\.\d{1,3})?)\s*[*×x]$/i.exec(normalizeDigits(text.trim()));
  if (!match) return null;
  const value = Number(match[1]);
  return value > 0 ? value : null;
}

/** +/− step on the selected line: a whole piece, or 100 g on a weighed line. */
export function qtyStep(unit: "piece" | "kg"): number {
  return unit === "kg" ? 0.1 : 1;
}
