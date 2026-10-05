import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/lib/supabase/database.types";

export type Stocktake = Tables<"stocktakes">;
export type StocktakeItem = Tables<"stocktake_items">;

export async function getStocktakes(): Promise<Stocktake[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("stocktakes")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return data ?? [];
}

export async function getStocktake(id: string): Promise<{ stocktake: Stocktake; items: StocktakeItem[] } | null> {
  const supabase = await createClient();
  const { data: stocktake, error } = await supabase.from("stocktakes").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!stocktake) return null;
  const { data: items, error: itemsError } = await supabase
    .from("stocktake_items")
    .select("*")
    .eq("stocktake_id", id)
    .order("barcode");
  if (itemsError) throw itemsError;
  return { stocktake, items: items ?? [] };
}

export async function getStocktakeConflicts(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("stocktake_conflicts", { p_stocktake_id: id });
  if (error) throw error;
  return data ?? [];
}

export async function getStocktakeVarianceReport(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("stocktake_variance_report", { p_stocktake_id: id });
  if (error) throw error;
  return data ?? [];
}

/** True when the signed-in user may count stock (admins always can). */
export async function canCountStock(): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("has_capability", { p_capability: "stock.correct" });
  return data === true;
}
