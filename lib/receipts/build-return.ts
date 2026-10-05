import { STORE_INFO } from "./store-info";

export type ReturnReceiptSource = {
  id: string;
  return_number: number;
  refund_total: number;
  refund_tender: "cash" | "card" | "split";
  restock: boolean;
  reason: string;
  created_at: string;
  sales: { sale_number: number };
  profiles: { full_name: string } | null;
  return_items: {
    name_ar: string;
    name_en: string;
    qty: number;
    unit_price: number;
    line_refund_total: number;
  }[];
};

export type ReturnReceiptData = {
  store: typeof STORE_INFO;
  returnId: string;
  returnNumber: number;
  originalSaleNumber: number;
  refundTotal: number;
  refundTender: "cash" | "card" | "split";
  restocked: boolean;
  reason: string;
  createdAt: string;
  cashierName: string | null;
  lines: ReturnReceiptSource["return_items"];
};

export function buildReturnReceipt(source: ReturnReceiptSource): ReturnReceiptData {
  return {
    store: STORE_INFO,
    returnId: source.id,
    returnNumber: Number(source.return_number),
    originalSaleNumber: Number(source.sales.sale_number),
    refundTotal: Number(source.refund_total),
    refundTender: source.refund_tender,
    restocked: source.restock,
    reason: source.reason,
    createdAt: source.created_at,
    cashierName: source.profiles?.full_name ?? null,
    lines: source.return_items.map((item) => ({
      ...item,
      qty: Number(item.qty),
      unit_price: Number(item.unit_price),
      line_refund_total: Number(item.line_refund_total),
    })),
  };
}
