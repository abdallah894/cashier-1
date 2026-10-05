"use server";

import { revalidatePath } from "next/cache";
import { routing } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import {
  createCustomerSchema,
  customerConsentSchema,
  customerIdSchema,
  findCustomerSchema,
} from "@/lib/validation/customers";
import type { ActionResult } from "./result";

export type CustomerChip = { id: string; name: string; phoneLast4: string };

function customerError(message: string): string {
  if (message.includes("already registered")) return "customerPhoneTaken";
  if (message.includes("valid phone")) return "customerPhoneInvalid";
  if (message.includes("name is required")) return "invalidInput";
  if (message.includes("capability required")) return "notAuthorized";
  if (message.includes("not found")) return "customerNotFound";
  if (message.includes("already anonymized")) return "customerAlreadyAnonymized";
  return "customerFailed";
}

function revalidate(id?: string) {
  for (const locale of routing.locales) {
    revalidatePath(`/${locale}/customers`);
    if (id) revalidatePath(`/${locale}/customers/${id}`);
  }
}

/** Exact-phone lookup for the register; returns a minimal chip, never the full profile. */
export async function findCustomer(input: unknown): Promise<ActionResult<CustomerChip | null>> {
  const parsed = findCustomerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "customerPhoneInvalid" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("find_customer", { p_phone: parsed.data.phone });
  if (error) return { ok: false, error: customerError(error.message) };
  const row = data?.[0];
  return { ok: true, data: row ? { id: row.id, name: row.name, phoneLast4: row.phone_last4 } : null };
}

export async function registerCustomer(input: unknown): Promise<ActionResult<CustomerChip>> {
  const parsed = createCustomerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalidInput" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_customer", {
    p_name: parsed.data.name,
    p_phone: parsed.data.phone,
    p_email: parsed.data.email,
    p_marketing_consent: parsed.data.marketingConsent,
    p_consent_source: "register",
  });
  if (error || !data) return { ok: false, error: customerError(error?.message ?? "") };
  revalidate();
  return {
    ok: true,
    data: { id: data, name: parsed.data.name, phoneLast4: parsed.data.phone.replace(/\D/g, "").slice(-4) },
  };
}

export async function setCustomerConsent(input: unknown): Promise<ActionResult> {
  const parsed = customerConsentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalidInput" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_customer_consent", {
    p_customer_id: parsed.data.customerId,
    p_consent: parsed.data.consent,
    p_source: parsed.data.source,
  });
  if (error) return { ok: false, error: customerError(error.message) };
  revalidate(parsed.data.customerId);
  return { ok: true, data: undefined };
}

export async function anonymizeCustomer(input: unknown): Promise<ActionResult> {
  const parsed = customerIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalidInput" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("anonymize_customer", { p_customer_id: parsed.data.customerId });
  if (error) return { ok: false, error: customerError(error.message) };
  revalidate(parsed.data.customerId);
  return { ok: true, data: undefined };
}
