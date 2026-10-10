import { auditDetails } from "../lib/audit/format";

let failures = 0;
function check(name: string, condition: boolean) {
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}`);
  if (!condition) failures++;
}

const rows = auditDetails({
  refund_total: 4850,
  payment_method: "cash",
  restock: true,
  reason_length: 12,
  hash_prefix: "abc",
  signed_qty_change: "-3",
  event_type: "paid_out",
});
const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
check("money keys stay in piasters", byKey.refund_total?.kind === "money" && byKey.refund_total.value === 4850);
check("tender is labelled, not raw", byKey.payment_method?.kind === "tender");
check("booleans stay booleans", byKey.restock?.kind === "bool" && byKey.restock.value === true);
check("technical keys are hidden", !("reason_length" in byKey) && !("hash_prefix" in byKey));
check("numeric strings are parsed", byKey.signed_qty_change?.kind === "signed" && byKey.signed_qty_change.value === -3);
check("other values are text", byKey.event_type?.kind === "text" && byKey.event_type.value === "paid_out");
check("non-objects give nothing", auditDetails(null).length === 0 && auditDetails([1]).length === 0);

if (failures > 0) {
  console.error(`\n${failures} check(s) failing`);
  process.exit(1);
}
console.log("\nAudit format tests passed.");
