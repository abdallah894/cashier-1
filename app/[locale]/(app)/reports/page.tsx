import { setRequestLocale, getTranslations, getFormatter } from "next-intl/server";
import { requireAdmin } from "@/lib/supabase/queries/profiles";
import { getDirection, type Locale } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";
import { formatEgp } from "@/lib/money";
import {
  defaultRange,
  getSummary,
  getSalesOverTime,
  getTopProducts,
  getSalesByCategory,
  getSalesByCashier,
  getProfit,
  type Bucket,
} from "@/lib/supabase/queries/reports";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardHeader,
  CardTitle,
  CardAction,
  CardContent,
  CardDescription,
} from "@/components/ui/card";
import { TimeSeriesChart, CategoricalBarChart } from "@/components/reports/charts";
import { ExportButton } from "@/components/reports/export-button";

type SearchParams = { from?: string; to?: string; bucket?: string };

export default async function ReportsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAdmin();

  const [t, format] = await Promise.all([getTranslations("reports"), getFormatter()]);
  const rtl = getDirection(locale as Locale) === "rtl";
  const isAr = locale === "ar";
  const name = (ar: string | null, en: string | null) => (isAr ? ar : en) ?? en ?? ar ?? "—";

  const sp = await searchParams;
  const fallback = defaultRange();
  const from = sp.from || fallback.from;
  const to = sp.to || fallback.to;
  const bucket: Bucket = sp.bucket === "week" || sp.bucket === "month" ? sp.bucket : "day";
  const rangeValid = from <= to;
  const range = { from, to };

  const bucketLabel = (iso: string) => {
    const d = new Date(iso);
    return bucket === "month"
      ? format.dateTime(d, { year: "numeric", month: "short" })
      : format.dateTime(d, { day: "2-digit", month: "short" });
  };

  // Fetch everything in parallel (SQL does the aggregation).
  const [summary, overTime, topRevenue, topQty, byCategory, byCashier, profit] = rangeValid
    ? await Promise.all([
        getSummary(range),
        getSalesOverTime(range, bucket),
        getTopProducts(range, "revenue", 8),
        getTopProducts(range, "qty", 8),
        getSalesByCategory(range),
        getSalesByCashier(range),
        getProfit(range),
      ])
    : [null, [], [], [], [], [], null];

  const inputClass = "h-9 w-auto";
  const selectClass =
    "border-input h-9 rounded-md border bg-transparent px-3 text-sm shadow-xs outline-none";

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground text-sm">{t("subtitle")}</p>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-2">
        <label className="text-muted-foreground flex items-center gap-1 text-sm">
          {t("from")}
          <Input type="date" name="from" defaultValue={from} className={inputClass} />
        </label>
        <label className="text-muted-foreground flex items-center gap-1 text-sm">
          {t("to")}
          <Input type="date" name="to" defaultValue={to} className={inputClass} />
        </label>
        <label className="text-muted-foreground flex items-center gap-1 text-sm">
          {t("bucket")}
          <select name="bucket" defaultValue={bucket} className={selectClass} aria-label={t("bucket")}>
            <option value="day">{t("bucketDay")}</option>
            <option value="week">{t("bucketWeek")}</option>
            <option value="month">{t("bucketMonth")}</option>
          </select>
        </label>
        <Button type="submit" size="sm">
          {t("apply")}
        </Button>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/reports">{t("reset")}</Link>
        </Button>
      </form>

      {!rangeValid ? (
        <Card>
          <CardContent className="text-muted-foreground py-10 text-center text-sm">
            {t("rangeInvalid")}
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard title={t("revenue")} value={formatEgp(summary!.revenue, locale)} />
            <StatCard
              title={t("saleCount")}
              value={format.number(summary!.saleCount)}
              plain
            />
            <StatCard title={t("avgBasket")} value={formatEgp(summary!.avgBasket, locale)} />
            <StatCard
              title={t("margin")}
              value={profit!.margin == null ? "—" : format.number(profit!.margin, { style: "percent", maximumFractionDigits: 1 })}
              plain
            />
          </div>

          {/* Sales over time */}
          <ChartCard
            title={t("salesOverTime")}
            action={
              <ExportButton
                label={t("export")}
                filename={`sales-over-time-${from}_${to}.csv`}
                headers={[t("colDate"), t("colRevenue"), t("colSales")]}
                rows={overTime.map((p) => [bucketLabel(p.bucketStart), p.revenue, p.saleCount])}
              />
            }
            empty={overTime.length === 0 ? t("empty") : null}
          >
            <TimeSeriesChart
              data={overTime.map((p) => ({ label: bucketLabel(p.bucketStart), revenue: p.revenue }))}
              locale={locale}
              rtl={rtl}
            />
          </ChartCard>

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard
              title={t("topByRevenue")}
              action={
                <ExportButton
                  label={t("export")}
                  filename={`top-products-revenue-${from}_${to}.csv`}
                  headers={[t("colProduct"), t("colQty"), t("colRevenue")]}
                  rows={topRevenue.map((p) => [name(p.nameAr, p.nameEn), p.qty, p.revenue])}
                />
              }
              empty={topRevenue.length === 0 ? t("empty") : null}
            >
              <CategoricalBarChart
                data={topRevenue.map((p) => ({ label: name(p.nameAr, p.nameEn), value: p.revenue }))}
                locale={locale}
                rtl={rtl}
                kind="currency"
              />
            </ChartCard>

            <ChartCard
              title={t("topByQty")}
              action={
                <ExportButton
                  label={t("export")}
                  filename={`top-products-qty-${from}_${to}.csv`}
                  headers={[t("colProduct"), t("colQty"), t("colRevenue")]}
                  rows={topQty.map((p) => [name(p.nameAr, p.nameEn), p.qty, p.revenue])}
                />
              }
              empty={topQty.length === 0 ? t("empty") : null}
            >
              <CategoricalBarChart
                data={topQty.map((p) => ({ label: name(p.nameAr, p.nameEn), value: p.qty }))}
                locale={locale}
                rtl={rtl}
                kind="number"
              />
            </ChartCard>

            <ChartCard
              title={t("salesByCategory")}
              action={
                <ExportButton
                  label={t("export")}
                  filename={`sales-by-category-${from}_${to}.csv`}
                  headers={[t("colCategory"), t("colQty"), t("colRevenue")]}
                  rows={byCategory.map((c) => [
                    c.categoryId ? name(c.nameAr, c.nameEn) : t("uncategorized"),
                    c.qty,
                    c.revenue,
                  ])}
                />
              }
              empty={byCategory.length === 0 ? t("empty") : null}
            >
              <CategoricalBarChart
                data={byCategory.map((c) => ({
                  label: c.categoryId ? name(c.nameAr, c.nameEn) : t("uncategorized"),
                  value: c.revenue,
                }))}
                locale={locale}
                rtl={rtl}
                kind="currency"
              />
            </ChartCard>

            <ChartCard
              title={t("salesByCashier")}
              action={
                <ExportButton
                  label={t("export")}
                  filename={`sales-by-cashier-${from}_${to}.csv`}
                  headers={[t("colCashier"), t("colSales"), t("colRevenue")]}
                  rows={byCashier.map((c) => [c.fullName, c.saleCount, c.revenue])}
                />
              }
              empty={byCashier.length === 0 ? t("empty") : null}
            >
              <CategoricalBarChart
                data={byCashier.map((c) => ({ label: c.fullName, value: c.revenue }))}
                locale={locale}
                rtl={rtl}
                kind="currency"
              />
            </ChartCard>
          </div>

          {/* Profit */}
          <Card>
            <CardHeader>
              <CardTitle>{t("profitTitle")}</CardTitle>
              <CardDescription>{t("profitNote")}</CardDescription>
              <CardAction>
                <ExportButton
                  label={t("export")}
                  filename={`profit-${from}_${to}.csv`}
                  headers={[t("netRevenue"), t("cost"), t("profit"), t("margin")]}
                  rows={[[profit!.netRevenue, profit!.cost, profit!.profit, profit!.margin ?? 0]]}
                />
              </CardAction>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-4">
              <Metric label={t("netRevenue")} value={formatEgp(profit!.netRevenue, locale)} />
              <Metric label={t("cost")} value={formatEgp(profit!.cost, locale)} />
              <Metric label={t("profit")} value={formatEgp(profit!.profit, locale)} />
              <Metric
                label={t("margin")}
                value={
                  profit!.margin == null
                    ? "—"
                    : format.number(profit!.margin, { style: "percent", maximumFractionDigits: 1 })
                }
              />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function StatCard({ title, value, plain }: { title: string; value: string; plain?: boolean }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-2xl tabular-nums" dir={plain ? undefined : "ltr"}>
          {value}
        </CardTitle>
      </CardHeader>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-muted-foreground text-sm">{label}</span>
      <span className="text-lg font-semibold tabular-nums" dir="ltr">
        {value}
      </span>
    </div>
  );
}

function ChartCard({
  title,
  action,
  empty,
  children,
}: {
  title: string;
  action: React.ReactNode;
  empty: string | null;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>{title}</CardTitle>
        <CardAction>{action}</CardAction>
      </CardHeader>
      <CardContent className="pt-4">
        {empty ? (
          <p className="text-muted-foreground py-10 text-center text-sm">{empty}</p>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}
