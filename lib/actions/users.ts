"use server";

import { revalidatePath } from "next/cache";
import { routing } from "@/i18n/routing";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/supabase/queries/profiles";
import {
  createStaffSchema,
  setStaffPinSchema,
  setStaffRoleSchema,
  toggleStaffActiveSchema,
  setStaffCapabilitiesSchema,
} from "@/lib/validation/user";
import type { ActionResult } from "./result";

/** Actions return errors instead of redirecting — the UI shows a toast. */
async function currentAdminId(): Promise<string | null> {
  const profile = await getCurrentProfile();
  return profile?.role === "admin" && profile.active ? profile.id : null;
}

function revalidateUsers() {
  for (const locale of routing.locales) {
    revalidatePath(`/${locale}/users`);
  }
}

export async function createStaff(input: unknown): Promise<ActionResult<void>> {
  if (!(await currentAdminId())) return { ok: false, error: "notAuthorized" };
  const parsed = createStaffSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalidInput" };

  const admin = createAdminClient();
  const { data: created, error: authError } = await admin.auth.admin.createUser({
    email: parsed.data.email,
    password: parsed.data.password,
    email_confirm: true,
  });
  if (authError) {
    return {
      ok: false,
      error: authError.message.includes("already") ? "emailInUse" : "userCreateFailed",
    };
  }

  const { error: profileError } = await admin.from("profiles").insert({
    id: created.user.id,
    full_name: parsed.data.fullName,
    role: parsed.data.role,
  });
  if (profileError) {
    // keep auth + profile consistent: roll the auth user back
    await admin.auth.admin.deleteUser(created.user.id);
    return { ok: false, error: "userCreateFailed" };
  }

  if (parsed.data.pin) {
    const { error: pinError } = await admin.rpc("set_pin", {
      p_user_id: created.user.id,
      p_pin: parsed.data.pin,
    });
    if (pinError) return { ok: false, error: "userCreateFailed" };
  }

  revalidateUsers();
  return { ok: true, data: undefined };
}

export async function setStaffPin(input: unknown): Promise<ActionResult<void>> {
  if (!(await currentAdminId())) return { ok: false, error: "notAuthorized" };
  const parsed = setStaffPinSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalidInput" };

  const admin = createAdminClient();
  const { error } = await admin.rpc("set_pin", {
    p_user_id: parsed.data.userId,
    p_pin: parsed.data.pin,
  });
  if (error) return { ok: false, error: "unknown" };

  revalidateUsers();
  return { ok: true, data: undefined };
}

export async function setStaffRole(input: unknown): Promise<ActionResult<void>> {
  const adminId = await currentAdminId();
  if (!adminId) return { ok: false, error: "notAuthorized" };
  const parsed = setStaffRoleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalidInput" };
  if (parsed.data.userId === adminId) return { ok: false, error: "cannotEditSelf" };

  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ role: parsed.data.role })
    .eq("id", parsed.data.userId);
  if (error) return { ok: false, error: "unknown" };

  revalidateUsers();
  return { ok: true, data: undefined };
}

export async function toggleStaffActive(input: unknown): Promise<ActionResult<void>> {
  const adminId = await currentAdminId();
  if (!adminId) return { ok: false, error: "notAuthorized" };
  const parsed = toggleStaffActiveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalidInput" };
  if (parsed.data.userId === adminId) return { ok: false, error: "cannotEditSelf" };

  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ active: parsed.data.active })
    .eq("id", parsed.data.userId);
  if (error) return { ok: false, error: "unknown" };

  revalidateUsers();
  return { ok: true, data: undefined };
}

/** Replaces explicit grants; admins inherit all capabilities and need no rows. */
export async function setStaffCapabilities(input: unknown): Promise<ActionResult<void>> {
  const adminId = await currentAdminId();
  if (!adminId) return { ok: false, error: "notAuthorized" };
  const parsed = setStaffCapabilitiesSchema.safeParse(input);
  if (!parsed.success || parsed.data.userId === adminId) return { ok: false, error: "invalidInput" };
  const admin = createAdminClient();
  const { data: profile, error: profileError } = await admin
    .from("profiles").select("role").eq("id", parsed.data.userId).single();
  if (profileError || !profile || profile.role === "admin") return { ok: false, error: "invalidInput" };
  const { error: deleteError } = await admin.from("staff_capabilities").delete().eq("staff_id", parsed.data.userId);
  if (deleteError) return { ok: false, error: "unknown" };
  if (parsed.data.capabilities.length) {
    const { error } = await admin.from("staff_capabilities").insert(
      parsed.data.capabilities.map((capability) => ({ staff_id: parsed.data.userId, capability, granted_by: adminId }))
    );
    if (error) return { ok: false, error: "unknown" };
  }
  revalidateUsers();
  return { ok: true, data: undefined };
}
