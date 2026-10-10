import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link, redirect } from "@/i18n/navigation";
import { Badge } from "@/components/ui/badge";
import { PurchaseOrderActions } from "@/components/purchasing/po-actions";
import { ReceiveDialog } from "@/components/purchasing/receive-dialog";
import { formatEgp } from "@/lib/money";
import { getCurrentProfile } from "@/lib/supabase/queries/profiles";
import { getPurchaseOrder } from "@/lib/supabase/queries/purchasing";
import { canCountStock } from "@/lib/supabase/queries/stocktakes";

export default async function PurchaseOrderPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  if (!(await canCountStock())) redirect({ href: "/register", locale });

  const [t, detail, profile] = await Promise.all([getTranslations("purchaseOrders"), getPurchaseOrder(id), getCurrentProfile()]);
  if (!detail) notFound();
  const { order, lines, receipts, overReceiptTolerancePct } = detail;
  const isAdmin = profile?.role === "admin";
  const open = order.status === "ordered" || order.status === "partially_received";
  const when = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });

  const orderedTotal = lines.reduce((sum, line) => sum + Math.round(Number(line.ordered_qty) * Number(line.unit_cost)), 0);
  const orderedVat = lines.reduce(
    (sum, line) => sum + Math.round(Number(line.ordered_qty) * Number(line.unit_cost) * Number(line.tax_rate)),
    0
  );

  return (
    <div className="flex w-full flex-col gap-4">
      <div>
        <Link className="text-muted-foreground text-sm hover:underline" href="/purchase-orders">
          {t("back")}
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">PO-{order.po_number}</h1>
          <Badge variant={order.status === "received" ? "outline" : "secondary"}>{t(`status.${order.status}`)}</Badge>
        </div>
        <p className="text-muted-foreground text-sm break-words">
          {order.supplier_name}
          {order.note ? ` · ${order.note}` : ""}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {isAdmin && <PurchaseOrderActions poId={order.id} status={order.status} />}
        {open && <ReceiveDialog poId={order.id} lines={lines} tolerancePct={overReceiptTolerancePct} />}
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="p-3 text-start">{t("colProduct")}</th>
              <th className="p-3 text-start">{t("colOrdered")}</th>
              <th className="p-3 text-start">{t("colReceived")}</th>
              <th className="p-3 text-start">{t("colRemaining")}</th>
              <th className="p-3 text-start">{t("colUnitCost")}</th>
              <th className="p-3 text-start">{t("colVat")}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const remaining = Math.max(0, Number(line.ordered_qty) - Number(line.received_qty));
              return (
                <tr key={line.id} className="border-b last:border-0">
                  <td className="p-3">
                    <div className="font-medium">{locale === "ar" ? line.name_ar : line.name_en}</div>
                    <div className="text-muted-foreground text-xs tabular-nums" dir="ltr">{line.barcode}</div>
                  </td>
                  <td className="p-3 tabular-nums" dir="ltr">{Number(line.ordered_qty)}</td>
                  <td className="p-3 tabular-nums" dir="ltr">{Number(line.received_qty)}</td>
                  <td className="p-3 tabular-nums" dir="ltr">{remaining}</td>
                  <td className="p-3 tabular-nums" dir="ltr">{formatEgp(Number(line.unit_cost), locale)}</td>
                  <td className="p-3 tabular-nums" dir="ltr">{Math.round(Number(line.tax_rate) * 100)}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-muted-foreground text-sm">
        {t("totalExVat")}: <span className="text-foreground tabular-nums" dir="ltr">{formatEgp(orderedTotal, locale)}</span>
        {" · "}
        {t("vat")}: <span className="text-foreground tabular-nums" dir="ltr">{formatEgp(orderedVat, locale)}</span>
      </p>

      <h2 className="mt-2 text-lg font-semibold">{t("receipts")}</h2>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="p-3 text-start">{t("colReceipt")}</th>
              <th className="p-3 text-start">{t("invoiceReference")}</th>
              <th className="p-3 text-start">{t("colWhen")}</th>
              <th className="p-3 text-start">{t("colReceivedValue")}</th>
            </tr>
          </thead>
          <tbody>
            {receipts.map((receipt) => (
              <tr key={receipt.id} className="border-b last:border-0">
                <td className="p-3 tabular-nums">GR-{receipt.receipt_number}</td>
                <td className="p-3" dir="ltr">{receipt.invoice_reference ?? "—"}</td>
                <td className="p-3">{when.format(new Date(receipt.received_at))}</td>
                <td className="p-3 tabular-nums" dir="ltr">
                  {formatEgp(
                    receipt.goods_receipt_lines.reduce((sum, line) => sum + Math.round(Number(line.qty) * Number(line.unit_cost)), 0),
                    locale
                  )}
                </td>
              </tr>
            ))}
            {receipts.length === 0 && (
              <tr>
                <td className="text-muted-foreground p-6 text-center" colSpan={4}>
                  {t("noReceipts")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
