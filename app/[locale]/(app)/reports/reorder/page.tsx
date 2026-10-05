import { getTranslations, setRequestLocale } from "next-intl/server";
import { ExportButton } from "@/components/reports/export-button";
import { ReorderTable } from "@/components/reports/reorder-table";
import { ReportsNav } from "@/components/reports/reports-nav";
import { StoreSettingsDialog } from "@/components/reports/store-settings-dialog";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { requireAdmin } from "@/lib/supabase/queries/profiles";
import { getReorderSuggestions, getStoreSettings } from "@/lib/supabase/queries/ops-reports";

export default async function ReorderReportPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAdmin();
  const [t, rows, settings] = await Promise.all([getTranslations("opsReports"), getReorderSuggestions(), getStoreSettings()]);

  return (
    <div className="flex w-full flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("reorder.title")}</h1>
          <p className="text-muted-foreground max-w-prose text-sm">
            {t("reorder.description", { lookback: settings.reorder_lookback_days, cover: settings.reorder_cover_days })}
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/stock-alerts">{t("reorder.alertsLink")}</Link>
          </Button>
          <StoreSettingsDialog settings={settings} />
        </div>
      </div>
      <ReportsNav active="reorder" />
      <div className="flex justify-end">
        <ExportButton
          label={t("exportCsv")}
          filename="reorder-suggestions.csv"
          headers={["barcode", "name", "stock", "threshold", "avg_daily", "days_of_cover", "lead_days", "cover_days", "on_order", "pack", "suggested", "supplier", "unit_cost_piasters", "explanation"]}
          rows={rows.map((r) => [r.barcode, r.name_en, Number(r.stock_qty), Number(r.low_stock_threshold), Number(r.avg_daily_sales), r.days_of_cover === null ? "" : Number(r.days_of_cover), Number(r.lead_time_days), Number(r.cover_days), Number(r.on_order_qty), Number(r.pack_size), Number(r.suggested_qty), r.supplier_name ?? "", Number(r.unit_cost), r.explanation])}
        />
      </div>
      <ReorderTable rows={rows} />
    </div>
  );
}
