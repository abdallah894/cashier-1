import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * Reporting queries — thin wrappers over the admin-only SQL aggregation
 * RPCs (supabase/migrations/20260714120000_reporting.sql). All GROUP BY
 * work stays in Postgres; these just pass the date range and return typed
 * rows. RLS/guard: the RPCs raise 42501 for non-admins.
 *
 * Range: `from`/`to` are YYYY-MM-DD business days (from the URL). The
 * database turns them into exact instants in the store timezone
 * (Africa/Cairo by default, DST-aware; see business_day_range), so a sale at
 * 00:30 Cairo time belongs to the right day.
 */

export type DateRange = { from: string; to: string };
export type Bucket = "day" | "week" | "month";
export type TopBy = "revenue" | "qty";

/** Business days (YYYY-MM-DD) → the exact inclusive instants they cover in the store timezone. */
export async function boundsFor({ from, to }: DateRange): Promise<{ p_from: string; p_to: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("business_day_range", { p_from_day: from, p_to_day: to });
  if (error) throw error;
  const row = data?.[0];
  if (!row) throw new Error("business_day_range returned nothing");
  return { p_from: row.range_start, p_to: row.range_end };
}

/** The store's current business day (YYYY-MM-DD). */
export async function businessToday(): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("business_day", { ts: new Date().toISOString() });
  if (error) throw error;
  return String(data).slice(0, 10);
}

/** Default range: the last 30 business days ending today. */
export async function defaultRange(): Promise<DateRange> {
  const today = await businessToday();
  const start = new Date(`${today}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 29);
  return { from: start.toISOString().slice(0, 10), to: today };
}

export type Summary = { revenue: number; refunds: number; netRevenue: number; saleCount: number; avgBasket: number };
export type TimePoint = { bucketStart: string; revenue: number; saleCount: number; avgBasket: number };
export type TopProduct = { productId: string; nameAr: string; nameEn: string; qty: number; revenue: number };
export type CategoryRow = {
  categoryId: string | null;
  nameAr: string | null;
  nameEn: string | null;
  qty: number;
  revenue: number;
};
export type CashierRow = { cashierId: string; fullName: string; revenue: number; saleCount: number };
export type Profit = { netRevenue: number; cost: number; profit: number; margin: number | null };

export async function getSummary(range: DateRange): Promise<Summary> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("report_summary", await boundsFor(range));
  if (error) throw error;
  const row = data?.[0];
  return {
    revenue: Number(row?.revenue ?? 0),
    refunds: Number(row?.refunds ?? 0),
    netRevenue: Number(row?.net_revenue ?? 0),
    saleCount: Number(row?.sale_count ?? 0),
    avgBasket: Number(row?.avg_basket ?? 0),
  };
}

export async function getSalesOverTime(range: DateRange, bucket: Bucket): Promise<TimePoint[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("report_sales_over_time", {
    ...(await boundsFor(range)),
    p_bucket: bucket,
  });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    bucketStart: r.bucket_start,
    revenue: Number(r.revenue),
    saleCount: Number(r.sale_count),
    avgBasket: Number(r.avg_basket),
  }));
}

export async function getTopProducts(range: DateRange, by: TopBy, limit = 10): Promise<TopProduct[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("report_top_products", {
    ...(await boundsFor(range)),
    p_by: by,
    p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    productId: r.product_id,
    nameAr: r.name_ar,
    nameEn: r.name_en,
    qty: Number(r.qty),
    revenue: Number(r.revenue),
  }));
}

export async function getSalesByCategory(range: DateRange): Promise<CategoryRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("report_sales_by_category", await boundsFor(range));
  if (error) throw error;
  return (data ?? []).map((r) => ({
    categoryId: r.category_id,
    nameAr: r.name_ar,
    nameEn: r.name_en,
    qty: Number(r.qty),
    revenue: Number(r.revenue),
  }));
}

export async function getSalesByCashier(range: DateRange): Promise<CashierRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("report_sales_by_cashier", await boundsFor(range));
  if (error) throw error;
  return (data ?? []).map((r) => ({
    cashierId: r.cashier_id,
    fullName: r.full_name,
    revenue: Number(r.revenue),
    saleCount: Number(r.sale_count),
  }));
}

export async function getProfit(range: DateRange): Promise<Profit> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("report_profit", await boundsFor(range));
  if (error) throw error;
  const row = data?.[0];
  return {
    netRevenue: Number(row?.net_revenue ?? 0),
    cost: Number(row?.cost ?? 0),
    profit: Number(row?.profit ?? 0),
    margin: row?.margin == null ? null : Number(row.margin),
  };
}
