import type { CartTotals } from "@/lib/store/cart";
import type { ProvisionalReceipt } from "./types";

/**
 * Receipt content for a sale rung offline, derived from the same cart
 * totals the live register shows. The server recomputes everything at sync
 * time (create_sale stays authoritative), so this is explicitly provisional.
 */
export function buildProvisionalReceipt(
  totals: CartTotals,
  amountTendered: number,
  cashierName: string | null
): ProvisionalReceipt {
  return {
    lines: totals.lines.map((line) => ({
      nameAr: line.item.nameAr,
      nameEn: line.item.nameEn,
      qty: line.item.qty,
      unitPrice: line.item.unitPrice,
      lineDiscount: line.lineDiscount + line.saleDiscountShare + line.promoDiscount,
      lineTotal: line.gross,
    })),
    vatBreakdown: [...totals.vatByRate.entries()]
      .map(([rateBp, v]) => ({ rateBp, net: v.net, tax: v.tax }))
      .sort((a, b) => a.rateBp - b.rateBp),
    subtotal: totals.subtotal,
    taxTotal: totals.taxTotal,
    discountTotal: totals.discountTotal,
    total: totals.total,
    amountTendered,
    changeDue: amountTendered - totals.total,
    cashierName,
  };
}

/** True when the discount is large enough that the server would demand a manager approval. */
export function discountNeedsApproval(totals: CartTotals, thresholdBp: number | null): boolean {
  // A queued sale carries any promotion discount as an ordinary discount, so it counts here too.
  if (totals.discountTotal <= 0) return false;
  return totals.discountTotal * 10000 > totals.baseTotal * (thresholdBp ?? 0);
}
