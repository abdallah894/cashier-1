"use server";

import { revalidatePath } from "next/cache";
import { routing } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import { createPromotionSchema, previewPromotionsSchema, togglePromotionSchema } from "@/lib/validation/promotions";
import type { ActionResult } from "./result";

export type PromotionPreview = {
  /** discount per cart line, aligned with the submitted items */
  perLine: number[];
  applied: { promotionId: string; nameAr: string; nameEn: string; code: string | null; discount: number }[];
};

function promotionError(message: string): string {
  if (message.includes("code not valid")) return "promoInvalid";
  if (message.includes("needs a customer")) return "promoNeedsCustomer";
  if (message.includes("minimum spend")) return "promoMinSpend";
  if (message.includes("redemption limit")) return "promoLimit";
  if (message.includes("no eligible items")) return "promoNoItems";
  if (message.includes("code already exists")) return "promoCodeTaken";
  if (message.includes("admin only")) return "notAuthorized";
  return "promoFailed";
}

/** Server-evaluated promotions for the cart: the same function create_sale uses, so the preview cannot drift. */
export async function previewPromotions(input: unknown): Promise<ActionResult<PromotionPreview>> {
  const parsed = previewPromotionsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalidInput" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("preview_promotions", {
    p_lines: parsed.data.items,
    p_customer_id: parsed.data.customerId,
    p_codes: parsed.data.codes,
  });
  if (error) return { ok: false, error: promotionError(error.message) };
  const perLine = parsed.data.items.map(() => 0);
  for (const row of data ?? []) perLine[row.line_idx] += Number(row.discount);
  const applied = new Map<string, PromotionPreview["applied"][number]>();
  for (const row of data ?? []) {
    const current = applied.get(row.promotion_id);
    if (current) current.discount += Number(row.discount);
    else
      applied.set(row.promotion_id, {
        promotionId: row.promotion_id,
        nameAr: row.name_ar,
        nameEn: row.name_en,
        code: row.code,
        discount: Number(row.discount),
      });
  }
  return { ok: true, data: { perLine, applied: [...applied.values()] } };
}

export async function createPromotion(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = createPromotionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalidInput" };
  const v = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_promotion", {
    p: {
      name_ar: v.nameAr,
      name_en: v.nameEn,
      code: v.code ?? null,
      scope: v.scope,
      discount_kind: v.discountKind,
      percent_bp: v.percentBp ?? null,
      fixed_amount: v.fixedAmount ?? null,
      category_id: v.categoryId ?? null,
      product_ids: v.productIds ?? [],
      min_spend: v.minSpend,
      starts_at: v.startsAt ?? null,
      ends_at: v.endsAt ?? null,
      customer_required: v.customerRequired,
      max_redemptions: v.maxRedemptions ?? null,
      max_per_customer: v.maxPerCustomer ?? null,
      stackable: v.stackable,
      priority: v.priority,
    },
  });
  if (error || !data) return { ok: false, error: promotionError(error?.message ?? "") };
  for (const locale of routing.locales) revalidatePath(`/${locale}/promotions`);
  return { ok: true, data: { id: data } };
}

export async function setPromotionActive(input: unknown): Promise<ActionResult> {
  const parsed = togglePromotionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalidInput" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_promotion_active", {
    p_promotion_id: parsed.data.promotionId,
    p_active: parsed.data.active,
  });
  if (error) return { ok: false, error: promotionError(error.message) };
  for (const locale of routing.locales) revalidatePath(`/${locale}/promotions`);
  return { ok: true, data: undefined };
}
