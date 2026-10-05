import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

/** True when the signed-in user holds the capability (admins hold all). The RPCs stay authoritative. */
export async function hasCapability(capability: Database["public"]["Enums"]["capability"]): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("has_capability", { p_capability: capability });
  return data === true;
}
