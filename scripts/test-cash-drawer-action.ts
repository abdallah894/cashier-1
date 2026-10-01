import { cashDrawerEventSchema } from "../lib/validation/cash-drawer";

if (cashDrawerEventSchema.safeParse({ shiftId: "11111111-1111-4111-8111-111111111111", type: "paid_out", amount: 5000, reason: "" }).success) {
  throw new Error("blank reason accepted");
}
if (!cashDrawerEventSchema.safeParse({ shiftId: "11111111-1111-4111-8111-111111111111", type: "safe_drop", amount: 5000, reason: "Safe deposit" }).success) {
  throw new Error("valid cash drawer event rejected");
}
console.log("Cash drawer action validation passes.");
