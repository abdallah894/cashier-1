import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./env";
import type { Database } from "./database.types";

// Browser (Client Component) Supabase client. Singleton per tab —
// createBrowserClient caches internally, so calling this repeatedly is fine.
export function createClient() {
  return createBrowserClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
}
