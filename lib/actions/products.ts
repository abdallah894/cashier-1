"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { routing } from "@/i18n/routing";
import { productInputSchema, stockAdjustmentSchema } from "@/lib/validation/product";
import { mapDbError, type ActionResult } from "./result";
import { requireAdminAction } from "./guard";

function revalidateProducts(id?: string) {
  for (const locale of routing.locales) {
    revalidatePath(`/${locale}/products`);
    if (id) revalidatePath(`/${locale}/products/${id}`);
  }
}

export async function createProduct(input: unknown): Promise<ActionResult<{ id: string }>> {
  const denied = await requireAdminAction();
  if (denied) return denied;
  const parsed = productInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalidInput" };

  const supabase = await createClient();
  const { data, error } = await supabase.from("products").insert(parsed.data).select("id").single();
  if (error) return { ok: false, error: mapDbError(error) };

  revalidateProducts();
  return { ok: true, data: { id: data.id } };
}

export async function updateProduct(id: string, input: unknown): Promise<ActionResult> {
  const denied = await requireAdminAction();
  if (denied) return denied;
  const parsed = productInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalidInput" };

  const supabase = await createClient();
  const { error, count } = await supabase
    .from("products")
    .update(parsed.data, { count: "exact" })
    .eq("id", id);
  if (error) return { ok: false, error: mapDbError(error) };
  // RLS silently matches 0 rows for non-admins — surface it.
  if (count === 0) return { ok: false, error: "notAuthorized" };

  revalidateProducts(id);
  return { ok: true, data: undefined };
}

export async function deleteProduct(id: string): Promise<ActionResult> {
  const denied = await requireAdminAction();
  if (denied) return denied;
  const supabase = await createClient();
  const { error, count } = await supabase.from("products").delete({ count: "exact" }).eq("id", id);
  // FK restrict from sale_items/stock_movements → suggest deactivating
  if (error) return { ok: false, error: mapDbError(error) };
  if (count === 0) return { ok: false, error: "notAuthorized" };

  revalidateProducts(id);
  return { ok: true, data: undefined };
}

export async function adjustStock(input: unknown): Promise<ActionResult<{ newQty: number }>> {
  const parsed = stockAdjustmentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalidInput" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("adjust_stock", {
    p_product_id: parsed.data.product_id,
    p_qty_change: parsed.data.qty_change,
    p_reason: parsed.data.reason,
    p_note: parsed.data.note || undefined,
    p_approval_id: parsed.data.approvalId || undefined,
  });
  if (error) return { ok: false, error: mapDbError(error) };

  revalidateProducts(parsed.data.product_id);
  return { ok: true, data: { newQty: Number(data) } };
}
