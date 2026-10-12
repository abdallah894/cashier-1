import "fake-indexeddb/auto";
import { createOfflineDb } from "../lib/offline/db";
import { holdSale, listHeldSales, MAX_HELD_SALES, takeHeldSale } from "../lib/register/held-sales";
import type { CartItem } from "../lib/store/cart";

let failures = 0;
function check(name: string, condition: boolean) {
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}`);
  if (!condition) failures++;
}

const item: CartItem = {
  productId: "p1",
  barcode: "6221000000010",
  nameAr: "أرز",
  nameEn: "Rice",
  unitPrice: 4800,
  rateBp: 0,
  unit: "piece",
  stockQty: 10,
  qty: 2,
  discount: null,
};
const sale = (total = 9600) => ({ heldBy: "Mona", items: [item], saleDiscount: null, customer: null, promoCodes: [], total });

async function main() {
  const db = createOfflineDb("test-held-sales");
  check("nothing held at first", (await listHeldSales(db)).length === 0);

  const first = await holdSale(db, sale());
  check("a cart is held with an id and time", !!first?.id && !!first?.heldAt);
  check("an empty cart is not held", (await holdSale(db, { ...sale(), items: [] })) === null);

  for (let i = 1; i < MAX_HELD_SALES; i++) await holdSale(db, sale(i));
  check(`up to ${MAX_HELD_SALES} carts`, (await listHeldSales(db)).length === MAX_HELD_SALES);
  check("one more is refused", (await holdSale(db, sale())) === null);

  const taken = await takeHeldSale(db, first!.id);
  check("recall returns the cart with its items", taken?.items[0]?.qty === 2 && taken.heldBy === "Mona");
  check("and removes it from the list", (await listHeldSales(db)).every((s) => s.id !== first!.id));
  check("recalling it twice gives nothing", (await takeHeldSale(db, first!.id)) === null);

  if (failures > 0) {
    console.error(`\n${failures} check(s) failing`);
    process.exit(1);
  }
  console.log("\nHeld sales tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
