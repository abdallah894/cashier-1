import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/lib/supabase/database.types";

export type Shift = Tables<"shifts">;
export type ShiftListRow = Shift & {
  profiles: Pick<Tables<"profiles">, "full_name"> | null;
};

/** The signed-in user's OWN open shift (admins also only get their own —
 *  an explicit cashier_id filter, since RLS shows admins everyone's). */
export async function getActiveShift(): Promise<Shift | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("shifts")
    .select("*")
    .eq("cashier_id", user.id)
    .is("closed_at", null)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export const SHIFTS_PAGE_SIZE = 20;

/** History, newest first. RLS scopes: cashiers see own, admins see all. */
export async function getShifts(page = 1) {
  const supabase = await createClient();
  const from = (page - 1) * SHIFTS_PAGE_SIZE;
  const { data, count, error } = await supabase
    .from("shifts")
    .select("*, profiles(full_name)", { count: "exact" })
    .order("opened_at", { ascending: false })
    .range(from, from + SHIFTS_PAGE_SIZE - 1);
  if (error) throw error;
  return {
    rows: (data ?? []) as ShiftListRow[],
    total: count ?? 0,
    page,
    pageCount: Math.max(1, Math.ceil((count ?? 0) / SHIFTS_PAGE_SIZE)),
  };
}

/** Shift + per-method sale totals for the Z-report (from the sales rows,
 *  which are snapshot-priced — product edits never change a Z-report). */
export async function getShiftWithSales(id: string): Promise<{
  shift: ShiftListRow;
  cashSales: number;
  cardSales: number;
  saleCount: number;
  drawerEvents: Array<{ event_type: "paid_in" | "paid_out" | "safe_drop" | "cash_refund" | "cash_sale"; amount: number }>;
} | null> {
  const supabase = await createClient();
  const { data: shift, error } = await supabase
    .from("shifts")
    .select("*, profiles(full_name)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!shift) return null;

  const { data: sales, error: salesError } = await supabase
    .from("sales")
    .select("total, payment_method")
    .eq("shift_id", id);
  if (salesError) throw salesError;

  const { data: drawerEvents, error: drawerEventsError } = await supabase
    .from("cash_drawer_events")
    .select("event_type, amount")
    .eq("shift_id", id)
    .order("created_at");
  if (drawerEventsError) throw drawerEventsError;

  let cashSales = 0;
  let cardSales = 0;
  for (const sale of sales ?? []) {
    if (sale.payment_method === "cash") cashSales += Number(sale.total);
    else cardSales += Number(sale.total);
  }
  return {
    shift: shift as ShiftListRow,
    cashSales,
    cardSales,
    saleCount: (sales ?? []).length,
    drawerEvents: (drawerEvents ?? []).map((event) => ({
      event_type: event.event_type,
      amount: Number(event.amount),
    })),
  };
}
