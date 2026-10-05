import { providerEventSchema, signBody, verifySignature } from "../lib/payments/webhook";
import { isValidPaymentReference } from "../lib/payments/providers";
import { confirmPaymentSchema } from "../lib/validation/payments";

let failures = 0;
function check(name: string, condition: boolean) {
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}`);
  if (!condition) failures++;
}

const secret = "test-secret";
const body = JSON.stringify({ eventId: "evt-1", reference: "SBX-1", status: "captured", amount: 5000 });
const signature = signBody(body, secret);

check("a correct signature verifies", verifySignature(body, signature, secret));
check("an uppercase hex signature verifies", verifySignature(body, signature.toUpperCase(), secret));
check("a tampered body fails", !verifySignature(body.replace("5000", "1"), signature, secret));
check("a wrong secret fails", !verifySignature(body, signature, "other"));
check("a missing signature fails", !verifySignature(body, null, secret));
check("an unconfigured secret never verifies", !verifySignature(body, signature, undefined) && !verifySignature(body, signature, ""));
check("a malformed signature fails", !verifySignature(body, "not-hex", secret) && !verifySignature(body, signature.slice(0, 10), secret));

check("a well-formed event parses", providerEventSchema.safeParse(JSON.parse(body)).success);
check("an unknown status is rejected", !providerEventSchema.safeParse({ eventId: "e", reference: "SBX-1", status: "pending", amount: 1 }).success);
check("a fractional amount is rejected", !providerEventSchema.safeParse({ eventId: "e", reference: "SBX-1", status: "captured", amount: 10.5 }).success);

check("an approval code is a valid reference", isValidPaymentReference("APPR-1001") && isValidPaymentReference("123456"));
check("a card-number-shaped reference is rejected", !isValidPaymentReference("4111111111111111") && !isValidPaymentReference("4111 1111 1111 1111"));
check("a short or symbol-laden reference is rejected", !isValidPaymentReference("abc") && !isValidPaymentReference("ab cd!"));
check("the confirm action rejects a PAN-like reference", !confirmPaymentSchema.safeParse({ paymentId: "11111111-1111-4111-8111-111111111111", reference: "4111111111111111" }).success);

if (failures > 0) process.exit(1);
console.log("Payment webhook and reference validation passes.");
