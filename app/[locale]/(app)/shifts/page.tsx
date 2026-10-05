import { setRequestLocale, getTranslations, getFormatter } from "next-intl/server";
import { ChevronLeft, ChevronRight, ReceiptText } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { getActiveShift, getShifts } from "@/lib/supabase/queries/shifts";
import { formatEgp } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CloseShiftDialog } from "@/components/shifts/close-shift-dialog";
import { CashDrawerEventDialog } from "@/components/shifts/cash-drawer-event-dialog";
import { OpenShiftForm } from "@/components/shifts/open-shift-form";

export default async function ShiftsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);

  const [t, format, active, result] = await Promise.all([
    getTranslations("shifts"),
    getFormatter(),
    getActiveShift(),
    getShifts(page),
  ]);

  const money = (v: number | null) => (v === null ? "—" : formatEgp(Number(v), locale));
  const overShort = (expected: number | null, counted: number | null) => {
    if (expected === null || counted === null) return null;
    return Number(counted) - Number(expected);
  };

  return (
    <div className="flex w-full flex-col gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">{t("current")}</CardTitle>
          {active && <div className="flex items-center gap-2"><CashDrawerEventDialog shiftId={active.id} /><CloseShiftDialog shiftId={active.id} /></div>}
        </CardHeader>
        <CardContent>
          {active ? (
            <div className="text-muted-foreground flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <span>
                {t("openedAt")}:{" "}
                {format.dateTime(new Date(active.opened_at), {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </span>
              <span dir="ltr" className="tabular-nums">
                {t("openingFloat")}: {money(active.opening_float)}
              </span>
            </div>
          ) : (
            <div className="flex flex-col items-start gap-3">
              <p className="text-muted-foreground text-sm">{t("noneOpen")}</p>
              <OpenShiftForm />
            </div>
          )}
        </CardContent>
      </Card>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("colCashier")}</TableHead>
              <TableHead>{t("colOpened")}</TableHead>
              <TableHead>{t("colClosed")}</TableHead>
              <TableHead className="text-end">{t("colFloat")}</TableHead>
              <TableHead className="text-end">{t("colExpected")}</TableHead>
              <TableHead className="text-end">{t("colCounted")}</TableHead>
              <TableHead className="text-end">{t("colOverShort")}</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-muted-foreground h-24 text-center">
                  {t("empty")}
                </TableCell>
              </TableRow>
            )}
            {result.rows.map((shift) => {
              const diff = overShort(shift.expected_cash, shift.closing_counted);
              return (
                <TableRow key={shift.id}>
                  <TableCell>{shift.profiles?.full_name ?? "—"}</TableCell>
                  <TableCell>
                    {format.dateTime(new Date(shift.opened_at), {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </TableCell>
                  <TableCell>
                    {shift.closed_at
                      ? format.dateTime(new Date(shift.closed_at), {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })
                      : t("stillOpen")}
                  </TableCell>
                  <TableCell className="text-end tabular-nums" dir="ltr">
                    {money(shift.opening_float)}
                  </TableCell>
                  <TableCell className="text-end tabular-nums" dir="ltr">
                    {money(shift.expected_cash)}
                  </TableCell>
                  <TableCell className="text-end tabular-nums" dir="ltr">
                    {money(shift.closing_counted)}
                  </TableCell>
                  <TableCell
                    className={
                      "text-end tabular-nums " +
                      (diff === null
                        ? ""
                        : diff < 0
                          ? "text-destructive"
                          : "text-green-600 dark:text-green-500")
                    }
                    dir="ltr"
                  >
                    {diff === null ? "—" : `${diff > 0 ? "+" : ""}${formatEgp(diff, locale)}`}
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" asChild aria-label={t("zReport")}>
                      <Link href={`/shifts/${shift.id}`}>
                        <ReceiptText className="size-4" />
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {result.pageCount > 1 && (
        <div className="flex items-center justify-end gap-2">
          <span className="text-muted-foreground text-sm">
            {t("pageOf", { page: result.page, pageCount: result.pageCount })}
          </span>
          {result.page <= 1 ? (
            <Button variant="outline" size="icon" disabled aria-label={t("previousPage")}>
              <ChevronLeft className="size-4 rtl:rotate-180" />
            </Button>
          ) : (
            <Button variant="outline" size="icon" asChild aria-label={t("previousPage")}>
              <Link href={`/shifts?page=${result.page - 1}`}>
                <ChevronLeft className="size-4 rtl:rotate-180" />
              </Link>
            </Button>
          )}
          {result.page >= result.pageCount ? (
            <Button variant="outline" size="icon" disabled aria-label={t("nextPage")}>
              <ChevronRight className="size-4 rtl:rotate-180" />
            </Button>
          ) : (
            <Button variant="outline" size="icon" asChild aria-label={t("nextPage")}>
              <Link href={`/shifts?page=${result.page + 1}`}>
                <ChevronRight className="size-4 rtl:rotate-180" />
              </Link>
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
