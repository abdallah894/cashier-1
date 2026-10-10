import { getTranslations, setRequestLocale } from "next-intl/server";
import { BellOff } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { AlertActions } from "@/components/reports/alert-actions";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Link, redirect } from "@/i18n/navigation";
import { hasCapability } from "@/lib/supabase/queries/capabilities";
import { getOpenPurchaseOrdersForProduct, getReorderAlerts } from "@/lib/supabase/queries/ops-reports";

export default async function StockAlertsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  if (!(await hasCapability("stock.correct"))) redirect({ href: "/register", locale });

  const [t, alerts] = await Promise.all([getTranslations("opsReports.alerts"), getReorderAlerts()]);
  const orders = await Promise.all(alerts.map((alert) => getOpenPurchaseOrdersForProduct(alert.product_id)));
  const when = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });

  return (
    <div className="flex w-full flex-col gap-4">
      <PageHeader className="mb-0" title={t("title")} description={t("description")} />
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="p-3 text-start">{t("colProduct")}</th>
              <th className="p-3 text-start">{t("colStock")}</th>
              <th className="p-3 text-start">{t("colOpened")}</th>
              <th className="p-3 text-start">{t("colStatus")}</th>
              <th className="p-3" />
            </tr>
          </thead>
          <tbody>
            {alerts.map((alert, index) => (
              <tr key={alert.id} className="border-b align-top last:border-0">
                <td className="p-3">
                  {locale === "ar" ? alert.name_ar : alert.name_en}
                  <div className="text-muted-foreground text-xs" dir="ltr">{alert.barcode}</div>
                </td>
                <td className="p-3 tabular-nums" dir="ltr">{Number(alert.stock_qty_at_alert)} / {Number(alert.threshold)}</td>
                <td className="p-3">{when.format(new Date(alert.opened_at))}</td>
                <td className="p-3">
                  <Badge variant={alert.status === "open" ? "destructive" : "secondary"}>{t(`status.${alert.status}`)}</Badge>
                  {alert.note && <div className="text-muted-foreground mt-1 text-xs">{alert.note}</div>}
                  {alert.po_id && (
                    <Link className="text-primary mt-1 block text-xs hover:underline" href={`/purchase-orders/${alert.po_id}`}>
                      {t("openOrder")}
                    </Link>
                  )}
                </td>
                <td className="p-3">
                  <AlertActions alertId={alert.id} status={alert.status} orders={orders[index]} />
                </td>
              </tr>
            ))}
            {alerts.length === 0 && (
              <tr>
                <td colSpan={5}>
                  <EmptyState icon={BellOff} title={t("empty")} className="py-8" />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
