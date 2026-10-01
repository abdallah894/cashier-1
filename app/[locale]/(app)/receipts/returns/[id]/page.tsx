import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { getReturnWithItems } from "@/lib/supabase/queries/sales";
import { buildReturnReceipt } from "@/lib/receipts/build-return";
import { ReturnReceipt80mm } from "@/components/receipts/return-receipt-80mm";

export default async function ReturnReceiptPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const record = await getReturnWithItems(id);
  if (!record) notFound();
  const receipt = buildReturnReceipt(record);
  return <div className="mx-auto w-full max-w-sm"><div className="receipt-print-area self-center overflow-hidden rounded-md border shadow-sm"><ReturnReceipt80mm receipt={receipt} /></div></div>;
}
