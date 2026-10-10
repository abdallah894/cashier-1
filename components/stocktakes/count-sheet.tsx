"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, Loader2, Save } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { useBarcodeScanner } from "@/hooks/use-barcode-scanner";
import { cancelStocktake, saveStocktakeCounts, submitStocktake } from "@/lib/actions/stocktakes";
import type { StocktakeItem } from "@/lib/supabase/queries/stocktakes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ConfirmButton } from "@/components/ui/confirm-button";

type Row = { counted: string; reason: string };

const SAVE_DELAY_MS = 800;

function initial(item: StocktakeItem): Row {
  return {
    counted: item.counted_qty === null ? "" : String(Number(item.counted_qty)),
    reason: item.reason ?? "",
  };
}

/** Parses an entry; null = blank (not counted yet), NaN = invalid for this unit. */
function parseCount(value: string, unit: StocktakeItem["unit"]): number | null {
  if (value.trim() === "") return null;
  const n = Number(value.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))));
  if (!Number.isFinite(n) || n < 0 || Math.round(n * 1000) !== n * 1000) return NaN;
  if (unit === "piece" && !Number.isInteger(n)) return NaN;
  return n;
}

/**
 * Count entry for an open stocktake. Entries autosave (pause/resume is
 * simply leaving and coming back) and a barcode scan adds one unit to the
 * matching line. Nothing here touches stock: that only happens on approval.
 */
