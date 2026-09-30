import { buildReturnReceipt } from "../lib/receipts/build-return";

const receipt = buildReturnReceipt({
  id: "11111111-1111-4111-8111-111111111111",
  return_number: 7,
  refund_total: 4895,
  refund_tender: "cash",
  restock: true,
  reason: "Damaged item",
  created_at: "2026-09-30T12:00:00Z",
  sales: { sale_number: 42 },
  profiles: { full_name: "Cashier" },
  return_items: [
    { name_ar: "أرز", name_en: "Rice", qty: 1, unit_price: 4895, line_refund_total: 4895 },
  ],
});

if (receipt.originalSaleNumber !== 42 || receipt.refundTotal !== 4895 || !receipt.restocked) {
  console.error("Return receipt did not preserve its immutable audit fields.");
  process.exit(1);
}
console.log("Return receipt builder passes.");
