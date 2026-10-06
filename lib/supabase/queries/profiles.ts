import "server-only";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Tables } from "@/lib/supabase/database.types";

export type Profile = Tables<"profiles">;

/** Signed-in user's profile, or null when logged out. */
export async function getCurrentProfile(): Promise<Profile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  return data;
}

/**
 * Admin gate for pages. RLS would return non-admins empty data anyway —
 * this just lands them somewhere useful instead of an empty screen.
 */
export async function requireAdmin(): Promise<Profile> {
  const profile = await getCurrentProfile();
  if (profile?.role === "admin" && profile.active) return profile;
  redirect({ href: "/register", locale: await getLocale() });
  throw new Error("unreachable"); // redirect throws
}

/**
 * Active, PIN-enabled cashiers for the switch dialog. Uses the service-role
 * client because RLS hides other profiles from cashiers — returns only
 * id + name (never hashes, never emails).
 */
export async function getSwitchableCashiers(): Promise<{ id: string; full_name: string }[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("profiles")
    .select("id, full_name")
    .eq("active", true)
    .eq("role", "cashier") // admins sign in with email + password, never by PIN
    .not("pin_hash", "is", null)
    .order("full_name");
  if (error) throw error;
  return data ?? [];
}
