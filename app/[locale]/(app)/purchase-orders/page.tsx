import { getTranslations, setRequestLocale } from "next-intl/server";
import { Plus } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireAdmin } from "@/lib/supabase/queries/profiles";
import { getPurchaseOrders } from "@/lib/supabase/queries/purchasing";

export default async function PurchaseOrdersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAdmin();
  const [t, orders] = await Promise.all([getTranslations("purchaseOrders"), getPurchaseOrders()]);
  const when = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground max-w-prose text-sm">{t("pageDescription")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href="/purchase-orders/reports">{t("reports")}</Link>
          </Button>
          <Button asChild>
            <Link href="/purchase-orders/new">
              <Plus className="size-4" />
              {t("new")}
            </Link>
          </Button>
        </div>
      </div>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="p-3 text-start">{t("colNumber")}</th>
              <th className="p-3 text-start">{t("supplier")}</th>
              <th className="p-3 text-start">{t("colStatus")}</th>
              <th className="p-3 text-start">{t("expectedDate")}</th>
              <th className="p-3 text-start">{t("colCreated")}</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id} className="border-b last:border-0">
                <td className="p-3 tabular-nums">
                  <Link className="text-primary underline-offset-4 hover:underline" href={`/purchase-orders/${order.id}`}>
                    PO-{order.po_number}
                  </Link>
                </td>
                <td className="p-3">{order.supplier_name}</td>
                <td className="p-3">
                  <Badge variant={order.status === "received" ? "outline" : "secondary"}>{t(`status.${order.status}`)}</Badge>
                </td>
                <td className="p-3">{order.expected_date ? when.format(new Date(order.expected_date)) : "—"}</td>
                <td className="p-3">{when.format(new Date(order.created_at))}</td>
              </tr>
            ))}
            {orders.length === 0 && (
              <tr>
                <td className="text-muted-foreground p-6 text-center" colSpan={5}>
                  {t("empty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
