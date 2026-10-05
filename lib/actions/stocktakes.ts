"use server";

import { revalidatePath } from "next/cache";
import { routing } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import {
  approveStocktakeSchema,
  createStocktakeSchema,
  saveCountsSchema,
  stocktakeIdSchema,
} from "@/lib/validation/stocktake";
import type { ActionResult } from "./result";
import { requireAdminAction } from "./guard";

function stocktakeError(message: string): string {
  if (message.includes("capability required") || message.includes("admin only")) return "notAuthorized";
  if (message.includes("unresolved conflicts")) return "stocktakeConflicts";
  if (message.includes("reason is required")) return "stocktakeReasonRequired";
  if (message.includes("whole number")) return "wholeNumberRequired";
  if (message.includes("no products in scope")) return "stocktakeEmptyScope";
  if (message.includes("not open") || message.includes("not submitted") || message.includes("already")) {
    return "stocktakeWrongState";
  }
  if (message.includes("nothing has been counted")) return "stocktakeNothingCounted";
  return "stocktakeFailed";
}

function revalidate(id?: string) {
  for (const locale of routing.locales) {
    revalidatePath(`/${locale}/stocktakes`);
    if (id) revalidatePath(`/${locale}/stocktakes/${id}`);
    revalidatePath(`/${locale}/products`);
  }
}

export async function createStocktake(input: unknown): Promise<ActionResult<{ stocktakeId: string }>> {
  const parsed = createStocktakeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalidInput" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_stocktake", {
    p_scope: parsed.data.scope,
    p_category_id: parsed.data.categoryId,
    p_note: parsed.data.note,
  });
  if (error || !data) return { ok: false, error: stocktakeError(error?.message ?? "") };
  revalidate();
  return { ok: true, data: { stocktakeId: data } };
}

export async function saveStocktakeCounts(input: unknown): Promise<ActionResult> {
  const parsed = saveCountsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalidInput" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_stocktake_counts", {
    p_stocktake_id: parsed.data.stocktakeId,
    p_counts: parsed.data.counts.map((entry) => ({
      product_id: entry.productId,
      counted_qty: entry.countedQty,
      reason: entry.reason ?? null,
    })),
  });
  if (error) return { ok: false, error: stocktakeError(error.message) };
  return { ok: true, data: undefined };
}

async function transition(
  input: unknown,
  rpc: "submit_stocktake" | "reopen_stocktake" | "cancel_stocktake"
): Promise<ActionResult> {
  const parsed = stocktakeIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalidInput" };
  const supabase = await createClient();
  const { error } = await supabase.rpc(rpc, { p_stocktake_id: parsed.data.stocktakeId });
  if (error) return { ok: false, error: stocktakeError(error.message) };
  revalidate(parsed.data.stocktakeId);
  return { ok: true, data: undefined };
}

export async function submitStocktake(input: unknown): Promise<ActionResult> {
  return transition(input, "submit_stocktake");
}

export async function reopenStocktake(input: unknown): Promise<ActionResult> {
  const denied = await requireAdminAction();
  if (denied) return denied;
  return transition(input, "reopen_stocktake");
}

export async function cancelStocktake(input: unknown): Promise<ActionResult> {
  return transition(input, "cancel_stocktake");
}

export async function approveStocktake(input: unknown): Promise<ActionResult<{ adjusted: number }>> {
  const denied = await requireAdminAction();
  if (denied) return denied;
  const parsed = approveStocktakeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalidInput" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("approve_stocktake", {
    p_stocktake_id: parsed.data.stocktakeId,
    p_resolutions: parsed.data.resolutions,
  });
  if (error) return { ok: false, error: stocktakeError(error.message) };
  revalidate(parsed.data.stocktakeId);
  return { ok: true, data: { adjusted: data ?? 0 } };
}
