import "server-only";
import { createClient } from "@/lib/supabase/server";

export const AUDIT_PAGE_SIZE = 50;

/** Newest first, optionally one kind of action, a page at a time. */
export async function getAuditEvents({ action, page = 1 }: { action?: string; page?: number } = {}) {
  const supabase = await createClient();
  let query = supabase
    .from("audit_events")
    .select("id, action, target_type, target_id, metadata, created_at, profiles!audit_events_actor_id_fkey(full_name)", {
      count: "exact",
    })
    .order("created_at", { ascending: false });
  if (action) query = query.eq("action", action);
  const from = (page - 1) * AUDIT_PAGE_SIZE;
  const { data, count, error } = await query.range(from, from + AUDIT_PAGE_SIZE - 1);
  if (error) throw error;
  return {
    rows: data ?? [],
    total: count ?? 0,
    page,
    pageCount: Math.max(1, Math.ceil((count ?? 0) / AUDIT_PAGE_SIZE)),
  };
}
