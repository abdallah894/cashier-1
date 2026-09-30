import { returnInputSchema } from "../lib/validation/return";

let failures = 0;

function check(name: string, condition: boolean, detail = "") {
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!condition) failures++;
}

const validReturnInput = {
  saleId: "11111111-1111-4111-8111-111111111111",
  items: [{ saleItemId: "22222222-2222-4222-8222-222222222222", qty: 0.5 }],
  refundTender: "cash",
  reason: "Customer changed mind",
  restock: true,
};

const accepted = returnInputSchema.safeParse(validReturnInput);
check("accepts a partial weighted-item return", accepted.success);

const blankReason = returnInputSchema.safeParse({ ...validReturnInput, reason: "   " });
check("rejects a blank return reason", !blankReason.success);

const badQty = returnInputSchema.safeParse({
  ...validReturnInput,
  items: [{ ...validReturnInput.items[0], qty: 0.1234 }],
});
check("rejects quantities with more than three decimal places", !badQty.success);

const badPin = returnInputSchema.safeParse({ ...validReturnInput, managerPin: "12a4" });
check("rejects a non-numeric manager PIN", !badPin.success);

if (failures > 0) process.exit(1);
console.log("All return-action validation tests passed.");
