import "server-only";
import { createClient } from "@/lib/supabase/server";
import { normalizeDigits } from "@/lib/money";
import { boundsFor } from "@/lib/supabase/queries/reports";
import type { Tables } from "@/lib/supabase/database.types";
import type { SaleForReceipt } from "@/lib/receipts/types";

export type SaleWithItems = SaleForReceipt;

export type SaleReturn = Tables<"returns"> & {
  return_items: Tables<"return_items">[];
  profiles: Pick<Tables<"profiles">, "full_name"> | null;
};

export type SaleWithReturnHistory = SaleForReceipt & { returns: SaleReturn[] };

export async function getSaleWithItems(id: string): Promise<SaleWithReturnHistory | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sales")
    .select("*, sale_items(*), profiles(full_name), returns(*, return_items(*), profiles(full_name))")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data as SaleWithReturnHistory | null;
}

export type ReturnForReceipt = Tables<"returns"> & {
  sales: Pick<Tables<"sales">, "sale_number">;
  profiles: Pick<Tables<"profiles">, "full_name"> | null;
  return_items: Pick<
    Tables<"return_items">,
    "name_ar" | "name_en" | "qty" | "unit_price" | "line_refund_total"
  >[];
};

export async function getReturnWithItems(id: string): Promise<ReturnForReceipt | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("returns")
    .select("*, sales(sale_number), profiles(full_name), return_items(name_ar, name_en, qty, unit_price, line_refund_total)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data as ReturnForReceipt | null;
}

export const SALES_PAGE_SIZE = 20;

export type SalesListParams = {
  /** sale_number search — digits, Arabic-Indic accepted */
  q?: string;
  /** inclusive YYYY-MM-DD business-day bounds (store timezone, DST-aware). */
  from?: string;
  to?: string;
  cashierId?: string;
  page?: number;
};

export type SaleListRow = Tables<"sales"> & {
  profiles: Pick<Tables<"profiles">, "full_name"> | null;
  sale_items: { count: number }[];
};

export async function getSales({ q, from, to, cashierId, page = 1 }: SalesListParams) {
  const supabase = await createClient();
  let query = supabase
    .from("sales")
    .select("*, profiles(full_name), sale_items(count)", { count: "exact" });

  if (q?.trim()) {
    const n = Number(normalizeDigits(q.trim()));
    // a non-numeric query can never match a sale_number
    query = query.eq("sale_number", Number.isSafeInteger(n) && n > 0 ? n : -1);
  }
  if (from) query = query.gte("created_at", (await boundsFor({ from, to: from })).p_from);
  if (to) query = query.lte("created_at", (await boundsFor({ from: to, to })).p_to);
  if (cashierId) query = query.eq("cashier_id", cashierId);

  const fromRow = (page - 1) * SALES_PAGE_SIZE;
  const { data, count, error } = await query
    .order("created_at", { ascending: false })
    .range(fromRow, fromRow + SALES_PAGE_SIZE - 1);
  if (error) throw error;
  return {
    rows: (data ?? []) as SaleListRow[],
    total: count ?? 0,
    page,
    pageCount: Math.max(1, Math.ceil((count ?? 0) / SALES_PAGE_SIZE)),
  };
}

/** Cashier filter options. RLS trims this to the caller's own profile for
 *  non-admins, so cashiers effectively filter within their own sales. */
export async function getCashiers(): Promise<Pick<Tables<"profiles">, "id" | "full_name">[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name")
    .order("full_name");
  if (error) throw error;
  return data ?? [];
}

/** Tenders a sale was actually paid with (a split sale has more than one); refunds must use one of them. */
export async function getSaleTenders(id: string): Promise<("cash" | "card")[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("payments")
    .select("tender")
    .eq("sale_id", id)
    .eq("direction", "charge")
    .eq("status", "captured");
  if (error) throw error;
  const tenders = new Set<"cash" | "card">();
  for (const row of data ?? []) if (row.tender === "cash" || row.tender === "card") tenders.add(row.tender);
  return [...tenders];
}
