import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Database, Tables } from "@/lib/supabase/database.types";
import { storeInfoFromSettings } from "@/lib/receipts/store-info";
import type { StoreInfo } from "@/lib/receipts/types";
import { businessToday, type DateRange } from "./reports";

type Fn<K extends keyof Database["public"]["Functions"]> = Database["public"]["Functions"][K]["Returns"];

export type DailyRow = Fn<"report_daily_summary">[number];
export type VatRow = Fn<"report_vat">[number];
export type RefundRow = Fn<"report_refunds_detail">[number];
export type VoidRow = Fn<"report_voids_detail">[number];
export type MovementRow = Fn<"report_stock_movements">[number];
export type ValuationRow = Fn<"report_stock_valuation">[number];
export type AgingRow = Fn<"report_stock_aging">[number];
export type SuggestionRow = Fn<"report_reorder_suggestions">[number];
export type StoreSettings = Tables<"store_settings">;
export type ReorderAlert = Tables<"reorder_alerts"> & { name_ar: string; name_en: string; barcode: string };

const args = ({ from, to }: DateRange) => ({ p_from_day: from, p_to_day: to });

/** Business-day range from the URL, defaulting to the last 7 business days. */
export async function rangeFromParams(sp: { from?: string; to?: string }): Promise<DateRange> {
  const isDay = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
  const today = await businessToday();
  const start = new Date(`${today}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 6);
  const from = isDay(sp.from) ?? start.toISOString().slice(0, 10);
  const to = isDay(sp.to) ?? today;
  return from <= to ? { from, to } : { from: to, to: from };
}

export async function getDailySummary(range: DateRange): Promise<DailyRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("report_daily_summary", args(range));
  if (error) throw error;
  return data ?? [];
}

export async function getVat(range: DateRange): Promise<VatRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("report_vat", args(range));
  if (error) throw error;
  return data ?? [];
}

export async function getRefundsDetail(range: DateRange): Promise<RefundRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("report_refunds_detail", args(range));
  if (error) throw error;
  return data ?? [];
}

export async function getVoidsDetail(range: DateRange): Promise<VoidRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("report_voids_detail", args(range));
  if (error) throw error;
  return data ?? [];
}

export async function getStockMovements(range: DateRange): Promise<MovementRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("report_stock_movements", args(range));
  if (error) throw error;
  return data ?? [];
}

export async function getStockValuation(): Promise<ValuationRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("report_stock_valuation");
  if (error) throw error;
  return data ?? [];
}

export async function getStockAging(asOfDay?: string): Promise<AgingRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("report_stock_aging", { p_as_of_day: asOfDay });
  if (error) throw error;
  return data ?? [];
}

export async function getReorderSuggestions(): Promise<SuggestionRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("report_reorder_suggestions");
  if (error) throw error;
  return data ?? [];
}

/** Store identity for receipts and Z-reports, from store_settings (neutral defaults until the owner fills it in). */
export async function getStoreInfo(): Promise<StoreInfo> {
  return storeInfoFromSettings(await getStoreSettings());
}

export async function getStoreSettings(): Promise<StoreSettings> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("store_settings").select("*").eq("id", true).single();
  if (error) throw error;
  return data;
}

/** Live (not resolved) alerts with the product names, newest first. */
export async function getReorderAlerts(): Promise<ReorderAlert[]> {
  const supabase = await createClient();
  const { data: alerts, error } = await supabase
    .from("reorder_alerts")
    .select("*")
    .neq("status", "resolved")
    .order("opened_at", { ascending: false });
  if (error) throw error;
  const ids = [...new Set((alerts ?? []).map((alert) => alert.product_id))];
  if (ids.length === 0) return [];
  const { data: products, error: productsError } = await supabase
    .from("products")
    .select("id, name_ar, name_en, barcode")
    .in("id", ids);
  if (productsError) throw productsError;
  const byId = new Map((products ?? []).map((product) => [product.id, product]));
  return (alerts ?? []).map((alert) => ({
    ...alert,
    name_ar: byId.get(alert.product_id)?.name_ar ?? "",
    name_en: byId.get(alert.product_id)?.name_en ?? "",
    barcode: byId.get(alert.product_id)?.barcode ?? "",
  }));
}

export async function getOpenPurchaseOrdersForProduct(productId: string): Promise<{ id: string; po_number: number }[]> {
  const supabase = await createClient();
  const { data: lines } = await supabase.from("purchase_order_lines").select("po_id").eq("product_id", productId);
  const ids = [...new Set((lines ?? []).map((line) => line.po_id))];
  if (ids.length === 0) return [];
  const { data } = await supabase
    .from("purchase_orders")
    .select("id, po_number, status")
    .in("id", ids)
    .in("status", ["draft", "ordered", "partially_received"]);
  return (data ?? []).map((order) => ({ id: order.id, po_number: order.po_number }));
}
