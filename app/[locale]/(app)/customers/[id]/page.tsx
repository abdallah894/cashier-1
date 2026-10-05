import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link, redirect } from "@/i18n/navigation";
import { CustomerActions } from "@/components/customers/customer-actions";
import { formatEgp } from "@/lib/money";
import { hasCapability } from "@/lib/supabase/queries/capabilities";
import { getCustomerDetail } from "@/lib/supabase/queries/customers";

export default async function CustomerPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  if (!(await hasCapability("customer.manage"))) redirect({ href: "/register", locale });
  const [t, detail] = await Promise.all([getTranslations("customers"), getCustomerDetail(id)]);
  if (!detail) notFound();
  const { customer, history, consentEvents } = detail;
  const when = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
  const lifetime = history.reduce((sum, row) => sum + Number(row.total), 0);

  return (
    <div className="flex w-full flex-col gap-4">
      <div>
        <Link className="text-muted-foreground text-sm hover:underline" href="/customers">
          {t("back")}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{customer.name}</h1>
        <p className="text-muted-foreground text-sm tabular-nums" dir="ltr">
          {customer.phone ?? "—"}
          {customer.email ? ` · ${customer.email}` : ""}
        </p>
      </div>

      <CustomerActions customerId={customer.id} consent={customer.consent_marketing} anonymized={customer.anonymized_at !== null} />

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="bg-card rounded-lg border p-4">
          <div className="text-muted-foreground text-xs">{t("purchases")}</div>
          <div className="text-xl font-semibold tabular-nums">{history.length}</div>
        </div>
        <div className="bg-card rounded-lg border p-4">
          <div className="text-muted-foreground text-xs">{t("lifetimeSpend")}</div>
          <div className="text-xl font-semibold tabular-nums" dir="ltr">{formatEgp(lifetime, locale)}</div>
        </div>
      </div>

      <h2 className="text-lg font-semibold">{t("history")}</h2>
      <div className="rounded-md border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="p-3 text-start">{t("sale")}</th>
              <th className="p-3 text-start">{t("when")}</th>
              <th className="p-3 text-start">{t("items")}</th>
              <th className="p-3 text-start">{t("total")}</th>
            </tr>
          </thead>
          <tbody>
            {history.map((row) => (
              <tr key={row.sale_id} className="border-b last:border-0">
                <td className="p-3 tabular-nums">
                  <Link className="text-primary hover:underline" href={`/receipts/${row.sale_id}`}>
                    #{row.sale_number}
                  </Link>
                </td>
                <td className="p-3">{when.format(new Date(row.created_at))}</td>
                <td className="p-3 tabular-nums" dir="ltr">{Number(row.item_count)}</td>
                <td className="p-3 tabular-nums" dir="ltr">{formatEgp(Number(row.total), locale)}</td>
              </tr>
            ))}
            {history.length === 0 && (
              <tr>
                <td className="text-muted-foreground p-6 text-center" colSpan={4}>
                  {t("noPurchases")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h2 className="text-lg font-semibold">{t("consentLog")}</h2>
      <ul className="text-sm">
        {consentEvents.map((event) => (
          <li key={event.id} className="flex gap-3 border-b py-2 last:border-0">
            <span className="w-44">{when.format(new Date(event.recorded_at))}</span>
            <span>{event.consent ? t("consentGranted") : t("consentWithdrawn")}</span>
            <span className="text-muted-foreground">({event.source})</span>
          </li>
        ))}
        {consentEvents.length === 0 && <li className="text-muted-foreground">{t("noConsentEvents")}</li>}
      </ul>
    </div>
  );
}
