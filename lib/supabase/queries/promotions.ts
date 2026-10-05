import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/lib/supabase/database.types";

export type Promotion = Tables<"promotions"> & { redemptions: number; redeemed: number };

/** All promotions with how often and for how much each has been redeemed. */
export async function getPromotions(): Promise<Promotion[]> {
  const supabase = await createClient();
  const [{ data: promotions, error }, { data: redemptions, error: redemptionsError }] = await Promise.all([
    supabase.from("promotions").select("*").order("created_at", { ascending: false }),
    supabase.from("promotion_redemptions").select("promotion_id, amount"),
  ]);
  if (error) throw error;
  if (redemptionsError) throw redemptionsError;
  const totals = new Map<string, { count: number; amount: number }>();
  for (const row of redemptions ?? []) {
    const entry = totals.get(row.promotion_id) ?? { count: 0, amount: 0 };
    entry.count += 1;
    entry.amount += Number(row.amount);
    totals.set(row.promotion_id, entry);
  }
  return (promotions ?? []).map((promotion) => ({
    ...promotion,
    redemptions: totals.get(promotion.id)?.count ?? 0,
    redeemed: totals.get(promotion.id)?.amount ?? 0,
  }));
}
