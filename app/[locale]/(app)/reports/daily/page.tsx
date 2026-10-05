import { getTranslations, setRequestLocale } from "next-intl/server";
import { CloseDayButton } from "@/components/reports/close-day-button";
import { ExportButton } from "@/components/reports/export-button";
import { RangeForm, ReportsNav } from "@/components/reports/reports-nav";
import { StoreSettingsDialog } from "@/components/reports/store-settings-dialog";
import { Badge } from "@/components/ui/badge";
import { formatEgp } from "@/lib/money";
import { requireAdmin } from "@/lib/supabase/queries/profiles";
import {
  getDailySummary,
  getRefundsDetail,
  getStoreSettings,
  getVoidsDetail,
  rangeFromParams,
} from "@/lib/supabase/queries/ops-reports";
import { businessToday } from "@/lib/supabase/queries/reports";

export default async function DailyReportPage({
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
  const [t, days, refunds, voids, settings, today] = await Promise.all([
    getTranslations("opsReports"),
    getDailySummary(range),
    getRefundsDetail(range),
    getVoidsDetail(range),
    getStoreSettings(),
    businessToday(),
  ]);
  const money = (v: number) => formatEgp(Number(v), locale);
  const when = new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short", timeZone: settings.timezone });
  const dayLabel = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${String(iso).slice(0, 10)}T00:00:00Z`));

  return (
    <div className="flex w-full flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("daily.title")}</h1>
          <p className="text-muted-foreground max-w-prose text-sm">{t("daily.description", { tz: settings.timezone })}</p>
        </div>
        <StoreSettingsDialog settings={settings} />
      </div>
      <ReportsNav active="daily" />
      <RangeForm from={range.from} to={range.to} />

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t("daily.byDay")}</h2>
          <ExportButton
            label={t("exportCsv")}
            filename={`daily-${range.from}_${range.to}.csv`}
            headers={["day", "closed", "sales", "gross_sales_piasters", "discounts_piasters", "promo_discounts_piasters", "discount_overrides", "net_sales_ex_vat_piasters", "vat_piasters", "refunds", "refunds_gross_piasters", "net_after_refunds_gross_piasters", "cash_net_piasters", "card_net_piasters", "voids", "void_value_piasters"]}
            rows={days.map((d) => [String(d.day).slice(0, 10), d.closed ? "yes" : "no", Number(d.sale_count), Number(d.gross_sales), Number(d.discount_total), Number(d.promo_discount), Number(d.override_count), Number(d.net_sales_ex_vat), Number(d.vat_on_sales), Number(d.refund_count), Number(d.refunds_gross), Number(d.net_after_refunds_gross), Number(d.cash_net), Number(d.card_net), Number(d.void_count), Number(d.void_value)])}
          />
        </div>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="p-3 text-start">{t("daily.colDay")}</th>
                <th className="p-3 text-start">{t("daily.colSales")}</th>
                <th className="p-3 text-start">{t("daily.colGross")}</th>
                <th className="p-3 text-start">{t("daily.colNet")}</th>
                <th className="p-3 text-start">{t("daily.colVat")}</th>
                <th className="p-3 text-start">{t("daily.colDiscounts")}</th>
                <th className="p-3 text-start">{t("daily.colRefunds")}</th>
                <th className="p-3 text-start">{t("daily.colAfterRefunds")}</th>
                <th className="p-3 text-start">{t("daily.colCash")}</th>
                <th className="p-3 text-start">{t("daily.colCard")}</th>
                <th className="p-3 text-start">{t("daily.colVoids")}</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {days.map((d) => {
                const dayKey = String(d.day).slice(0, 10);
                return (
                  <tr key={dayKey} className="border-b last:border-0">
                    <td className="p-3 whitespace-nowrap">{dayLabel(dayKey)}</td>
                    <td className="p-3 tabular-nums" dir="ltr">{Number(d.sale_count)}</td>
                    <td className="p-3 tabular-nums" dir="ltr">{money(d.gross_sales)}</td>
                    <td className="p-3 tabular-nums" dir="ltr">{money(d.net_sales_ex_vat)}</td>
                    <td className="p-3 tabular-nums" dir="ltr">{money(d.vat_on_sales)}</td>
                    <td className="p-3 tabular-nums" dir="ltr">
                      {money(d.discount_total)}
                      {Number(d.override_count) > 0 && <div className="text-muted-foreground text-xs">{t("daily.overrides", { count: Number(d.override_count) })}</div>}
                    </td>
                    <td className="p-3 tabular-nums" dir="ltr">
                      {money(d.refunds_gross)}
                      {Number(d.refund_count) > 0 && <div className="text-muted-foreground text-xs">{Number(d.refund_count)}</div>}
                    </td>
                    <td className="p-3 font-semibold tabular-nums" dir="ltr">{money(d.net_after_refunds_gross)}</td>
                    <td className="p-3 tabular-nums" dir="ltr">{money(d.cash_net)}</td>
                    <td className="p-3 tabular-nums" dir="ltr">{money(d.card_net)}</td>
                    <td className="p-3 tabular-nums" dir="ltr">
                      {Number(d.void_count)}
                      {Number(d.void_count) > 0 && <div className="text-muted-foreground text-xs">{money(d.void_value)}</div>}
                    </td>
                    <td className="p-3">
                      {d.closed ? <Badge variant="outline">{t("daily.closed")}</Badge> : dayKey < today ? <CloseDayButton day={dayKey} /> : <span className="text-muted-foreground text-xs">{t("daily.open")}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-muted-foreground text-xs">{t("daily.grossNote")}</p>
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t("daily.refundsTitle")}</h2>
          <ExportButton
            label={t("exportCsv")}
            filename={`refunds-${range.from}_${range.to}.csv`}
            headers={["return", "sale", "when", "cashier", "tender", "refund_piasters", "restocked", "reason"]}
            rows={refunds.map((r) => [Number(r.return_number), Number(r.sale_number), r.created_at, r.actor_name, r.tender, Number(r.refund_total), r.restock ? "yes" : "no", r.reason])}
          />
        </div>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <tbody>
              {refunds.map((r) => (
                <tr key={r.return_id} className="border-b last:border-0">
                  <td className="p-3 tabular-nums">R-{Number(r.return_number)}</td>
                  <td className="p-3 tabular-nums">#{Number(r.sale_number)}</td>
                  <td className="p-3">{when.format(new Date(r.created_at))}</td>
                  <td className="p-3">{r.actor_name}</td>
                  <td className="p-3">{t(`tender.${r.tender}`)}</td>
                  <td className="p-3 tabular-nums" dir="ltr">{money(r.refund_total)}</td>
                  <td className="p-3">{r.restock ? t("daily.restocked") : t("daily.writtenOff")}</td>
                  <td className="text-muted-foreground p-3">{r.reason}</td>
                </tr>
              ))}
              {refunds.length === 0 && (
                <tr><td className="text-muted-foreground p-6 text-center" colSpan={8}>{t("daily.noRefunds")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t("daily.voidsTitle")}</h2>
          <ExportButton
            label={t("exportCsv")}
            filename={`voids-${range.from}_${range.to}.csv`}
            headers={["when", "cashier", "items", "value_piasters"]}
            rows={voids.map((v) => [v.created_at, v.actor_name, Number(v.item_count), Number(v.amount)])}
          />
        </div>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <tbody>
              {voids.map((v) => (
                <tr key={v.event_id} className="border-b last:border-0">
                  <td className="p-3">{when.format(new Date(v.created_at))}</td>
                  <td className="p-3">{v.actor_name}</td>
                  <td className="p-3 tabular-nums" dir="ltr">{Number(v.item_count)}</td>
                  <td className="p-3 tabular-nums" dir="ltr">{money(v.amount)}</td>
                </tr>
              ))}
              {voids.length === 0 && (
                <tr><td className="text-muted-foreground p-6 text-center" colSpan={4}>{t("daily.noVoids")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
