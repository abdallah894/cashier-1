"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { routing } from "@/i18n/routing";
import { getExistingBarcodes } from "@/lib/supabase/queries/products";
import { getCategories } from "@/lib/supabase/queries/categories";
import { validateCsvRow, type RawCsvRow, type RowIssue } from "@/lib/validation/import";
import { mapDbError, type ActionResult } from "./result";
import type { ProductInput } from "@/lib/validation/product";

export type ImportRowResult = {
  /** 1-based data row number (matching the preview) */
  row: number;
  status: "inserted" | "skipped";
  issues: RowIssue[];
};

export type ImportSummary = {
  inserted: number;
  skipped: number;
  results: ImportRowResult[];
};

const MAX_ROWS = 500;

export async function importProducts(rows: RawCsvRow[]): Promise<ActionResult<ImportSummary>> {
  if (!Array.isArray(rows) || rows.length === 0) return { ok: false, error: "emptyFile" };
  if (rows.length > MAX_ROWS) return { ok: false, error: "tooManyRows" };

  const categories = await getCategories();
  const barcodes = rows.map((r) => (r.barcode ?? "").trim()).filter(Boolean);
  const existing = await getExistingBarcodes(barcodes);

  const seenInFile = new Set<string>();
  const results: ImportRowResult[] = [];
  const toInsert: { row: number; input: ProductInput }[] = [];

  rows.forEach((raw, index) => {
    const rowNumber = index + 1;
    const { input, issues } = validateCsvRow(raw, categories);

    if (input) {
      if (existing.has(input.barcode)) {
        issues.push({ field: "barcode", message: "duplicateBarcode" });
      } else if (seenInFile.has(input.barcode)) {
        issues.push({ field: "barcode", message: "duplicateInFile" });
      } else {
        seenInFile.add(input.barcode);
      }
    }

    if (input && issues.length === 0) {
      toInsert.push({ row: rowNumber, input });
    } else {
      results.push({ row: rowNumber, status: "skipped", issues });
    }
  });

  if (toInsert.length > 0) {
    const supabase = await createClient();
    const { error } = await supabase.from("products").insert(toInsert.map((r) => r.input));
    if (error) {
      // bulk insert is all-or-nothing — surface as a global failure
      return { ok: false, error: mapDbError(error) };
    }
    for (const r of toInsert) {
      results.push({ row: r.row, status: "inserted", issues: [] });
    }
  }

  results.sort((a, b) => a.row - b.row);
  for (const locale of routing.locales) {
    revalidatePath(`/${locale}/products`);
  }

  return {
    ok: true,
    data: {
      inserted: toInsert.length,
      skipped: results.length - toInsert.length,
      results,
    },
  };
}
