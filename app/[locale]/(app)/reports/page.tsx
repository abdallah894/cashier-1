import { setRequestLocale, getTranslations, getFormatter } from "next-intl/server";
import { requireAdmin } from "@/lib/supabase/queries/profiles";
import { getDirection, type Locale } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";
import { formatEgp } from "@/lib/money";
import {
  businessToday,
  defaultRange,
  getSummary,
  getSalesOverTime,
  getTopProducts,
  getSalesByCategory,
  getSalesByCashier,
  getProfit,
  type Bucket,
} from "@/lib/supabase/queries/reports";
import { getOpenShiftCount } from "@/lib/supabase/queries/shifts";
import { getReorderAlerts } from "@/lib/supabase/queries/ops-reports";
import { optionalQuery } from "@/lib/supabase/queries/optional";
import { PageHeader } from "@/components/layout/page-header";
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
import { ReportsNav } from "@/components/reports/reports-nav";
import { Clock, PackageMinus, ReceiptText, ShoppingBasket, type LucideIcon } from "lucide-react";

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
  const fallback = await defaultRange();
  const from = sp.from || fallback.from;
  const to = sp.to || fallback.to;
  const bucket: Bucket = sp.bucket === "week" || sp.bucket === "month" ? sp.bucket : "day";
  const rangeValid = from <= to;
  const range = { from, to };

  const bucketLabel = (iso: string) => {
    const d = new Date(iso);
    // bucket_start is a business DATE stored at 00:00 UTC, so format it in UTC
    return bucket === "month"
      ? format.dateTime(d, { year: "numeric", month: "short", timeZone: "UTC" })
      : format.dateTime(d, { day: "2-digit", month: "short", timeZone: "UTC" });
  };

  // today at a glance: each tile degrades to "—" on its own instead of breaking the page
  const today = await businessToday();
  const [todaySummary, openShifts, lowStock] = await Promise.all([
    optionalQuery("today_summary", () => getSummary({ from: today, to: today }), null),
    optionalQuery("open_shifts", () => getOpenShiftCount(), null),
    optionalQuery("low_stock", async () => (await getReorderAlerts()).length, null),
  ]);

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
      <PageHeader className="mb-0" title={t("title")} description={t("subtitle")} />

      <section aria-labelledby="today-heading" className="flex flex-col gap-3">
        <h2 id="today-heading" className="text-lg font-semibold">
          {t("today.title")}
        </h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <GlanceTile
            icon={ShoppingBasket}
            label={t("today.sales")}
            value={todaySummary ? formatEgp(todaySummary.netRevenue, locale) : "—"}
            hint={todaySummary ? t("today.avgBasket", { amount: formatEgp(todaySummary.avgBasket, locale) }) : undefined}
            href="/reports/daily"
          />
          <GlanceTile
            icon={ReceiptText}
            label={t("today.receipts")}
            value={todaySummary ? format.number(todaySummary.saleCount) : "—"}
            href="/receipts"
          />
          <GlanceTile
            icon={Clock}
            label={t("today.openShifts")}
            value={openShifts === null ? "—" : format.number(openShifts)}
            href="/shifts"
          />
          <GlanceTile
            icon={PackageMinus}
            label={t("today.lowStock")}
            value={lowStock === null ? "—" : format.number(lowStock)}
            tone={lowStock ? "warning" : undefined}
            href="/stock-alerts"
          />
        </div>
      </section>

      <ReportsNav active="overview" />

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
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
            <StatCard title={t("grossSales")} value={formatEgp(summary!.revenue, locale)} />
            <StatCard title={t("refunds")} value={`-${formatEgp(summary!.refunds, locale)}`} />
            <StatCard title={t("netSales")} value={formatEgp(summary!.netRevenue, locale)} />
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
            <CardContent className="grid grid-cols-2 gap-4 lg:grid-cols-4">
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
        <CardTitle className="text-xl tabular-nums break-words sm:text-2xl" dir={plain ? undefined : "ltr"}>
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

/** One "today" number that opens the page with the details. */
function GlanceTile({
  icon: Icon,
  label,
  value,
  hint,
  href,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint?: string;
  href: string;
  tone?: "warning";
}) {
  return (
    <Link
      href={href}
      className="bg-card hover:border-primary focus-visible:ring-ring flex min-w-0 flex-col gap-2 rounded-xl border p-4 transition-colors outline-none focus-visible:ring-2"
    >
      <span className="text-muted-foreground flex items-center gap-2 text-sm">
        <span
          className={
            "flex size-8 shrink-0 items-center justify-center rounded-lg " +
            (tone === "warning" ? "bg-amber-500/15 text-amber-700 dark:text-amber-400" : "bg-accent text-accent-foreground")
          }
        >
          <Icon className="size-4" />
        </span>
        <span className="truncate">{label}</span>
      </span>
      <span className="text-2xl font-bold tabular-nums break-words" dir="ltr">
        {value}
      </span>
      {hint ? <span className="text-muted-foreground text-xs">{hint}</span> : null}
    </Link>
  );
}
