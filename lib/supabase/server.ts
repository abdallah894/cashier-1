import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./env";
import type { Database } from "./database.types";

// Server Component / Route Handler / Server Action client.
// Reads the auth session from request cookies; must be created per request
// (never a module-level singleton — requests must not share sessions).
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component, where cookies are read-only.
          // Safe to ignore: session refresh is handled in proxy/middleware
          // or a Server Action.
        }
      },
    },
  });
}
