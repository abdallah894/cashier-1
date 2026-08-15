import { extractNet } from "@/lib/money";
import { STORE_INFO } from "./store-info";
import type { ReceiptData, SaleForReceipt, VatBreakdownRow } from "./types";

/**
 * Pure sale → receipt transform. Every renderer (80mm print view, PDF,
 * and the future ESC/POS driver) consumes ReceiptData; none of them ever
 * touch the database row shape.
 *
 * VAT is re-derived PER LINE — round(gross / (1 + rate)), exactly like
 * create_sale — then summed by rate. Extracting from a per-rate gross sum
 * would round differently and drift from sale.tax_total.
 */
export function buildReceipt(sale: SaleForReceipt): ReceiptData {
  const byRate = new Map<number, VatBreakdownRow>();
  for (const item of sale.sale_items) {
    const rateBp = Math.round(Number(item.tax_rate) * 10000);
    const gross = Number(item.line_total);
    const net = extractNet(gross, rateBp);
    const row = byRate.get(rateBp) ?? { rateBp, net: 0, tax: 0 };
    row.net += net;
    row.tax += gross - net;
    byRate.set(rateBp, row);
  }

  return {
    store: STORE_INFO,
    saleId: sale.id,
    saleNumber: Number(sale.sale_number),
    createdAt: sale.created_at,
    cashierName: sale.profiles?.full_name ?? null,
    paymentMethod: sale.payment_method,
    lines: sale.sale_items.map((i) => ({
      nameAr: i.name_ar,
      nameEn: i.name_en,
      qty: Number(i.qty),
      unitPrice: Number(i.unit_price),
      lineDiscount: Number(i.line_discount),
      lineTotal: Number(i.line_total),
    })),
    vatBreakdown: [...byRate.values()].sort((a, b) => a.rateBp - b.rateBp),
    subtotal: Number(sale.subtotal),
    taxTotal: Number(sale.tax_total),
    discountTotal: Number(sale.discount_total),
    total: Number(sale.total),
    amountTendered: sale.amount_tendered === null ? null : Number(sale.amount_tendered),
    changeDue: sale.change_due === null ? null : Number(sale.change_due),
    qrValue: String(sale.sale_number),
  };
}
