"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Info } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { createPurchaseOrder } from "@/lib/actions/purchasing";
import { formatEgp } from "@/lib/money";
import type { SuggestionRow } from "@/lib/supabase/queries/ops-reports";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Reorder suggestions grouped by supplier. Every number that went into a
 * suggestion is visible (and the full sentence in the "Why?" dialog), and a
 * supplier's lines become a draft purchase order in one click.
 */
export function ReorderTable({ rows }: { rows: SuggestionRow[] }) {
  const t = useTranslations("opsReports.reorder");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [explain, setExplain] = useState<SuggestionRow | null>(null);
  const isAr = locale === "ar";

  const groups = new Map<string, SuggestionRow[]>();
  for (const row of rows) {
    const key = row.supplier_id ?? "none";
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  function createDraft(supplierId: string, items: SuggestionRow[]) {
    startTransition(async () => {
      const result = await createPurchaseOrder({
        supplierId,
        lines: items.map((row) => ({ productId: row.product_id, orderedQty: Number(row.suggested_qty), unitCost: Number(row.unit_cost) })),
      });
      if (!result.ok) {
        toast.error(tErrors(result.error));
        return;
      }
      toast.success(t("draftCreated"));
      router.push(`/purchase-orders/${result.data.poId}`);
    });
  }

  if (rows.length === 0) return <p className="text-muted-foreground rounded-md border p-6 text-center text-sm">{t("empty")}</p>;

  return (
    <div className="flex flex-col gap-5">
      {[...groups.entries()].map(([supplierId, items]) => (
        <section key={supplierId} className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">{supplierId === "none" ? t("noSupplier") : items[0].supplier_name}</h3>
            {supplierId !== "none" && (
              <Button size="sm" disabled={pending} onClick={() => createDraft(supplierId, items)}>
                {t("createDraft", { count: items.length })}
              </Button>
            )}
          </div>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="p-3 text-start">{t("colProduct")}</th>
                  <th className="p-3 text-start">{t("colStock")}</th>
                  <th className="p-3 text-start">{t("colDaily")}</th>
                  <th className="p-3 text-start">{t("colCover")}</th>
                  <th className="p-3 text-start">{t("colLead")}</th>
                  <th className="p-3 text-start">{t("colOnOrder")}</th>
                  <th className="p-3 text-start">{t("colPack")}</th>
                  <th className="p-3 text-start">{t("colSuggested")}</th>
                  <th className="p-3" />
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row.product_id} className="border-b last:border-0">
                    <td className="p-3">{isAr ? row.name_ar : row.name_en}<div className="text-muted-foreground text-xs" dir="ltr">{row.barcode}</div></td>
                    <td className="p-3 tabular-nums" dir="ltr">{Number(row.stock_qty)} / {Number(row.low_stock_threshold)}</td>
                    <td className="p-3 tabular-nums" dir="ltr">{Number(row.avg_daily_sales).toFixed(2)}</td>
                    <td className="p-3 tabular-nums" dir="ltr">{row.days_of_cover === null ? "—" : Number(row.days_of_cover)}</td>
                    <td className="p-3 tabular-nums" dir="ltr">{Number(row.lead_time_days)}</td>
                    <td className="p-3 tabular-nums" dir="ltr">{Number(row.on_order_qty)}</td>
                    <td className="p-3 tabular-nums" dir="ltr">{Number(row.pack_size)}</td>
                    <td className="p-3 font-semibold tabular-nums" dir="ltr">
                      {Number(row.suggested_qty)}
                      <div className="text-muted-foreground text-xs font-normal">{formatEgp(Number(row.unit_cost), locale)}</div>
                    </td>
                    <td className="p-3">
                      <Button size="sm" variant="ghost" onClick={() => setExplain(row)} aria-label={t("why")}>
                        <Info className="size-4" />
                        {t("why")}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      <Dialog open={explain !== null} onOpenChange={(open) => !open && setExplain(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{explain ? (isAr ? explain.name_ar : explain.name_en) : ""}</DialogTitle>
            <DialogDescription>{t("whyDescription")}</DialogDescription>
          </DialogHeader>
          {explain && (
            <div className="grid gap-3 text-sm">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
                <Row label={t("inStock")} value={Number(explain.stock_qty)} />
                <Row label={t("safetyStock")} value={Number(explain.low_stock_threshold)} />
                <Row label={t("avgDaily", { days: Number(explain.lookback_days) })} value={Number(explain.avg_daily_sales).toFixed(2)} />
                <Row label={t("leadTime")} value={`${Number(explain.lead_time_days)} ${t("days")}`} />
                <Row label={t("coverDays")} value={`${Number(explain.cover_days)} ${t("days")}`} />
                <Row label={t("colOnOrder")} value={Number(explain.on_order_qty)} />
                <Row label={t("colPack")} value={Number(explain.pack_size)} />
                <Row label={t("minOrder")} value={Number(explain.min_order_qty)} />
                <Row label={t("colSuggested")} value={Number(explain.suggested_qty)} />
              </dl>
              <p className="bg-muted rounded-md p-3 text-xs" dir="ltr">{explain.explanation}</p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums" dir="ltr">{value}</dd>
    </>
  );
}
