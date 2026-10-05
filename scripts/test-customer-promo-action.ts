import { createCustomerSchema, customerConsentSchema, findCustomerSchema } from "../lib/validation/customers";
import { createPromotionSchema, previewPromotionsSchema } from "../lib/validation/promotions";

let failures = 0;
function check(name: string, condition: boolean) {
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}`);
  if (!condition) failures++;
}

const ID = "11111111-1111-4111-8111-111111111111";

check("marketing consent defaults to off", createCustomerSchema.parse({ name: "A", phone: "01001234567" }).marketingConsent === false);
check("a short phone is rejected", !findCustomerSchema.safeParse({ phone: "123" }).success);
check("consent source is restricted", !customerConsentSchema.safeParse({ customerId: ID, consent: true, source: "web" }).success);

const base = { nameAr: "س", nameEn: "X", scope: "order", discountKind: "percent", percentBp: 1000 } as const;
check("a percent promotion is valid", createPromotionSchema.safeParse(base).success);
check("a percent promotion needs a rate", !createPromotionSchema.safeParse({ ...base, percentBp: undefined }).success);
check("a fixed promotion needs an amount", !createPromotionSchema.safeParse({ ...base, discountKind: "fixed", percentBp: undefined }).success);
check("percent is capped at 100%", !createPromotionSchema.safeParse({ ...base, percentBp: 10_001 }).success);
check("the window must be ordered", !createPromotionSchema.safeParse({ ...base, startsAt: "2030-02-01T00:00:00Z", endsAt: "2030-01-01T00:00:00Z" }).success);
check("codes are restricted to safe characters", !createPromotionSchema.safeParse({ ...base, code: "bad code!" }).success);
check("stackable defaults to off", createPromotionSchema.parse(base).stackable === false);

const line = { product_id: ID, qty: 1, line_discount: 0 };
check("a preview needs at least one line", !previewPromotionsSchema.safeParse({ items: [] }).success);
check("a preview accepts a customer and codes", previewPromotionsSchema.safeParse({ items: [line], customerId: ID, codes: ["SAVE"] }).success);

if (failures > 0) process.exit(1);
console.log("Customer and promotion validation passes.");
