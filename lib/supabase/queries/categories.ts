import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/lib/supabase/database.types";

export type Category = Tables<"categories">;

export async function getCategories(): Promise<Category[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("categories")
    .select("*")
    .order("sort_order")
    .order("name_en");
  if (error) throw error;
  return data ?? [];
}

/** Product count per category (for the manage screen + delete warnings). */
export async function getCategoryProductCounts(): Promise<Map<string, number>> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("products").select("category_id");
  if (error) throw error;
  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    if (row.category_id) counts.set(row.category_id, (counts.get(row.category_id) ?? 0) + 1);
  }
  return counts;
}
