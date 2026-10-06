import "fake-indexeddb/auto";
import { createOfflineDb } from "../lib/offline/db";
import { findByPlu, loadWeighedConfig, refreshCatalog, saveWeighedConfig } from "../lib/offline/catalog";
import type { Tables } from "../lib/supabase/database.types";
import {
  DEFAULT_WEIGHED_CONFIG,
  ean13CheckDigit,
  isValidEan13,
  parseWeighedBarcode,
  quantityForLabelPrice,
  type WeighedConfig,
} from "../lib/barcode/weighed";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failures++;
}

/** Builds a scale label: prefix + item code + value, plus the right check digit. */
function label(prefix: string, plu: string, value: string, codeLen = 5): string {
  const body = prefix + plu.padStart(codeLen, "0") + value.padStart(10 - codeLen, "0");
  return body + ean13CheckDigit(body);
}
const on: WeighedConfig = { ...DEFAULT_WEIGHED_CONFIG, enabled: true };

// known real EAN-13 check digits
check("check digit of 400638133393 is 1", ean13CheckDigit("400638133393") === 1);
check("a real EAN-13 validates", isValidEan13("4006381333931"));
check("a wrong check digit does not", !isValidEan13("4006381333932"));
check("non-13-digit codes do not validate", !isValidEan13("123") && !isValidEan13("40063813339311") && !isValidEan13("40063813339a1"));

// weight labels
const tomatoes = label("21", "123", "1250"); // PLU 123, 1.250 kg
const w = parseWeighedBarcode(tomatoes, on);
check("a weight label gives the PLU without leading zeros", w?.kind === "weight" && w.plu === "123", JSON.stringify(w));
check("and the weight in kg", w?.kind === "weight" && w.weightKg === 1.25);
check("a zero weight is refused", parseWeighedBarcode(label("21", "123", "0"), on) === null);
check("PLU 0 is refused", parseWeighedBarcode(label("21", "0", "500"), on) === null);

// gating
check("off by default", parseWeighedBarcode(tomatoes, DEFAULT_WEIGHED_CONFIG) === null);
check("a prefix outside the range is an ordinary barcode", parseWeighedBarcode(label("30", "123", "1250"), on) === null);
check("the range edges are included", parseWeighedBarcode(label("20", "5", "100"), on) !== null && parseWeighedBarcode(label("29", "5", "100"), on) !== null);
check("a narrowed range excludes the others", parseWeighedBarcode(label("21", "5", "100"), { ...on, prefixMin: 22, prefixMax: 23 }) === null);
check("a bad check digit is not a label", parseWeighedBarcode(tomatoes.slice(0, 12) + ((Number(tomatoes[12]) + 1) % 10), on) === null);
check("a normal product EAN is not a label", parseWeighedBarcode("6221031234563", on) === null);

// other layouts
const six = parseWeighedBarcode(label("22", "123456", "999", 6), { ...on, itemCodeLength: 6 });
check("a 6-digit PLU layout leaves a 4-digit weight", six?.kind === "weight" && six.plu === "123456" && six.weightKg === 0.999, JSON.stringify(six));
const four = parseWeighedBarcode(label("22", "1234", "12345", 4), { ...on, itemCodeLength: 4 });
check("a 4-digit PLU layout leaves a 6-digit weight", four?.kind === "weight" && four.weightKg === 12.345, JSON.stringify(four));
check("an impossible code length is refused", parseWeighedBarcode(tomatoes, { ...on, itemCodeLength: 9 }) === null);

// price labels
const priced = parseWeighedBarcode(label("23", "77", "4550"), { ...on, valueKind: "price_piasters" });
check("a price label gives the price in piasters", priced?.kind === "price" && priced.plu === "77" && priced.pricePiasters === 4550, JSON.stringify(priced));
check("label price becomes a quantity at the shelf price", quantityForLabelPrice(4550, 9100) === 0.5);
check("quantity rounds to grams", quantityForLabelPrice(1000, 3000) === 0.333);
check("a zero shelf price gives no quantity", quantityForLabelPrice(1000, 0) === 0);

// ---- offline: PLU lookup and the cached label layout ----
async function offline() {
  const db = createOfflineDb("weighed-offline");
  const product = (id: string, plu: string | null, active = true) => ({ id, barcode: `b-${id}`, name_ar: id, name_en: id, price: 2500, tax_rate: 0, stock_qty: 9, unit: "kg", active, plu_code: plu }) as unknown as Tables<"products">;
  await refreshCatalog(db, async () => [product("tomato", "123"), product("cucumber", "45"), product("plain", null), product("retired", "99", false)]);
  check("an offline PLU finds its product", (await findByPlu(db, "123"))?.id === "tomato");
  check("an unknown PLU finds nothing", (await findByPlu(db, "777")) === null);
  check("products without a PLU are never matched", (await findByPlu(db, "")) === null);
  check("a deactivated product is not found by PLU", (await findByPlu(db, "99")) === null);
  check("no cached layout until one is saved", (await loadWeighedConfig(db)) === null);
  await saveWeighedConfig(db, { ...DEFAULT_WEIGHED_CONFIG, enabled: true, prefixMin: 22, prefixMax: 24, itemCodeLength: 6 });
  const cached = await loadWeighedConfig(db);
  check("the label layout is cached for offline scanning", cached?.enabled === true && cached.prefixMin === 22 && cached.itemCodeLength === 6);
  const offlineParsed = cached ? parseWeighedBarcode(label("23", "123456", "750", 6), cached) : null;
  check("an offline scan of a label uses the cached layout", offlineParsed?.kind === "weight" && offlineParsed.weightKg === 0.75);
}

offline().then(() => {
  if (failures > 0) process.exit(1);
  console.log("Weighed barcode tests passed.");
});
