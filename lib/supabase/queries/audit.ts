import "server-only";
import { createClient } from "@/lib/supabase/server";

export async function getAuditEvents() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("audit_events")
    .select("id, action, target_type, target_id, metadata, created_at, profiles!audit_events_actor_id_fkey(full_name)")
    .order("created_at", { ascending: false }).limit(100);
  if (error) throw error;
  return data ?? [];
}
