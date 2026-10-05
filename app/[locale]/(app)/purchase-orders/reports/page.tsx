import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { ExportButton } from "@/components/reports/export-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatEgp } from "@/lib/money";
import { requireAdmin } from "@/lib/supabase/queries/profiles";
import { getOutstandingPurchaseOrders, getReceivedCost } from "@/lib/supabase/queries/purchasing";

const DAY_MS = 86_400_000;
const isoDay = (value: string | undefined, fallback: Date) => {
  const date = value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00Z`) : fallback;
  return Number.isNaN(date.getTime()) ? fallback : date;
};

export default async function PurchasingReportsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAdmin();
  const sp = await searchParams;

  const now = new Date();
  const from = isoDay(sp.from, new Date(now.getTime() - 30 * DAY_MS));
  const to = isoDay(sp.to, now);
  const toEnd = new Date(to.getTime() + DAY_MS - 1);

  const [t, outstanding, received] = await Promise.all([
    getTranslations("purchaseOrders"),
    getOutstandingPurchaseOrders(),
    getReceivedCost(from.toISOString(), toEnd.toISOString()),
  ]);
  const day = (date: Date) => date.toISOString().slice(0, 10);

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">{t("reportsTitle")}</h1>
        <Button asChild variant="outline">
          <Link href="/purchase-orders">{t("back")}</Link>
        </Button>
      </div>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t("outstandingTitle")}</h2>
          <ExportButton
            label={t("exportCsv")}
            filename="outstanding-purchase-orders.csv"
            headers={["po", "supplier", "product", "ordered", "received", "remaining", "unit_cost_piasters", "remaining_value_piasters"]}
            rows={outstanding.map((row) => [
              `PO-${row.po_number}`,
              row.supplier_name,
              row.name_en,
              Number(row.ordered_qty),
              Number(row.received_qty),
              Number(row.remaining_qty),
              Number(row.unit_cost),
              Number(row.remaining_value),
            ])}
          />
        </div>
        <div className="rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="p-3 text-start">{t("colNumber")}</th>
                <th className="p-3 text-start">{t("supplier")}</th>
                <th className="p-3 text-start">{t("colProduct")}</th>
                <th className="p-3 text-start">{t("colRemaining")}</th>
                <th className="p-3 text-start">{t("colRemainingValue")}</th>
              </tr>
            </thead>
            <tbody>
              {outstanding.map((row) => (
                <tr key={`${row.po_id}-${row.product_id}`} className="border-b last:border-0">
                  <td className="p-3 tabular-nums">
                    <Link className="text-primary hover:underline" href={`/purchase-orders/${row.po_id}`}>
                      PO-{row.po_number}
                    </Link>
                  </td>
                  <td className="p-3">{row.supplier_name}</td>
                  <td className="p-3">{locale === "ar" ? row.name_ar : row.name_en}</td>
                  <td className="p-3 tabular-nums" dir="ltr">{Number(row.remaining_qty)}</td>
                  <td className="p-3 tabular-nums" dir="ltr">{formatEgp(Number(row.remaining_value), locale)}</td>
                </tr>
              ))}
              {outstanding.length === 0 && (
                <tr>
                  <td className="text-muted-foreground p-6 text-center" colSpan={5}>
                    {t("nothingOutstanding")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 className="text-lg font-semibold">{t("receivedCostTitle")}</h2>
          <form className="flex items-end gap-2" method="get">
            <label className="grid gap-1 text-xs">
              {t("from")}
              <Input type="date" name="from" dir="ltr" defaultValue={day(from)} />
            </label>
            <label className="grid gap-1 text-xs">
              {t("to")}
              <Input type="date" name="to" dir="ltr" defaultValue={day(to)} />
            </label>
            <Button type="submit" variant="outline">
              {t("apply")}
            </Button>
          </form>
        </div>
        <p className="text-muted-foreground text-xs">{t("receivedCostNote")}</p>
        <div className="rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="p-3 text-start">{t("supplier")}</th>
                <th className="p-3 text-start">{t("colReceipts")}</th>
                <th className="p-3 text-start">{t("totalExVat")}</th>
                <th className="p-3 text-start">{t("vat")}</th>
                <th className="p-3 text-start">{t("totalIncVat")}</th>
              </tr>
            </thead>
            <tbody>
              {received.map((row) => (
                <tr key={row.supplier_id} className="border-b last:border-0">
                  <td className="p-3">{row.supplier_name}</td>
                  <td className="p-3 tabular-nums" dir="ltr">{Number(row.receipt_count)}</td>
                  <td className="p-3 tabular-nums" dir="ltr">{formatEgp(Number(row.cost_total), locale)}</td>
                  <td className="p-3 tabular-nums" dir="ltr">{formatEgp(Number(row.vat_total), locale)}</td>
                  <td className="p-3 tabular-nums" dir="ltr">{formatEgp(Number(row.cost_total) + Number(row.vat_total), locale)}</td>
                </tr>
              ))}
              {received.length === 0 && (
                <tr>
                  <td className="text-muted-foreground p-6 text-center" colSpan={5}>
                    {t("nothingReceived")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
