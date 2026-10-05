import { getTranslations, setRequestLocale } from "next-intl/server";
import { ExportButton } from "@/components/reports/export-button";
import { RangeForm, ReportsNav } from "@/components/reports/reports-nav";
import { formatEgp } from "@/lib/money";
import { requireAdmin } from "@/lib/supabase/queries/profiles";
import { getVat, rangeFromParams } from "@/lib/supabase/queries/ops-reports";

export default async function VatReportPage({
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
  const [t, rows] = await Promise.all([getTranslations("opsReports"), getVat(range)]);
  const money = (v: number) => formatEgp(Number(v), locale);
  const sum = (key: keyof (typeof rows)[number]) => rows.reduce((total, row) => total + Number(row[key]), 0);

  return (
    <div className="flex w-full flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("vat.title")}</h1>
        <p className="text-muted-foreground max-w-prose text-sm">{t("vat.description")}</p>
      </div>
      <ReportsNav active="vat" />
      <div className="flex flex-wrap items-end justify-between gap-2">
        <RangeForm from={range.from} to={range.to} />
        <ExportButton
          label={t("exportCsv")}
          filename={`vat-${range.from}_${range.to}.csv`}
          headers={["rate_percent", "gross_sales_piasters", "net_sales_ex_vat_piasters", "vat_on_sales_piasters", "refund_gross_piasters", "refund_net_piasters", "refund_vat_piasters", "net_output_vat_piasters", "input_vat_purchases_piasters"]}
          rows={rows.map((r) => [Number(r.rate_bp) / 100, Number(r.gross_sales), Number(r.net_sales), Number(r.vat_sales), Number(r.refund_gross), Number(r.refund_net), Number(r.refund_vat), Number(r.net_vat), Number(r.input_vat_purchases)])}
        />
      </div>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="p-3 text-start">{t("vat.colRate")}</th>
              <th className="p-3 text-start">{t("vat.colGross")}</th>
              <th className="p-3 text-start">{t("vat.colNet")}</th>
              <th className="p-3 text-start">{t("vat.colVat")}</th>
              <th className="p-3 text-start">{t("vat.colRefundVat")}</th>
              <th className="p-3 text-start">{t("vat.colNetVat")}</th>
              <th className="p-3 text-start">{t("vat.colInput")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.rate_bp} className="border-b last:border-0">
                <td className="p-3 tabular-nums" dir="ltr">{Number(r.rate_bp) / 100}%</td>
                <td className="p-3 tabular-nums" dir="ltr">{money(r.gross_sales)}</td>
                <td className="p-3 tabular-nums" dir="ltr">{money(r.net_sales)}</td>
                <td className="p-3 tabular-nums" dir="ltr">{money(r.vat_sales)}</td>
                <td className="p-3 tabular-nums" dir="ltr">{money(r.refund_vat)}</td>
                <td className="p-3 font-semibold tabular-nums" dir="ltr">{money(r.net_vat)}</td>
                <td className="p-3 tabular-nums" dir="ltr">{money(r.input_vat_purchases)}</td>
              </tr>
            ))}
            {rows.length > 0 && (
              <tr className="bg-muted/40 font-semibold">
                <td className="p-3">{t("vat.total")}</td>
                <td className="p-3 tabular-nums" dir="ltr">{money(sum("gross_sales"))}</td>
                <td className="p-3 tabular-nums" dir="ltr">{money(sum("net_sales"))}</td>
                <td className="p-3 tabular-nums" dir="ltr">{money(sum("vat_sales"))}</td>
                <td className="p-3 tabular-nums" dir="ltr">{money(sum("refund_vat"))}</td>
                <td className="p-3 tabular-nums" dir="ltr">{money(sum("net_vat"))}</td>
                <td className="p-3 tabular-nums" dir="ltr">{money(sum("input_vat_purchases"))}</td>
              </tr>
            )}
            {rows.length === 0 && (
              <tr><td className="text-muted-foreground p-6 text-center" colSpan={7}>{t("vat.empty")}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-muted-foreground max-w-prose text-xs">{t("vat.note")}</p>
    </div>
  );
}
