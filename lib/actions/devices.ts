"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { routing } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import {
  authorizeDrawerSchema,
  completeDrawerSchema,
  completePrintSchema,
  reportHealthSchema,
  requestPrintSchema,
  saveDeviceSchema,
} from "@/lib/validation/devices";
import type { ActionResult } from "./result";

function deviceError(message: string): string {
  if (message.includes("admin only")) return "notAuthorized";
  if (message.includes("not yours")) return "notAuthorized";
  if (message.includes("already printed")) return "printAlreadyPrinted";
  if (message.includes("reason is required")) return "printReasonRequired";
  if (message.includes("manager approval is required")) return "managerApprovalRequired";
  if (message.includes("not a cash sale") || message.includes("not a cash refund")) return "drawerNotCash";
  if (message.includes("too old")) return "drawerTooOld";
  if (message.includes("already authorized")) return "drawerAlreadyOpened";
  if (message.includes("no open shift")) return "noOpenShift";
  if (message.includes("not supported") || message.includes("does not match") || message.includes("unknown profile")) return "deviceProfileInvalid";
  return "deviceFailed";
}

function revalidate() {
  for (const locale of routing.locales) revalidatePath(`/${locale}/devices`);
}

export async function requestPrintJob(input: unknown): Promise<ActionResult<{ jobId: string; copyNumber: number }>> {
  const parsed = requestPrintSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalidInput" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("request_print", {
    p_document_type: parsed.data.documentType,
    p_document_id: parsed.data.documentId,
    p_kind: parsed.data.kind,
    p_reason: parsed.data.reason,
  });
  if (error || !data) return { ok: false, error: deviceError(error?.message ?? "") };
  const { data: job } = await supabase.from("print_jobs").select("copy_number").eq("id", data).single();
  return { ok: true, data: { jobId: data, copyNumber: Number(job?.copy_number ?? 1) } };
}

export async function completePrintJob(input: unknown): Promise<ActionResult> {
  const parsed = completePrintSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalidInput" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("complete_print_job", {
    p_job_id: parsed.data.jobId,
    p_ok: parsed.data.ok,
    p_error: parsed.data.error,
    p_device_id: parsed.data.deviceId,
  });
  if (error) return { ok: false, error: deviceError(error.message) };
  revalidate();
  return { ok: true, data: undefined };
}

/**
 * Authorises one drawer opening. A manual (no-sale) opening by someone
 * without the capability presents a manager PIN, which is turned into a
 * one-time approval bound to this shift and note.
 */
export async function authorizeDrawerOpen(input: unknown): Promise<ActionResult<{ openingId: string }>> {
  const parsed = authorizeDrawerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalidInput" };
  const supabase = await createClient();

  let approvalId = parsed.data.approvalId;
  const first = await supabase.rpc("authorize_drawer_open", {
    p_reason: parsed.data.reason,
    p_reference_id: parsed.data.referenceId,
    p_note: parsed.data.note,
    p_approval_id: approvalId,
  });
  if (!first.error && first.data) return { ok: true, data: { openingId: first.data } };

  if (first.error?.message.includes("manager approval is required") && parsed.data.managerPin && parsed.data.note) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data: shift } = await supabase.from("shifts").select("id").eq("cashier_id", user?.id ?? "").is("closed_at", null).maybeSingle();
    if (shift) {
      const hash = createHash("sha256").update(`drawer_open|${shift.id}|${parsed.data.note.trim()}`).digest("hex");
      const approval = await supabase.rpc("create_manager_approval", {
        p_action: "cash_drawer_event",
        p_request_hash: hash,
        p_pin: parsed.data.managerPin,
      });
      if (approval.error || !approval.data) return { ok: false, error: "managerApprovalRequired" };
      approvalId = approval.data;
      const second = await supabase.rpc("authorize_drawer_open", {
        p_reason: parsed.data.reason,
        p_reference_id: parsed.data.referenceId,
        p_note: parsed.data.note,
        p_approval_id: approvalId,
      });
      if (!second.error && second.data) return { ok: true, data: { openingId: second.data } };
      return { ok: false, error: deviceError(second.error?.message ?? "") };
    }
  }
  return { ok: false, error: deviceError(first.error?.message ?? "") };
}

export async function completeDrawerOpening(input: unknown): Promise<ActionResult> {
  const parsed = completeDrawerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalidInput" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("complete_drawer_opening", {
    p_id: parsed.data.openingId,
    p_ok: parsed.data.ok,
    p_error: parsed.data.error,
    p_device_id: parsed.data.deviceId,
  });
  if (error) return { ok: false, error: deviceError(error.message) };
  revalidate();
  return { ok: true, data: undefined };
}

export async function saveDevice(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = saveDeviceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalidInput" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("upsert_device", {
    p: {
      id: parsed.data.id ?? null,
      till_id: parsed.data.tillId,
      kind: parsed.data.kind,
      name: parsed.data.name,
      profile: parsed.data.profile,
      active: parsed.data.active,
      settings: parsed.data.settings,
    },
  });
  if (error || !data) return { ok: false, error: deviceError(error?.message ?? "") };
  revalidate();
  return { ok: true, data: { id: data } };
}

export async function reportDeviceHealth(input: unknown): Promise<ActionResult> {
  const parsed = reportHealthSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalidInput" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("report_device_health", {
    p_device_id: parsed.data.deviceId,
    p_health: parsed.data.health,
    p_detail: parsed.data.detail,
  });
  if (error) return { ok: false, error: deviceError(error.message) };
  revalidate();
  return { ok: true, data: undefined };
}
