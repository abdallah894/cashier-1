"use server";

import { z } from "zod";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { switchCashierSchema } from "@/lib/validation/user";
import { log } from "@/lib/observability/log";
import type { ActionResult } from "./result";

// Minimal auth for Phase 2 (products admin needs a session for RLS).
// Full auth — middleware route protection, role-based redirects, PIN
// switching — arrives in Phase 5.

const credentialsSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(6),
});

export type AuthState = {
  error?: "invalidInput" | "invalidCredentials" | "accountDisabled" | "signInUnavailable";
};

export async function signIn(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: "invalidInput" };
  }

  const supabase = await createClient();
  const { data: signedIn, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    return {
      error: error.code === "invalid_credentials" ? "invalidCredentials" : "signInUnavailable",
    };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, active")
    .eq("id", signedIn.user.id)
    .single();
  if (!profile || !profile.active) {
    await supabase.auth.signOut();
    return { error: "accountDisabled" };
  }

  redirect({
    href: profile.role === "admin" ? "/" : "/register",
    locale: await getLocale(),
  });
  return {}; // unreachable — redirect throws
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect({ href: "/login", locale: await getLocale() });
}

/**
 * PIN fast-switch: verify the PIN (service role), then mint a REAL session
 * for the target cashier — admin.generateLink(magiclink) produces a
 * token_hash we consume immediately with verifyOtp on the cookie client.
 * No email is ever sent. auth.uid() is the genuine cashier afterwards, so
 * RLS and create_sale attribution stay sound.
 */
export async function switchCashier(input: unknown): Promise<ActionResult<{ name: string }>> {
  const parsed = switchCashierSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalidInput" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "notAuthorized" }; // switch never starts a session

  const admin = createAdminClient();
  // The caller must still be an active member of staff: a deactivated account
  // with a live token cannot hop into someone else's session.
  const { data: caller } = await admin.from("profiles").select("active").eq("id", user.id).maybeSingle();
  if (!caller?.active) return { ok: false, error: "notAuthorized" };

  const { data: profile } = await admin
    .from("profiles")
    .select("full_name, active, role")
    .eq("id", parsed.data.targetUserId)
    .maybeSingle();
  // Quick PIN switching is for cashiers only. Admins sign in with email and
  // password: a 4-digit PIN must never open an admin session.
  if (!profile || !profile.active || profile.role !== "cashier") {
    log.warn("pin_switch_refused", { callerId: user.id, targetId: parsed.data.targetUserId });
    return { ok: false, error: "switchFailed" };
  }

  const { data: verdict, error: verifyError } = await admin.rpc("verify_pin", {
    p_user_id: parsed.data.targetUserId,
    p_pin: parsed.data.pin,
  });
  if (verifyError) return { ok: false, error: "switchFailed" };
  if (verdict === "locked") return { ok: false, error: "pinLocked" };
  if (verdict === "no_pin") return { ok: false, error: "pinNotSet" };
  if (verdict !== "ok") {
    log.warn("pin_switch_failed", { callerId: user.id, targetId: parsed.data.targetUserId });
    return { ok: false, error: "pinIncorrect" };
  }

  const { data: target, error: userError } = await admin.auth.admin.getUserById(
    parsed.data.targetUserId
  );
  if (userError || !target.user.email) return { ok: false, error: "switchFailed" };

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: target.user.email,
  });
  if (linkError) return { ok: false, error: "switchFailed" };

  const { error: otpError } = await supabase.auth.verifyOtp({
    type: "magiclink",
    token_hash: link.properties.hashed_token,
  });
  if (otpError) return { ok: false, error: "switchFailed" };

  return { ok: true, data: { name: profile.full_name } };
}
