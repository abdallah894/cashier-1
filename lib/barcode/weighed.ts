/**
 * Scale-printed ("weighed") barcodes.
 *
 * A deli/produce scale prints an in-store EAN-13 that carries the item code
 * and either the weight or the price instead of a fixed product barcode:
 *
 *   P P  I I I I I  V V V V V  C        (2 + itemCodeLength + valueLength + 1 = 13)
 *   │    │          │          └ EAN-13 check digit
 *   │    │          └ value: weight in grams, or price in piasters
 *   │    └ item code (the product's PLU)
 *   └ prefix 20–29 (GS1 "restricted circulation" range for in-store use)
 *
 * Pure and dependency-free so it is unit-tested without a browser and shared
 * by the live lookup and the offline catalog.
 */
export type WeighedConfig = {
  enabled: boolean;
  /** first and last two-digit prefix treated as a scale label (20–29) */
  prefixMin: number;
  prefixMax: number;
  /** digits of the item code (PLU); the value gets the remaining 10 − itemCodeLength digits */
  itemCodeLength: number;
  valueKind: "weight_grams" | "price_piasters";
};

export const DEFAULT_WEIGHED_CONFIG: WeighedConfig = {
  enabled: false,
  prefixMin: 20,
  prefixMax: 29,
  itemCodeLength: 5,
  valueKind: "weight_grams",
};

export type WeighedBarcode =
  | { kind: "weight"; plu: string; weightKg: number }
  | { kind: "price"; plu: string; pricePiasters: number };

/** EAN-13 check digit for the first 12 digits. */
export function ean13CheckDigit(first12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

export function isValidEan13(code: string): boolean {
  return /^\d{13}$/.test(code) && ean13CheckDigit(code.slice(0, 12)) === Number(code[12]);
}

/**
 * Returns the label's contents, or null when the code is not a valid scale
 * label under `config` (wrong length, prefix outside the range, bad check
 * digit, or the feature is off) — the caller then treats it as an ordinary
 * barcode. The PLU has no leading zeros ("00123" → "123"); PLU 0 is invalid.
 */
export function parseWeighedBarcode(code: string, config: WeighedConfig): WeighedBarcode | null {
  if (!config.enabled || !isValidEan13(code)) return null;
  const prefix = Number(code.slice(0, 2));
  if (prefix < config.prefixMin || prefix > config.prefixMax) return null;
  const codeLen = config.itemCodeLength;
  if (!Number.isInteger(codeLen) || codeLen < 4 || codeLen > 6) return null;

  const plu = String(Number(code.slice(2, 2 + codeLen)));
  if (plu === "0") return null;
  const value = Number(code.slice(2 + codeLen, 12));

  if (config.valueKind === "weight_grams") {
    if (value <= 0) return null;
    return { kind: "weight", plu, weightKg: value / 1000 };
  }
  if (value <= 0) return null;
  return { kind: "price", plu, pricePiasters: value };
}

/**
 * Quantity (kg, 3 decimals) a price label stands for at the product's current
 * per-kg price. The line total can differ from the printed price by a piaster
 * when the shelf price changed since the label was printed — the till always
 * charges the current price.
 */
export function quantityForLabelPrice(pricePiasters: number, unitPricePiasters: number): number {
  if (unitPricePiasters <= 0) return 0;
  return Math.round((pricePiasters / unitPricePiasters) * 1000) / 1000;
}

type WeighedSettingsRow = {
  weighed_barcode_enabled: boolean;
  weighed_prefix_min: number;
  weighed_prefix_max: number;
  weighed_item_code_length: number;
  weighed_value_kind: string;
};

/** store_settings row → parser config (an unknown value kind falls back to weight). */
export function weighedConfigFromSettings(row: WeighedSettingsRow): WeighedConfig {
  return {
    enabled: row.weighed_barcode_enabled,
    prefixMin: row.weighed_prefix_min,
    prefixMax: row.weighed_prefix_max,
    itemCodeLength: row.weighed_item_code_length,
    valueKind: row.weighed_value_kind === "price_piasters" ? "price_piasters" : "weight_grams",
  };
}
