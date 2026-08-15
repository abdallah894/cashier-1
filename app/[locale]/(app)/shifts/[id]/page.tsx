import { notFound } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { getShiftWithSales } from "@/lib/supabase/queries/shifts";
import { buildZReport } from "@/lib/receipts/z-report";
import { ZReport80mm } from "@/components/shifts/z-report-80mm";
import { PrintButton } from "@/components/receipts/print-button";

export default async function ZReportPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const [t, data] = await Promise.all([getTranslations("shifts"), getShiftWithSales(id)]);
  if (!data) notFound();

  const report = buildZReport(data.shift, data);

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">{t("zReport")}</h1>
      {report.closedAt === null ? (
        <p className="text-muted-foreground text-sm">{t("shiftStillOpen")}</p>
      ) : (
        <div className="print:hidden">
          <PrintButton />
        </div>
      )}
      <div className="receipt-print-area self-center overflow-hidden rounded-md border shadow-sm">
        <ZReport80mm report={report} />
      </div>
    </div>
  );
}
