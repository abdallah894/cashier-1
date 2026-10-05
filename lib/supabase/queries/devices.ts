import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/lib/supabase/database.types";

export type Device = Tables<"devices">;
export type DeviceProfile = Tables<"device_profiles">;
export type PrintJob = Tables<"print_jobs">;

export type DeviceSettings = { vendorId?: number; productId?: number; columns?: number };

export function deviceSettings(device: Device): DeviceSettings {
  const raw = device.settings;
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as DeviceSettings) : {};
}

/** The till the signed-in cashier is working at: the till of their open shift, else the default till. */
export async function getCurrentTillId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: shift } = await supabase.from("shifts").select("till_id").eq("cashier_id", user.id).is("closed_at", null).maybeSingle();
  if (shift) return shift.till_id;
  const { data: till } = await supabase.from("tills").select("id").order("created_at").limit(1).maybeSingle();
  return till?.id ?? null;
}

export async function getTills(): Promise<Tables<"tills">[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("tills").select("*").order("created_at");
  if (error) throw error;
  return data ?? [];
}

export async function getDevices(tillId?: string): Promise<Device[]> {
  const supabase = await createClient();
  let query = supabase.from("devices").select("*").order("kind").order("name");
  if (tillId) query = query.eq("till_id", tillId);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function getDeviceProfiles(): Promise<DeviceProfile[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("device_profiles").select("*").order("kind").order("key");
  if (error) throw error;
  return data ?? [];
}

/** RLS: admins see every job, cashiers their own. */
export async function getRecentPrintJobs(limit = 50): Promise<PrintJob[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("print_jobs").select("*").order("created_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return data ?? [];
}

/** How many times a document has actually been printed (gift copies excluded). */
export async function getPrintedCount(documentType: PrintJob["document_type"], documentId: string): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("print_jobs")
    .select("id", { count: "exact", head: true })
    .eq("document_type", documentType)
    .eq("document_id", documentId)
    .eq("status", "printed")
    .neq("kind", "gift");
  if (error) throw error;
  return count ?? 0;
}
