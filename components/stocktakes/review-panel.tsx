"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { TriangleAlert } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { approveStocktake, cancelStocktake, reopenStocktake } from "@/lib/actions/stocktakes";
import { formatEgp } from "@/lib/money";
import type { Database } from "@/lib/supabase/database.types";
import { Button } from "@/components/ui/button";
import { ExportButton } from "@/components/reports/export-button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { ConfirmButton } from "@/components/ui/confirm-button";

type ReportRow = Database["public"]["Functions"]["stocktake_variance_report"]["Returns"][number];
type Resolution = "use_count" | "keep_current";

/**
 * Variance report plus the review controls. While a count is `submitted`
 * an admin settles conflicts (stock moved during the count) and approves;
 * approving is the only step that changes stock.
 */
export function ReviewPanel({
  stocktakeId,
  number,
  status,
  rows,
  conflictIds,
  isAdmin,
}: {
  stocktakeId: string;
  number: number;
  status: Database["public"]["Enums"]["stocktake_status"];
  rows: ReportRow[];
  conflictIds: string[];
  isAdmin: boolean;
}) {
  const t = useTranslations("stocktakes");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const router = useRouter();
  const [resolutions, setResolutions] = useState<Record<string, Resolution>>({});
  const [busy, setBusy] = useState(false);

  const reviewable = status === "submitted" && isAdmin;
  const conflicts = new Set(conflictIds);
  const unresolved = conflictIds.filter((id) => !resolutions[id]);
  const netValue = rows.reduce((sum, row) => sum + Number(row.variance_value), 0);
  const varianceLines = rows.filter((row) => Number(row.variance_qty) !== 0).length;

  async function run(action: () => Promise<{ ok: boolean; error?: string }>, successKey: string) {
    setBusy(true);
    try {
      const result = await action();
      if (!result.ok) {
        toast.error(tErrors(result.error ?? "unknown"));
        return;
      }
      toast.success(t(successKey));
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const name = (row: ReportRow) => (locale === "ar" ? row.name_ar : row.name_en);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label={t("statLines")} value={String(rows.length)} />
        <Stat label={t("statVariances")} value={String(varianceLines)} />
        <Stat label={t("statNetValue")} value={formatEgp(netValue, locale)} danger={netValue < 0} />
      </div>

      {conflictIds.length > 0 && status === "submitted" && (
        <p className="flex items-start gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          {t("conflictsNotice", { count: conflictIds.length })}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <ExportButton
          label={t("exportCsv")}
          filename={`stocktake-${number}.csv`}
          headers={["barcode", "name", "expected", "counted", "variance", "unit_cost_piasters", "variance_value_piasters", "reason"]}
          rows={rows.map((row) => [
            row.barcode,
            row.name_en,
            Number(row.expected_qty),
            Number(row.counted_qty),
            Number(row.variance_qty),
            Number(row.unit_cost),
            Number(row.variance_value),
            row.reason ?? "",
          ])}
        />
        {reviewable && (
          <div className="ms-auto flex flex-wrap gap-2">
            <Button variant="outline" disabled={busy} onClick={() => run(() => reopenStocktake({ stocktakeId }), "reopened")}>
              {t("sendBack")}
            </Button>
            <ConfirmButton
              disabled={busy}
              title={t("cancelCountTitle")}
              description={t("cancelCountBody")}
              confirmLabel={t("cancelCount")}
              onConfirm={() => run(() => cancelStocktake({ stocktakeId }), "cancelled")}
            >
              {t("cancelCount")}
            </ConfirmButton>
            <Button
              disabled={busy || unresolved.length > 0}
              onClick={() => run(() => approveStocktake({ stocktakeId, resolutions }), "approved")}
            >
              {t("approve")}
            </Button>
          </div>
        )}
      </div>
      {reviewable && unresolved.length > 0 && (
        <p className="text-muted-foreground text-sm">{t("resolveFirst", { count: unresolved.length })}</p>
      )}

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="p-3 text-start">{t("colProduct")}</th>
              <th className="p-3 text-start">{t("colExpected")}</th>
              <th className="p-3 text-start">{t("colCounted")}</th>
              <th className="p-3 text-start">{t("colVariance")}</th>
              <th className="p-3 text-start">{t("colValue")}</th>
              <th className="p-3 text-start">{t("colReason")}</th>
              <th className="p-3 text-start">{t("colConflict")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const variance = Number(row.variance_qty);
              const conflict = conflicts.has(row.product_id);
              return (
                <tr key={row.product_id} className={cn("border-b align-top last:border-0", conflict && "bg-amber-500/5")}>
                  <td className="p-3">
                    <div className="font-medium">{name(row)}</div>
                    <div className="text-muted-foreground text-xs tabular-nums" dir="ltr">
                      {row.barcode}
                    </div>
                  </td>
                  <td className="p-3 tabular-nums" dir="ltr">{Number(row.expected_qty)}</td>
                  <td className="p-3 tabular-nums" dir="ltr">{Number(row.counted_qty)}</td>
                  <td className={cn("p-3 tabular-nums", variance < 0 && "text-destructive")} dir="ltr">
                    {variance > 0 ? "+" : ""}
                    {variance}
                  </td>
                  <td className={cn("p-3 tabular-nums", Number(row.variance_value) < 0 && "text-destructive")} dir="ltr">
                    {formatEgp(Number(row.variance_value), locale)}
                  </td>
                  <td className="text-muted-foreground p-3">{row.reason}</td>
                  <td className="p-3">
                    {conflict && status === "submitted" && (
                      <div className="flex flex-col gap-1">
                        <span className="text-xs">{t("conflictNow", { qty: Number(row.current_qty) })}</span>
                        {reviewable && (
                          <Select
                            value={resolutions[row.product_id] ?? ""}
                            onValueChange={(value) =>
                              setResolutions((current) => ({ ...current, [row.product_id]: value as Resolution }))
                            }
                          >
                            <SelectTrigger className="w-44">
                              <SelectValue placeholder={t("resolvePlaceholder")} />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="use_count">{t("useCount")}</SelectItem>
                              <SelectItem value="keep_current">{t("keepCurrent")}</SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                      </div>
                    )}
                    {conflict && status === "approved" && (
                      <span className="text-muted-foreground text-xs">{t("conflictWas", { qty: Number(row.current_qty) })}</span>
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

function Stat({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="bg-card rounded-lg border p-4">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className={cn("text-xl font-semibold tabular-nums", danger && "text-destructive")} dir="ltr">
        {value}
      </div>
    </div>
  );
}