export function CountSheet({
  stocktakeId,
  items,
  showExpected,
}: {
  stocktakeId: string;
  items: StocktakeItem[];
  showExpected: boolean;
}) {
  const t = useTranslations("stocktakes");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const router = useRouter();

  const [rows, setRows] = useState<Record<string, Row>>(() =>
    Object.fromEntries(items.map((item) => [item.product_id, initial(item)]))
  );
  const rowsRef = useRef(rows);
  const dirty = useRef(new Set<string>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const [filter, setFilter] = useState("");
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);

  const byBarcode = useMemo(() => new Map(items.map((item) => [item.barcode, item])), [items]);

  const flush = useCallback(async (): Promise<boolean> => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const ids = [...dirty.current];
    if (ids.length === 0) return true;
    const counts = ids.flatMap((productId) => {
      const item = items.find((candidate) => candidate.product_id === productId);
      const row = rowsRef.current[productId];
      if (!item || !row) return [];
      const parsed = parseCount(row.counted, item.unit);
      if (Number.isNaN(parsed)) return []; // invalid entries are not sent
      return [{ productId, countedQty: parsed, reason: row.reason || undefined }];
    });
    dirty.current.clear();
    if (counts.length === 0) return true;
    setSaving(true);
    const result = await saveStocktakeCounts({ stocktakeId, counts });
    setSaving(false);
    if (!result.ok) {
      for (const entry of counts) dirty.current.add(entry.productId);
      toast.error(tErrors(result.error));
      return false;
    }
    return true;
  }, [items, stocktakeId, tErrors]);

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
  }, [flush]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  function update(productId: string, patch: Partial<Row>) {
    setRows((current) => {
      const next = { ...current, [productId]: { ...current[productId], ...patch } };
      rowsRef.current = next;
      return next;
    });
    dirty.current.add(productId);
    schedule();
  }

  function onScan(barcode: string) {
    const item = byBarcode.get(barcode);
    if (!item) {
      toast.error(t("notInCount", { barcode }));
      return;
    }
    setHighlight(item.product_id);
    inputs.current.get(item.product_id)?.scrollIntoView({ block: "center" });
    if (item.unit === "piece") {
      const current = parseCount(rowsRef.current[item.product_id]?.counted ?? "", item.unit);
      update(item.product_id, { counted: String((Number.isNaN(current) ? 0 : (current ?? 0)) + 1) });
    } else {
      inputs.current.get(item.product_id)?.focus();
      inputs.current.get(item.product_id)?.select();
    }
  }
  useBarcodeScanner(onScan, { enabled: !busy });

  const countedTotal = items.filter((item) => rows[item.product_id]?.counted.trim() !== "").length;
  const visible = items.filter((item) => {
    const q = filter.trim().toLowerCase();
    if (!q) return true;
    return (
      item.barcode.toLowerCase().includes(q) ||
      item.name_en.toLowerCase().includes(q) ||
      item.name_ar.toLowerCase().includes(q)
    );
  });

  async function saveAndLeave() {
    setBusy(true);
    if (await flush()) router.push("/stocktakes");
    setBusy(false);
  }

  async function submit() {
    setBusy(true);
    try {
      if (!(await flush())) return;
      const result = await submitStocktake({ stocktakeId });
      if (!result.ok) {
        toast.error(tErrors(result.error));
        return;
      }
      toast.success(t("submitted"));
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    setBusy(true);
    try {
      const result = await cancelStocktake({ stocktakeId });
      if (!result.ok) {
        toast.error(tErrors(result.error));
        return;
      }
      router.push("/stocktakes");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder={t("filterPlaceholder")}
          aria-label={t("filterPlaceholder")}
          className="max-w-xs"
        />
        <span className="text-muted-foreground text-sm tabular-nums">
          {t("progress", { counted: countedTotal, total: items.length })}
        </span>
        <span className="text-muted-foreground flex items-center gap-1 text-xs">
          {saving ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
          {saving ? t("saving") : t("saved")}
        </span>
        <div className="ms-auto flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void saveAndLeave()} disabled={busy}>
            <Save className="size-4" />
            {t("pause")}
          </Button>
          <ConfirmButton
            disabled={busy}
            title={t("cancelCountTitle")}
            description={t("cancelCountBody")}
            confirmLabel={t("cancelCount")}
            onConfirm={() => void cancel()}
          >
            {t("cancelCount")}
          </ConfirmButton>
          <Button onClick={() => void submit()} disabled={busy || countedTotal === 0}>
            {t("submit")}
          </Button>
        </div>
      </div>
      <p className="text-muted-foreground text-sm">{t("scanHint")}</p>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="p-3 text-start">{t("colProduct")}</th>
              {showExpected && <th className="p-3 text-start">{t("colExpected")}</th>}
              <th className="p-3 text-start">{t("colCounted")}</th>
              <th className="p-3 text-start">{t("colReason")}</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((item) => {
              const row = rows[item.product_id] ?? { counted: "", reason: "" };
              const parsed = parseCount(row.counted, item.unit);
              const invalid = Number.isNaN(parsed);
              const differs = parsed !== null && !invalid && parsed !== Number(item.expected_qty);
              return (
                <tr
                  key={item.product_id}
                  className={cn("border-b align-top last:border-0", highlight === item.product_id && "bg-accent")}
                >
                  <td className="p-3">
                    <div className="font-medium">{locale === "ar" ? item.name_ar : item.name_en}</div>
                    <div className="text-muted-foreground text-xs tabular-nums" dir="ltr">
                      {item.barcode} · {t(`unit.${item.unit}`)}
                    </div>
                  </td>
                  {showExpected && (
                    <td className="p-3 tabular-nums" dir="ltr">
                      {Number(item.expected_qty)}
                    </td>
                  )}
                  <td className="p-3">
                    <Input
                      ref={(element) => {
                        if (element) inputs.current.set(item.product_id, element);
                        else inputs.current.delete(item.product_id);
                      }}
                      dir="ltr"
                      inputMode="decimal"
                      className={cn("w-28 tabular-nums", invalid && "border-destructive")}
                      value={row.counted}
                      onChange={(event) => update(item.product_id, { counted: event.target.value })}
                      aria-label={t("countedFor", { name: locale === "ar" ? item.name_ar : item.name_en })}
                      aria-invalid={invalid}
                    />
                    {invalid && (
                      <div className="text-destructive mt-1 text-xs">
                        {item.unit === "piece" ? t("wholeNumber") : t("invalidQty")}
                      </div>
                    )}
                  </td>
                  <td className="p-3">
                    {differs && (
                      <Input
                        value={row.reason}
                        onChange={(event) => update(item.product_id, { reason: event.target.value })}
                        placeholder={t("reasonPlaceholder")}
                        aria-label={t("reasonFor", { name: locale === "ar" ? item.name_ar : item.name_en })}
                        className={cn(row.reason.trim() === "" && "border-amber-500")}
                      />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
