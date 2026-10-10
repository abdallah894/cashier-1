// EGP ↔ integer piasters, without float arithmetic on amounts.
// All parsing is string-based: "48.95" → 4895.

const ARABIC_INDIC_ZERO = 0x0660; // ٠
const EXTENDED_ARABIC_INDIC_ZERO = 0x06f0; // ۰

/** Normalize Arabic-Indic digits (٠١٢٣ / ۰۱۲۳) and separators (٫ ,) to ASCII. */
/**
 * Largest cash amount a till accepts as "received" (EGP 100,000, in piasters).
 * A scanned 13-digit barcode typed into the tendered box is far above this, so
 * it can never be confirmed as a payment.
 */
export const MAX_TENDERED_PIASTERS = 10_000_000;

export function normalizeDigits(input: string): string {
  let out = "";
  for (const ch of input) {
    const code = ch.codePointAt(0)!;
    if (code >= ARABIC_INDIC_ZERO && code <= ARABIC_INDIC_ZERO + 9) {
      out += String(code - ARABIC_INDIC_ZERO);
    } else if (code >= EXTENDED_ARABIC_INDIC_ZERO && code <= EXTENDED_ARABIC_INDIC_ZERO + 9) {
      out += String(code - EXTENDED_ARABIC_INDIC_ZERO);
    } else if (ch === "٫" || ch === ",") {
      out += ".";
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * Parse a user-entered EGP amount ("48", "48.9", "48.95", "٤٨٫٩٥")
 * into integer piasters. Returns null when not a valid amount.
 */
export function parseEgpToPiasters(input: string): number | null {
  const normalized = normalizeDigits(input.trim());
  const match = /^(\d{1,10})(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!match) return null;
  const pounds = Number(match[1]);
  const piasters = Number((match[2] ?? "").padEnd(2, "0"));
  return pounds * 100 + piasters;
}

/**
 * True when a typed "cash received" amount is above the cap, including input
 * too long to parse at all (a 13-digit barcode read into the box).
 */
export function isTenderedTooLarge(input: string): boolean {
  const parsed = parseEgpToPiasters(input);
  if (parsed !== null) return parsed > MAX_TENDERED_PIASTERS;
  return /^\d{11,}(?:\.\d*)?$/.test(normalizeDigits(input.trim()));
}

/** Integer piasters → plain input string ("4895" → "48.95", "4800" → "48"). */
export function piastersToEgpInput(piasters: number): string {
  const sign = piasters < 0 ? "-" : "";
  const abs = Math.abs(piasters);
  const pounds = Math.trunc(abs / 100);
  const rem = abs % 100;
  return rem === 0 ? `${sign}${pounds}` : `${sign}${pounds}.${String(rem).padStart(2, "0")}`;
}

/** Localized currency display. Division is display-only (Intl rounds to 2dp). */
// building an Intl.NumberFormat is slow; the register formats hundreds of prices per render
const egpFormats = new Map<string, Intl.NumberFormat>();

export function formatEgp(piasters: number, locale: string): string {
  const tag = locale === "ar" ? "ar-EG" : "en-EG";
  let format = egpFormats.get(tag);
  if (!format) {
    format = new Intl.NumberFormat(tag, { style: "currency", currency: "EGP" });
    egpFormats.set(tag, format);
  }
  return format.format(piasters / 100);
}

/**
 * Line base amount: unitPrice (piasters) × qty (≤3 decimals), rounded to
 * integer piasters exactly like the SQL `round(price * qty)`. qty is
 * scaled to an integer first so no float product can flip a rounding.
 */
export function lineBaseAmount(unitPrice: number, qty: number): number {
  const qtyMil = Math.round(qty * 1000);
  return Math.round((unitPrice * qtyMil) / 1000);
}

/**
 * VAT-inclusive gross → net portion, matching the SQL
 * `round(gross / (1 + tax_rate))` exactly. rateBp = tax_rate in basis
 * points (0.14 → 1400). Integer inputs keep IEEE division correctly
 * rounded, so .5 boundaries agree with Postgres numeric.
 */
export function extractNet(grossPiasters: number, rateBp: number): number {
  return Math.round((grossPiasters * 10000) / (10000 + rateBp));
}

/**
 * Parse a quantity ("2", "1.250"). Max 3 decimals (kg scale weights);
 * per-piece items must be whole. Returns null when invalid.
 */
export function parseQty(input: string, unit: "piece" | "kg"): number | null {
  const normalized = normalizeDigits(input.trim());
  const pattern = unit === "kg" ? /^(\d{1,7})(?:\.(\d{1,3}))?$/ : /^\d{1,7}$/;
  const match = pattern.exec(normalized);
  if (!match) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}
