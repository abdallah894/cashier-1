import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Database, Tables } from "@/lib/supabase/database.types";

export type Supplier = Tables<"suppliers">;
export type PurchaseOrder = Tables<"purchase_orders">;
export type PurchaseOrderLine = Tables<"purchase_order_lines">;
export type OutstandingRow = Database["public"]["Functions"]["report_outstanding_purchase_orders"]["Returns"][number];
export type ReceivedCostRow = Database["public"]["Functions"]["report_received_cost"]["Returns"][number];

export async function getSuppliers(): Promise<Supplier[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("suppliers").select("*").order("name");
  if (error) throw error;
  return data ?? [];
}

export async function getPurchaseOrders(): Promise<PurchaseOrder[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("purchase_orders")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return data ?? [];
}

export type PurchaseOrderDetail = {
  order: PurchaseOrder;
  lines: PurchaseOrderLine[];
  receipts: {
    id: string;
    receipt_number: number;
    invoice_reference: string | null;
    received_at: string;
    received_by: string;
    goods_receipt_lines: { receipt_id: string; po_line_id: string; qty: number; unit_cost: number }[];
  }[];
  overReceiptTolerancePct: number;
};

export async function getPurchaseOrder(id: string): Promise<PurchaseOrderDetail | null> {
  const supabase = await createClient();
  const { data: order, error } = await supabase.from("purchase_orders").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!order) return null;
  const [{ data: lines }, { data: receipts }, { data: settings }] = await Promise.all([
    supabase.from("purchase_order_lines").select("*").eq("po_id", id).order("name_en"),
    supabase
      .from("goods_receipts")
      .select("id, receipt_number, invoice_reference, received_at, received_by")
      .eq("po_id", id)
      .order("received_at", { ascending: false }),
    supabase.from("purchasing_settings").select("over_receipt_tolerance_pct").eq("id", true).maybeSingle(),
  ]);
  const receiptIds = (receipts ?? []).map((receipt) => receipt.id);
  const { data: receiptLines } = receiptIds.length
    ? await supabase.from("goods_receipt_lines").select("receipt_id, po_line_id, qty, unit_cost").in("receipt_id", receiptIds)
    : { data: [] };
  return {
    order,
    lines: lines ?? [],
    receipts: (receipts ?? []).map((receipt) => ({
      ...receipt,
      goods_receipt_lines: (receiptLines ?? []).filter((line) => line.receipt_id === receipt.id),
    })),
    overReceiptTolerancePct: Number(settings?.over_receipt_tolerance_pct ?? 0),
  };
}

export async function getOutstandingPurchaseOrders(): Promise<OutstandingRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("report_outstanding_purchase_orders");
  if (error) throw error;
  return data ?? [];
}

export async function getReceivedCost(fromIso: string, toIso: string): Promise<ReceivedCostRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("report_received_cost", { p_from: fromIso, p_to: toIso });
  if (error) throw error;
  return data ?? [];
}
