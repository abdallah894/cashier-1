import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Database, Tables } from "@/lib/supabase/database.types";

export type Customer = Tables<"customers">;
export type PurchaseHistoryRow = Database["public"]["Functions"]["customer_purchase_history"]["Returns"][number];

function escapeFilter(q: string): string {
  return q.replace(/[,()"\\%]/g, " ").trim();
}

export async function getCustomers(q?: string): Promise<Customer[]> {
  const supabase = await createClient();
  let query = supabase.from("customers").select("*").order("created_at", { ascending: false }).limit(100);
  const safe = q ? escapeFilter(q) : "";
  if (safe) query = query.or(`name.ilike.%${safe}%,phone.ilike.%${safe.replace(/\D/g, "") || safe}%`);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function getCustomerDetail(id: string) {
  const supabase = await createClient();
  const { data: customer, error } = await supabase.from("customers").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!customer) return null;
  const [{ data: history }, { data: consentEvents }] = await Promise.all([
    supabase.rpc("customer_purchase_history", { p_customer_id: id }),
    supabase
      .from("customer_consent_events")
      .select("id, consent, source, recorded_at")
      .eq("customer_id", id)
      .order("recorded_at", { ascending: false }),
  ]);
  return { customer, history: history ?? [], consentEvents: consentEvents ?? [] };
}
