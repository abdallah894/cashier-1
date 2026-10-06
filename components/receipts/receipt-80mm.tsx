import { useFormatter, useLocale, useTranslations } from "next-intl";
import { formatEgp } from "@/lib/money";
import type { ReceiptData } from "@/lib/receipts/types";
import { ReceiptQr } from "./receipt-qr";
import { Row, Dashes } from "./receipt-primitives";

// Server component — next-intl's use* hooks work in RSC (in Vue terms:
// this is like useI18n() working inside a server-rendered component).
// Deliberately black-on-white: paper has no dark mode.
export function Receipt80mm({ receipt, gift = false }: { receipt: ReceiptData; gift?: boolean }) {
  const t = useTranslations("receipt");
  const format = useFormatter();
  const locale = useLocale();
  const isAr = locale === "ar";
  const money = (v: number) => formatEgp(v, locale);

  return (
    <div className="w-[80mm] bg-white px-[4mm] py-[5mm] text-[11px] leading-snug text-black">
      {/* store header — configurable constants from lib/receipts/store-info */}
      <div className="text-center">
        <div className="text-sm font-bold">{isAr ? receipt.store.nameAr : receipt.store.nameEn}</div>
        {(isAr ? receipt.store.addressAr : receipt.store.addressEn) && (
          <div>{isAr ? receipt.store.addressAr : receipt.store.addressEn}</div>
        )}
        {receipt.store.phone && <div dir="ltr">{receipt.store.phone}</div>}
        {receipt.store.taxId && <div>{t("taxId", { id: receipt.store.taxId })}</div>}
      </div>

      <Dashes />

      {gift && <div className="mt-1 border border-black p-1 text-center font-bold">{t("giftTitle")}</div>}
      {receipt.provisionalLabel && (
        <div className="mb-1 border border-black p-1 text-center font-bold">{t("provisional")}</div>
      )}
      <Row label={t("saleNo")} value={receipt.provisionalLabel ?? `#${receipt.saleNumber}`} />
      <Row
        label={t("date")}
        value={format.dateTime(new Date(receipt.createdAt), {
          dateStyle: "short",
          timeStyle: "short",
        })}
      />
      {receipt.cashierName && <Row label={t("cashier")} value={receipt.cashierName} ltr={false} />}

      <Dashes />

      {/* line items — names in the current UI language, from the snapshots */}
      {receipt.lines.map((line, i) => (
        <div key={i} className="mb-1">
          <div className="font-semibold">{isAr ? line.nameAr : line.nameEn}</div>
          {gift ? (
            <div className="tabular-nums" dir="ltr">
              × {format.number(line.qty)}
            </div>
          ) : (
            <>
              <Row
                label={
                  <span className="tabular-nums" dir="ltr">
                    {format.number(line.qty)} × {money(line.unitPrice)}
                  </span>
                }
                value={money(line.lineTotal + line.lineDiscount)}
              />
              {line.lineDiscount > 0 && (
                <Row label={t("discount")} value={`-${money(line.lineDiscount)}`} />
              )}
            </>
          )}
        </div>
      ))}

      <Dashes />

      {gift ? (
        <div className="py-1 text-center">{t("giftNote")}</div>
      ) : (
        <>
        <Row label={t("subtotal")} value={money(receipt.subtotal)} />
        {receipt.vatBreakdown.map((row) => (
          <Row
            key={row.rateBp}
            label={t("vatRate", { rate: row.rateBp / 100 })}
            value={money(row.tax)}
          />
        ))}
        {receipt.discountTotal > 0 && (
          <Row label={t("discount")} value={`-${money(receipt.discountTotal)}`} />
        )}

        <div className="mt-1 flex items-baseline justify-between border-t border-dashed border-black pt-1 text-sm font-bold">
          <span>{t("total")}</span>
          <span className="tabular-nums" dir="ltr">
            {money(receipt.total)}
          </span>
        </div>

        <Row label={t("paymentMethod")} value={t(`payment.${receipt.paymentMethod}`)} ltr={false} />
        {receipt.amountTendered !== null && (
          <>
            <Row label={t("tendered")} value={money(receipt.amountTendered)} />
            <Row label={t("change")} value={money(receipt.changeDue ?? 0)} />
          </>
        )}

        </>
      )}

      <Dashes />

      <div className="flex flex-col items-center gap-1 pt-1 text-center">
        <ReceiptQr value={receipt.qrValue} className="size-[18mm]" />
        <div className="tabular-nums" dir="ltr">
          {receipt.provisionalLabel ?? `#${receipt.saleNumber}`}
        </div>
        <div>{t("thankYou")}</div>
        {(isAr ? receipt.store.footerAr : receipt.store.footerEn) && (
          <div>{isAr ? receipt.store.footerAr : receipt.store.footerEn}</div>
        )}
      </div>
    </div>
  );
}
