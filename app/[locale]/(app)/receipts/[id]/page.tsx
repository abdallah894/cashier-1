import { notFound } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { getSaleTenders, getSaleWithItems } from "@/lib/supabase/queries/sales";
import { buildReceipt } from "@/lib/receipts/build";
import { Receipt80mm } from "@/components/receipts/receipt-80mm";
import { ReceiptActions } from "@/components/receipts/receipt-actions";
import { ReturnDialog } from "@/components/receipts/return-dialog";
import { ReturnHistory } from "@/components/receipts/return-history";

export default async function ReceiptPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ new?: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const [t, sale, sp, tenders] = await Promise.all([
    getTranslations("receipt"),
    getSaleWithItems(id),
    searchParams,
    getSaleTenders(id),
  ]);
  if (!sale) notFound();
  const receipt = buildReceipt(sale);

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">
        {t("title", { number: receipt.saleNumber })}
      </h1>
      <div className="flex flex-wrap gap-2">
        <ReceiptActions receipt={receipt} justCompleted={sp.new === "1"} />
        <ReturnDialog
          saleId={sale.id}
          tenders={tenders}
          lines={sale.sale_items.map((item) => {
            const returnedQty = (sale.returns ?? []).flatMap((entry) => entry.return_items)
              .filter((returnItem) => returnItem.sale_item_id === item.id)
              .reduce((total, returnItem) => total + Number(returnItem.qty), 0);
            return {
              id: item.id,
              name_ar: item.name_ar,
              name_en: item.name_en,
              qty: Number(item.qty),
              remainingQty: Math.max(0, Number(item.qty) - returnedQty),
              line_total: Number(item.line_total),
            };
          })}
        />
      </div>
      <div className="receipt-print-area self-center overflow-hidden rounded-md border shadow-sm">
        <Receipt80mm receipt={receipt} />
      </div>
      <ReturnHistory returns={sale.returns ?? []} />
    </div>
  );
}
