"use server";

import { revalidatePath } from "next/cache";
import { routing } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import {
  createPurchaseOrderSchema,
  purchaseOrderIdSchema,
  receivePurchaseOrderSchema,
  supplierSchema,
  updateSupplierSchema,
} from "@/lib/validation/purchasing";
import type { ActionResult } from "./result";

function purchasingError(message: string): string {
  if (message.includes("admin only") || message.includes("capability required")) return "notAuthorized";
  if (message.includes("exceeds the remaining")) return "receivingOverReceipt";
  if (message.includes("not open for receiving")) return "receivingNotOpen";
  if (message.includes("whole number")) return "wholeNumberRequired";
  if (message.includes("already received")) return "poAlreadyReceived";
  if (message.includes("only a")) return "poWrongState";
  if (message.includes("supplier not found")) return "supplierUnavailable";
  return "purchasingFailed";
}

function revalidate(poId?: string) {
  for (const locale of routing.locales) {
    revalidatePath(`/${locale}/purchase-orders`);
    if (poId) revalidatePath(`/${locale}/purchase-orders/${poId}`);
    revalidatePath(`/${locale}/products`);
    revalidatePath(`/${locale}/suppliers`);
  }
}

export async function createSupplier(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = supplierSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalidInput" };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("suppliers")
    .insert({
      name: parsed.data.name,
      phone: parsed.data.phone ?? null,
      email: parsed.data.email ?? null,
      tax_id: parsed.data.taxId ?? null,
      payment_terms: parsed.data.paymentTerms ?? null,
      notes: parsed.data.notes ?? null,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.code === "23505" ? "supplierDuplicate" : "notAuthorized" };
  revalidate();
  return { ok: true, data: { id: data.id } };
}

export async function updateSupplier(input: unknown): Promise<ActionResult> {
  const parsed = updateSupplierSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalidInput" };
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("suppliers")
    .update(
      {
        name: parsed.data.name,
        phone: parsed.data.phone ?? null,
        email: parsed.data.email ?? null,
        tax_id: parsed.data.taxId ?? null,
        payment_terms: parsed.data.paymentTerms ?? null,
        notes: parsed.data.notes ?? null,
        active: parsed.data.active,
      },
      { count: "exact" }
    )
    .eq("id", parsed.data.id);
  if (error) return { ok: false, error: error.code === "23505" ? "supplierDuplicate" : "unknown" };
  if (!count) return { ok: false, error: "notAuthorized" };
  revalidate();
  return { ok: true, data: undefined };
}

export async function createPurchaseOrder(input: unknown): Promise<ActionResult<{ poId: string }>> {
  const parsed = createPurchaseOrderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalidInput" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_purchase_order", {
    p_supplier_id: parsed.data.supplierId,
    p_lines: parsed.data.lines.map((line) => ({
      product_id: line.productId,
      ordered_qty: line.orderedQty,
      unit_cost: line.unitCost,
      ...(line.taxRate === undefined ? {} : { tax_rate: line.taxRate }),
    })),
    p_expected_date: parsed.data.expectedDate,
    p_note: parsed.data.note,
  });
  if (error || !data) return { ok: false, error: purchasingError(error?.message ?? "") };
  revalidate();
  return { ok: true, data: { poId: data } };
}

async function transition(
  input: unknown,
  rpc: "place_purchase_order" | "cancel_purchase_order" | "close_purchase_order"
): Promise<ActionResult> {
  const parsed = purchaseOrderIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalidInput" };
  const supabase = await createClient();
  const { error } = await supabase.rpc(rpc, { p_po_id: parsed.data.poId });
  if (error) return { ok: false, error: purchasingError(error.message) };
  revalidate(parsed.data.poId);
  return { ok: true, data: undefined };
}

export async function placePurchaseOrder(input: unknown): Promise<ActionResult> {
  return transition(input, "place_purchase_order");
}

export async function cancelPurchaseOrder(input: unknown): Promise<ActionResult> {
  return transition(input, "cancel_purchase_order");
}

export async function closePurchaseOrder(input: unknown): Promise<ActionResult> {
  return transition(input, "close_purchase_order");
}

export async function receivePurchaseOrder(input: unknown): Promise<ActionResult<{ receiptId: string }>> {
  const parsed = receivePurchaseOrderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalidInput" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("receive_purchase_order", {
    p_po_id: parsed.data.poId,
    p_lines: parsed.data.lines.map((line) => ({
      po_line_id: line.poLineId,
      qty: line.qty,
      ...(line.unitCost === undefined ? {} : { unit_cost: line.unitCost }),
    })),
    p_invoice_reference: parsed.data.invoiceReference,
    p_note: parsed.data.note,
    p_idempotency_key: parsed.data.idempotencyKey,
  });
  if (error || !data) return { ok: false, error: purchasingError(error?.message ?? "") };
  revalidate(parsed.data.poId);
  return { ok: true, data: { receiptId: data } };
}
