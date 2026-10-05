import {
  createPurchaseOrderSchema,
  receivePurchaseOrderSchema,
  supplierSchema,
} from "../lib/validation/purchasing";

let failures = 0;
function check(name: string, condition: boolean) {
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}`);
  if (!condition) failures++;
}

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

check("supplier needs a name", !supplierSchema.safeParse({ name: "  " }).success);
check("supplier accepts an empty email", supplierSchema.safeParse({ name: "Acme", email: "" }).success);
check("supplier rejects a malformed email", !supplierSchema.safeParse({ name: "Acme", email: "nope" }).success);

const line = (productId: string, orderedQty: number, unitCost: number) => ({ productId, orderedQty, unitCost });
const order = (lines: ReturnType<typeof line>[]) => ({ supplierId: A, lines });
check("order accepts a weighed quantity", createPurchaseOrderSchema.safeParse(order([line(B, 2.5, 3200)])).success);
check("order needs at least one line", !createPurchaseOrderSchema.safeParse(order([])).success);
check("order rejects fractional piasters", !createPurchaseOrderSchema.safeParse(order([line(B, 1, 10.5)])).success);
check("order rejects a zero quantity", !createPurchaseOrderSchema.safeParse(order([line(B, 0, 100)])).success);
check("order rejects a product listed twice", !createPurchaseOrderSchema.safeParse(order([line(B, 1, 100), line(B, 2, 100)])).success);

const receipt = (qty: number) => ({
  poId: A,
  idempotencyKey: C,
  lines: [{ poLineId: B, qty }],
});
check("receipt requires an idempotency key", !receivePurchaseOrderSchema.safeParse({ poId: A, lines: [{ poLineId: B, qty: 1 }] }).success);
check("receipt accepts decimals up to three places", receivePurchaseOrderSchema.safeParse(receipt(1.125)).success);
check("receipt rejects four decimals", !receivePurchaseOrderSchema.safeParse(receipt(1.1234)).success);
check("receipt rejects zero", !receivePurchaseOrderSchema.safeParse(receipt(0)).success);

if (failures > 0) process.exit(1);
console.log("Purchasing action validation passes.");
