import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { createPosTools, type PosData } from "./pos-tools";

function safeFilter(query: string): string {
  return query.replace(/[,()"\\%]/g, " ").trim();
}

/**
 * Read-only POS data for the assistant, through the CALLER'S session: Row
 * Level Security decides what comes back (a cashier only sees their own
 * sales). Results are capped so a tool can never dump a table.
 */
export function createPosExecutors(supabase: SupabaseClient<Database>) {
  const data: PosData = {
    async findActiveProducts(query) {
      const safe = safeFilter(query);
      if (!safe) return [];
      const { data: rows, error } = await supabase
        .from("products")
        .select("barcode, name_ar, name_en, price, stock_qty, low_stock_threshold, unit")
        .eq("active", true)
        .or(`name_ar.ilike.%${safe}%,name_en.ilike.%${safe}%,barcode.ilike.%${safe}%`)
        .limit(5);
      if (error) throw new Error("product lookup failed");
      return (rows ?? []).map((p) => ({
        barcode: p.barcode,
        nameAr: p.name_ar,
        nameEn: p.name_en,
        pricePiasters: Number(p.price),
        stockQty: Number(p.stock_qty),
        lowStockThreshold: Number(p.low_stock_threshold),
        unit: p.unit,
      }));
    },
    async getTodaySales() {
      // today = the store's business day (Cairo), not the UTC date
      const { data: today, error: dayError } = await supabase.rpc("business_day", { ts: new Date().toISOString() });
      if (dayError || !today) throw new Error("business day lookup failed");
      const day = String(today).slice(0, 10);
      const { data: range, error: rangeError } = await supabase.rpc("business_day_range", { p_from_day: day, p_to_day: day });
      if (rangeError || !range?.[0]) throw new Error("business day lookup failed");
      const { data: sales, error } = await supabase
        .from("sales")
        .select("total, sale_items(name_ar, name_en, qty, line_total)")
        .gte("created_at", range[0].range_start)
        .lte("created_at", range[0].range_end)
        .limit(500);
      if (error) throw new Error("sales lookup failed");
      return (sales ?? []).map((s) => ({
        totalPiasters: Number(s.total),
        items: (s.sale_items ?? []).map((i) => ({
          nameAr: i.name_ar,
          nameEn: i.name_en,
          qty: Number(i.qty),
          lineTotalPiasters: Number(i.line_total),
        })),
      }));
    },
  };
  return createPosTools(data);
}
