import { useFormatter, useLocale, useTranslations } from "next-intl";
import { formatEgp } from "@/lib/money";
import type { ZReportData } from "@/lib/receipts/z-report";
import { Row, Dashes } from "@/components/receipts/receipt-primitives";

/** Printable end-of-shift Z-report — same 80mm/.receipt-print-area seam
 *  as sale receipts, so the future ESC/POS driver covers both. */
export function ZReport80mm({ report }: { report: ZReportData }) {
  const t = useTranslations("shifts");
  const format = useFormatter();
  const locale = useLocale();
  const isAr = locale === "ar";
  const money = (v: number) => formatEgp(v, locale);
  const dateTime = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: "short", timeStyle: "short" });

  return (
    <div className="w-[80mm] bg-white px-[4mm] py-[5mm] text-[11px] leading-snug text-black">
      <div className="text-center">
        <div className="text-sm font-bold">{isAr ? report.store.nameAr : report.store.nameEn}</div>
        <div className="font-semibold">{t("zReport")}</div>
      </div>

      <Dashes />

      {report.cashierName && <Row label={t("colCashier")} value={report.cashierName} ltr={false} />}
      <Row label={t("openedAt")} value={dateTime(report.openedAt)} />
      {report.closedAt && <Row label={t("closedAt")} value={dateTime(report.closedAt)} />}
      {report.closedAt && (
        <Row label={t("duration")} value={formatDuration(report.openedAt, report.closedAt)} />
      )}
      <Row label={t("saleCount")} value={String(report.saleCount)} />

      <Dashes />

      <Row label={t("openingFloat")} value={money(report.openingFloat)} />
      <Row label={t("cashSales")} value={money(report.cashSales)} />
      {report.paidIn !== 0 && <Row label={t("paid_in")} value={money(report.paidIn)} />}
      {report.paidOut !== 0 && <Row label={t("paid_out")} value={money(report.paidOut)} />}
      {report.safeDrops !== 0 && <Row label={t("safe_drop")} value={money(report.safeDrops)} />}
      {report.cashRefunds !== 0 && <Row label={t("cashRefunds")} value={money(report.cashRefunds)} />}
      <Row label={t("cardSales")} value={money(report.cardSales)} />
      <Row label={t("totalSales")} value={money(report.totalSales)} />

      <Dashes />

      {report.expectedCash !== null && (
        <Row label={t("expectedCash")} value={money(report.expectedCash)} />
      )}
      {report.counted !== null && <Row label={t("countedCash")} value={money(report.counted)} />}
      {report.overShort !== null && (
        <div className="mt-1 flex items-baseline justify-between border-t border-dashed border-black pt-1 text-sm font-bold">
          <span>{t("overShort")}</span>
          <span className="tabular-nums" dir="ltr">
            {report.overShort > 0 ? "+" : ""}
            {money(report.overShort)}
          </span>
        </div>
      )}
    </div>
  );
}

function formatDuration(openedAt: string, closedAt: string): string {
  const mins = Math.max(
    0,
    Math.round((new Date(closedAt).getTime() - new Date(openedAt).getTime()) / 60000)
  );
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}
