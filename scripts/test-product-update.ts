/** Phase 0 (P1-1): editing a product must never write stock; ids are validated. */
import { idSchema, productInputSchema, productUpdateSchema } from "../lib/validation/product";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failures++;
}

const product = {
  barcode: "6221031000012",
  name_ar: "حليب",
  name_en: "Milk",
  plu_code: null,
  category_id: null,
  price: 2500,
  cost: 2000,
  tax_rate: 0.14,
  unit: "piece" as const,
  stock_qty: 7,
  low_stock_threshold: 3,
  active: true,
  image_url: null,
};

const update = productUpdateSchema.safeParse(product);
check("a product update validates", update.success);
check("an update drops stock_qty (a stale form value can't undo sales)", update.success && !("stock_qty" in update.data));
check("an update keeps every other field", update.success && update.data.price === 2500 && update.data.barcode === product.barcode);
check("creation still accepts the opening stock", productInputSchema.safeParse(product).success && productInputSchema.parse(product).stock_qty === 7);
check("an update without stock_qty is valid", productUpdateSchema.safeParse({ ...product, stock_qty: undefined }).success);
check("a real uuid passes the id check", idSchema.safeParse("00000000-0000-4000-8000-000000000001").success);
check("junk ids are refused", !idSchema.safeParse("1; drop table products").success && !idSchema.safeParse("").success);

if (failures > 0) process.exit(1);
console.log("Product update tests passed.");
