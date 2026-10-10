import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { PaymentActions } from "@/components/payments/payment-actions";
import { ExportButton } from "@/components/reports/export-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatEgp } from "@/lib/money";
import { getCurrentProfile } from "@/lib/supabase/queries/profiles";
import {
  attentionReason,
  getReconciliationIssues,
  getRecentPayments,
  getTenderSummary,
} from "@/lib/supabase/queries/payments";

const DAY_MS = 86_400_000;
const isoDay = (value: string | undefined, fallback: Date) => {
  const date = value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00Z`) : fallback;
  return Number.isNaN(date.getTime()) ? fallback : date;
};

export default async function PaymentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const profile = await getCurrentProfile();
  const isAdmin = profile?.role === "admin";

  const now = new Date();
  const from = isoDay(sp.from, new Date(now.getTime() - 7 * DAY_MS));
  const to = isoDay(sp.to, now);
  const toEnd = new Date(to.getTime() + DAY_MS - 1);
  const day = (date: Date) => date.toISOString().slice(0, 10);

  const [t, payments, summary, issues] = await Promise.all([
    getTranslations("payments"),
    getRecentPayments(),
    isAdmin ? getTenderSummary(from.toISOString(), toEnd.toISOString()) : Promise.resolve([]),
    isAdmin ? getReconciliationIssues(from.toISOString(), toEnd.toISOString()) : Promise.resolve([]),
  ]);
  const when = new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" });
  const attention = payments
    .map((payment) => ({ payment, reason: attentionReason(payment) }))
    .filter((row): row is { payment: (typeof payments)[number]; reason: NonNullable<ReturnType<typeof attentionReason>> } => row.reason !== null);

  return (
    <div className="flex w-full flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground max-w-prose text-sm">{t("description")}</p>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t("attentionTitle")}</h2>
        {attention.length === 0 ? (
          <p className="text-muted-foreground rounded-md border p-4 text-sm">{t("attentionEmpty")}</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="p-3 text-start">{t("colWhen")}</th>
                  <th className="p-3 text-start">{t("colWhat")}</th>
                  <th className="p-3 text-start">{t("colAmount")}</th>
                  <th className="p-3 text-start">{t("colWhy")}</th>
                  <th className="p-3" />
                </tr>
              </thead>
              <tbody>
                {attention.map(({ payment, reason }) => (
                  <tr key={payment.id} className="border-b align-top last:border-0">
                    <td className="p-3">{when.format(new Date(payment.created_at))}</td>
                    <td className="p-3">
                      {t(`direction.${payment.direction}`)} · {t(`tender.${payment.tender}`)}
                      <div className="text-muted-foreground text-xs" dir="ltr">
                        {payment.provider}
                        {payment.provider_reference ? ` · ${payment.provider_reference}` : ""}
                      </div>
                    </td>
                    <td className="p-3 tabular-nums" dir="ltr">{formatEgp(Number(payment.amount), locale)}</td>
                    <td className="p-3">
                      <Badge variant={reason === "refundFailed" ? "destructive" : "secondary"}>{t(`reason.${reason}`)}</Badge>
                      <div className="text-muted-foreground mt-1 max-w-xs text-xs">{t(`reasonHint.${reason}`)}</div>
                    </td>
                    <td className="p-3">
                      <PaymentActions
                        paymentId={payment.id}
                        reason={reason}
                        hasReference={payment.provider_reference !== null}
                        isAdmin={isAdmin}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {isAdmin && (
        <>
          <form className="flex flex-wrap items-end gap-2" method="get">
            <label className="grid gap-1 text-xs">
              {t("from")}
              <Input type="date" name="from" dir="ltr" defaultValue={day(from)} />
            </label>
            <label className="grid gap-1 text-xs">
              {t("to")}
              <Input type="date" name="to" dir="ltr" defaultValue={day(to)} />
            </label>
            <Button type="submit" variant="outline">{t("apply")}</Button>
          </form>

          <section className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">{t("summaryTitle")}</h2>
              <ExportButton
                label={t("exportCsv")}
                filename="tender-summary.csv"
                headers={["tender", "provider", "charges_piasters", "refunds_piasters", "net_piasters", "payments"]}
                rows={summary.map((row) => [row.tender, row.provider, Number(row.charges), Number(row.refunds), Number(row.net), Number(row.payment_count)])}
              />
            </div>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="p-3 text-start">{t("colTender")}</th>
                    <th className="p-3 text-start">{t("colProvider")}</th>
                    <th className="p-3 text-start">{t("colCharges")}</th>
                    <th className="p-3 text-start">{t("colRefunds")}</th>
                    <th className="p-3 text-start">{t("colNet")}</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.map((row) => (
                    <tr key={`${row.tender}-${row.provider}`} className="border-b last:border-0">
                      <td className="p-3">{t(`tender.${row.tender}`)}</td>
                      <td className="p-3" dir="ltr">{row.provider}</td>
                      <td className="p-3 tabular-nums" dir="ltr">{formatEgp(Number(row.charges), locale)}</td>
                      <td className="p-3 tabular-nums" dir="ltr">{formatEgp(Number(row.refunds), locale)}</td>
                      <td className="p-3 font-semibold tabular-nums" dir="ltr">{formatEgp(Number(row.net), locale)}</td>
                    </tr>
                  ))}
                  {summary.length === 0 && (
                    <tr>
                      <td className="text-muted-foreground p-6 text-center" colSpan={5}>{t("summaryEmpty")}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold">{t("reconciliationTitle")}</h2>
            <p className="text-muted-foreground text-xs">{t("reconciliationNote")}</p>
            {issues.length === 0 ? (
              <p className="rounded-md border p-4 text-sm text-green-700 dark:text-green-500">{t("reconciliationClean")}</p>
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <tbody>
                    {issues.map((issue, index) => (
                      <tr key={`${issue.issue}-${issue.payment_id ?? issue.sale_id}-${index}`} className="border-b last:border-0">
                        <td className="p-3">{when.format(new Date(issue.created_at))}</td>
                        <td className="p-3"><Badge variant="destructive">{t(`issue.${issue.issue}`)}</Badge></td>
                        <td className="p-3 tabular-nums" dir="ltr">{formatEgp(Number(issue.amount), locale)}</td>
                        <td className="p-3 text-xs">
                          {issue.sale_id ? (
                            <Link className="text-primary hover:underline" href={`/receipts/${issue.sale_id}`}>
                              {t("openSale")}
                            </Link>
                          ) : (
                            issue.detail
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t("recentTitle")}</h2>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="p-3 text-start">{t("colWhen")}</th>
                <th className="p-3 text-start">{t("colWhat")}</th>
                <th className="p-3 text-start">{t("colAmount")}</th>
                <th className="p-3 text-start">{t("colStatus")}</th>
                <th className="p-3 text-start">{t("colReference")}</th>
              </tr>
            </thead>
            <tbody>
              {payments.slice(0, 50).map((payment) => (
                <tr key={payment.id} className="border-b last:border-0">
                  <td className="p-3">{when.format(new Date(payment.created_at))}</td>
                  <td className="p-3">{t(`direction.${payment.direction}`)} · {t(`tender.${payment.tender}`)}</td>
                  <td className="p-3 tabular-nums" dir="ltr">{formatEgp(Number(payment.amount), locale)}</td>
                  <td className="p-3"><Badge variant="outline">{t(`status.${payment.status}`)}</Badge></td>
                  <td className="p-3" dir="ltr">{payment.provider_reference ?? "—"}</td>
                </tr>
              ))}
              {payments.length === 0 && (
                <tr>
                  <td className="text-muted-foreground p-6 text-center" colSpan={5}>{t("recentEmpty")}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
