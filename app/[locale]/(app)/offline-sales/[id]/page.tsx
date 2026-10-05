import { setRequestLocale } from "next-intl/server";
import { ProvisionalReceiptView } from "@/components/offline/provisional-receipt-view";

export default async function ProvisionalReceiptPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  return <ProvisionalReceiptView id={id} />;
}
