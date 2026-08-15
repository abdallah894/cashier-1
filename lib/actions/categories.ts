"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { routing } from "@/i18n/routing";
import { categoryInputSchema } from "@/lib/validation/product";
import { mapDbError, type ActionResult } from "./result";

function revalidateCategories() {
  for (const locale of routing.locales) {
    revalidatePath(`/${locale}/categories`);
    revalidatePath(`/${locale}/products`);
  }
}

export async function createCategory(input: unknown): Promise<ActionResult> {
  const parsed = categoryInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalidInput" };

  const supabase = await createClient();
  const { error } = await supabase.from("categories").insert(parsed.data);
  if (error) return { ok: false, error: mapDbError(error) };

  revalidateCategories();
  return { ok: true, data: undefined };
}

export async function updateCategory(id: string, input: unknown): Promise<ActionResult> {
  const parsed = categoryInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalidInput" };

  const supabase = await createClient();
  const { error, count } = await supabase
    .from("categories")
    .update(parsed.data, { count: "exact" })
    .eq("id", id);
  if (error) return { ok: false, error: mapDbError(error) };
  if (count === 0) return { ok: false, error: "notAuthorized" };

  revalidateCategories();
  return { ok: true, data: undefined };
}

export async function deleteCategory(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  // products.category_id is ON DELETE SET NULL — products survive.
  const { error, count } = await supabase
    .from("categories")
    .delete({ count: "exact" })
    .eq("id", id);
  if (error) return { ok: false, error: mapDbError(error) };
  if (count === 0) return { ok: false, error: "notAuthorized" };

  revalidateCategories();
  return { ok: true, data: undefined };
}
