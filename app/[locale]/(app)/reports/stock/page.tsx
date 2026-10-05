import { getTranslations, setRequestLocale } from "next-intl/server";
import { ExportButton } from "@/components/reports/export-button";
import { RangeForm, ReportsNav } from "@/components/reports/reports-nav";
import { Badge } from "@/components/ui/badge";
import { formatEgp } from "@/lib/money";
import { requireAdmin } from "@/lib/supabase/queries/profiles";
import { getStockAging, getStockMovements, getStockValuation, rangeFromParams } from "@/lib/supabase/queries/ops-reports";

export default async function StockReportsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAdmin();
  const range = await rangeFromParams(await searchParams);
  const [t, movements, valuation, aging] = await Promise.all([
    getTranslations("opsReports"),
    getStockMovements(range),
    getStockValuation(),
    getStockAging(),
  ]);
  const isAr = locale === "ar";
  const name = (row: { name_ar: string; name_en: string }) => (isAr ? row.name_ar : row.name_en);
  const money = (v: number) => formatEgp(Number(v), locale);
  const totalCost = valuation.reduce((s, r) => s + Number(r.value_at_cost), 0);
  const totalRetailGross = valuation.reduce((s, r) => s + Number(r.retail_value_gross), 0);
  const totalRetailNet = valuation.reduce((s, r) => s + Number(r.retail_value_net), 0);
  const buckets = ["0-30", "31-60", "61-90", "90+", "never_sold"] as const;
  const byBucket = new Map(buckets.map((b) => [b, aging.filter((r) => r.bucket === b).reduce((s, r) => s + Number(r.value_at_cost), 0)]));

  return (
    <div className="flex w-full flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("stock.title")}</h1>
        <p className="text-muted-foreground max-w-prose text-sm">{t("stock.description")}</p>
      </div>
      <ReportsNav active="stock" />

      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 className="text-lg font-semibold">{t("stock.movementsTitle")}</h2>
          <div className="flex flex-wrap items-end gap-2">
            <RangeForm from={range.from} to={range.to} />
            <ExportButton
              label={t("exportCsv")}
              filename={`stock-movements-${range.from}_${range.to}.csv`}
              headers={["barcode", "name", "opening", "received", "sold", "returned", "adjusted", "closing"]}
              rows={movements.map((m) => [m.barcode, m.name_en, Number(m.opening_qty), Number(m.received_qty), Number(m.sold_qty), Number(m.returned_qty), Number(m.adjusted_qty), Number(m.closing_qty)])}
            />
          </div>
        </div>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="p-3 text-start">{t("stock.colProduct")}</th>
                <th className="p-3 text-start">{t("stock.colOpening")}</th>
                <th className="p-3 text-start">{t("stock.colReceived")}</th>
                <th className="p-3 text-start">{t("stock.colSold")}</th>
                <th className="p-3 text-start">{t("stock.colReturned")}</th>
                <th className="p-3 text-start">{t("stock.colAdjusted")}</th>
                <th className="p-3 text-start">{t("stock.colClosing")}</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((m) => (
                <tr key={m.product_id} className="border-b last:border-0">
                  <td className="p-3">{name(m)}<div className="text-muted-foreground text-xs" dir="ltr">{m.barcode}</div></td>
                  <td className="p-3 tabular-nums" dir="ltr">{Number(m.opening_qty)}</td>
                  <td className="p-3 tabular-nums" dir="ltr">{Number(m.received_qty)}</td>
                  <td className="p-3 tabular-nums" dir="ltr">{Number(m.sold_qty)}</td>
                  <td className="p-3 tabular-nums" dir="ltr">{Number(m.returned_qty)}</td>
                  <td className="p-3 tabular-nums" dir="ltr">{Number(m.adjusted_qty)}</td>
                  <td className="p-3 font-semibold tabular-nums" dir="ltr">{Number(m.closing_qty)}</td>
                </tr>
              ))}
              {movements.length === 0 && (
                <tr><td className="text-muted-foreground p-6 text-center" colSpan={7}>{t("stock.noMovements")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t("stock.valuationTitle")}</h2>
          <ExportButton
            label={t("exportCsv")}
            filename="stock-valuation.csv"
            headers={["barcode", "name", "qty", "unit_cost_piasters", "value_at_cost_piasters", "unit_price_piasters", "retail_gross_piasters", "retail_net_ex_vat_piasters"]}
            rows={valuation.map((v) => [v.barcode, v.name_en, Number(v.qty), Number(v.unit_cost), Number(v.value_at_cost), Number(v.unit_price), Number(v.retail_value_gross), Number(v.retail_value_net)])}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label={t("stock.atCost")} value={money(totalCost)} />
          <Stat label={t("stock.retailGross")} value={money(totalRetailGross)} />
          <Stat label={t("stock.retailNet")} value={money(totalRetailNet)} />
        </div>
        <p className="text-muted-foreground text-xs">{t("stock.valuationNote")}</p>
        <div className="max-h-96 overflow-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-background sticky top-0">
              <tr className="border-b">
                <th className="p-3 text-start">{t("stock.colProduct")}</th>
                <th className="p-3 text-start">{t("stock.colQty")}</th>
                <th className="p-3 text-start">{t("stock.colUnitCost")}</th>
                <th className="p-3 text-start">{t("stock.colValueCost")}</th>
                <th className="p-3 text-start">{t("stock.colRetailGross")}</th>
                <th className="p-3 text-start">{t("stock.colRetailNet")}</th>
              </tr>
            </thead>
            <tbody>
              {valuation.map((v) => (
                <tr key={v.product_id} className="border-b last:border-0">
                  <td className="p-3">{name(v)}</td>
                  <td className="p-3 tabular-nums" dir="ltr">{Number(v.qty)}</td>
                  <td className="p-3 tabular-nums" dir="ltr">{money(v.unit_cost)}</td>
                  <td className="p-3 tabular-nums" dir="ltr">{money(v.value_at_cost)}</td>
                  <td className="p-3 tabular-nums" dir="ltr">{money(v.retail_value_gross)}</td>
                  <td className="p-3 tabular-nums" dir="ltr">{money(v.retail_value_net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t("stock.agingTitle")}</h2>
          <ExportButton
            label={t("exportCsv")}
            filename="stock-aging.csv"
            headers={["barcode", "name", "qty", "value_at_cost_piasters", "last_sold_at", "days_since_last_sale", "bucket"]}
            rows={aging.map((a) => [a.barcode, a.name_en, Number(a.qty), Number(a.value_at_cost), a.last_sold_at ?? "", a.days_since_last_sale ?? "", a.bucket])}
          />
        </div>
        <p className="text-muted-foreground text-xs">{t("stock.agingNote")}</p>
        <div className="grid gap-3 sm:grid-cols-5">
          {buckets.map((b) => (
            <Stat key={b} label={t(`stock.bucket.${b}`)} value={money(byBucket.get(b) ?? 0)} />
          ))}
        </div>
        <div className="max-h-96 overflow-auto rounded-md border">
          <table className="w-full text-sm">
            <tbody>
              {aging.map((a) => (
                <tr key={a.product_id} className="border-b last:border-0">
                  <td className="p-3">{name(a)}</td>
                  <td className="p-3 tabular-nums" dir="ltr">{Number(a.qty)}</td>
                  <td className="p-3 tabular-nums" dir="ltr">{money(a.value_at_cost)}</td>
                  <td className="p-3 tabular-nums" dir="ltr">{a.days_since_last_sale ?? "—"}</td>
                  <td className="p-3"><Badge variant={a.bucket === "90+" || a.bucket === "never_sold" ? "destructive" : "outline"}>{t(`stock.bucket.${a.bucket}`)}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card rounded-lg border p-4">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="text-lg font-semibold tabular-nums" dir="ltr">{value}</div>
    </div>
  );
}
