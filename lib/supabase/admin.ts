import "server-only";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "./env";
import type { Database } from "./database.types";

/**
 * Service-role client — bypasses RLS and can mint sessions. Server-only;
 * stateless (no cookies, no session persistence). Used for: PIN verify/set,
 * admin user CRUD, and generating the PIN-switch magic link.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set (server env, never NEXT_PUBLIC)");
  }
  return createClient<Database>(SUPABASE_URL, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
