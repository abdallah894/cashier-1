import "server-only";
import { getCurrentProfile } from "@/lib/supabase/queries/profiles";
import type { ActionResult } from "./result";

type Denied = Extract<ActionResult, { ok: false }>;

/**
 * Explicit admin gate for server actions. RLS and the RPCs enforce the same
 * rule in the database; this is the second line of defense so a policy mistake
 * can never expose an admin action. Also rejects deactivated accounts.
 * Usage: `const denied = await requireAdminAction(); if (denied) return denied;`
 * (Vue/Nuxt: like a server middleware check at the top of an API handler.)
 */
export async function requireAdminAction(): Promise<Denied | null> {
  const profile = await getCurrentProfile();
  if (profile?.role === "admin" && profile.active) return null;
  return { ok: false, error: "notAuthorized" };
}
