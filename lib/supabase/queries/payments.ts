import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Database, Tables } from "@/lib/supabase/database.types";

export type Payment = Tables<"payments">;
export type TenderSummaryRow = Database["public"]["Functions"]["report_tender_summary"]["Returns"][number];
export type ReconciliationIssue = Database["public"]["Functions"]["report_payment_reconciliation"]["Returns"][number];

/** Why a payment needs a human, or null when it is settled. */
export function attentionReason(payment: Payment): "pending" | "orphan" | "refundPending" | "refundFailed" | null {
  if (payment.resolved_at) return null;
  if (payment.direction === "charge") {
    if (payment.status === "pending" || payment.status === "authorized") return "pending";
    if (payment.status === "captured" && payment.sale_id === null) return "orphan";
    return null;
  }
  if (payment.status === "pending" || payment.status === "authorized") return "refundPending";
  if (payment.status !== "captured") return "refundFailed";
  return null;
}

/** RLS decides what the caller sees: admins everything, cashiers their own payments. */
export async function getRecentPayments(limit = 200): Promise<Payment[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("payments").select("*").order("created_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function getTenderSummary(fromIso: string, toIso: string): Promise<TenderSummaryRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("report_tender_summary", { p_from: fromIso, p_to: toIso });
  if (error) throw error;
  return data ?? [];
}

export async function getReconciliationIssues(fromIso: string, toIso: string): Promise<ReconciliationIssue[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("report_payment_reconciliation", { p_from: fromIso, p_to: toIso });
  if (error) throw error;
  return data ?? [];
}
