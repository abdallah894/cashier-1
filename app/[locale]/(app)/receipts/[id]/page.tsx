import { notFound } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { getSaleWithItems } from "@/lib/supabase/queries/sales";
import { buildReceipt } from "@/lib/receipts/build";
import { Receipt80mm } from "@/components/receipts/receipt-80mm";
import { ReceiptActions } from "@/components/receipts/receipt-actions";

export default async function ReceiptPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ new?: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const [t, sale, sp] = await Promise.all([
    getTranslations("receipt"),
    getSaleWithItems(id),
    searchParams,
  ]);
  if (!sale) notFound();
  const receipt = buildReceipt(sale);

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">
        {t("title", { number: receipt.saleNumber })}
      </h1>
      <ReceiptActions receipt={receipt} justCompleted={sp.new === "1"} />
      <div className="receipt-print-area self-center overflow-hidden rounded-md border shadow-sm">
        <Receipt80mm receipt={receipt} />
      </div>
    </div>
  );
}
