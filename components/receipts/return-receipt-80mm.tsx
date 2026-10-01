import { useFormatter, useLocale, useTranslations } from "next-intl";
import { formatEgp } from "@/lib/money";
import type { ReturnReceiptData } from "@/lib/receipts/build-return";
import { Dashes, Row } from "./receipt-primitives";

export function ReturnReceipt80mm({ receipt }: { receipt: ReturnReceiptData }) {
  const t = useTranslations("returns");
  const format = useFormatter();
  const locale = useLocale();
  const isAr = locale === "ar";
  return (
    <div className="w-[80mm] bg-white px-[4mm] py-[5mm] text-[11px] leading-snug text-black">
      <div className="text-center"><div className="text-sm font-bold">{isAr ? receipt.store.nameAr : receipt.store.nameEn}</div><div>{t("receiptTitle")}</div></div>
      <Dashes />
      <Row label={t("historyNumber", { number: receipt.returnNumber })} value={t("originalReceipt", { number: receipt.originalSaleNumber })} />
      <Row label={t("receiptDate")} value={format.dateTime(new Date(receipt.createdAt), { dateStyle: "short", timeStyle: "short" })} />
      {receipt.lines.map((line, index) => <div key={index}><div className="font-semibold">{isAr ? line.name_ar : line.name_en}</div><Row label={`${format.number(line.qty)} × ${formatEgp(line.unit_price, locale)}`} value={formatEgp(line.line_refund_total, locale)} /></div>)}
      <Dashes />
      <Row label={t("reason")} value={receipt.reason} ltr={false} />
      <Row label={receipt.restocked ? t("historyRestocked") : t("historyNotRestocked")} value="" />
      <div className="mt-1 flex justify-between border-t border-dashed border-black pt-1 text-sm font-bold"><span>{t("refundTotal")}</span><span dir="ltr">{formatEgp(receipt.refundTotal, locale)}</span></div>
    </div>
  );
}
