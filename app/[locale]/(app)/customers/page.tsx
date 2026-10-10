import { getTranslations, setRequestLocale } from "next-intl/server";
import { Users } from "lucide-react";
import { Link, redirect } from "@/i18n/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { hasCapability } from "@/lib/supabase/queries/capabilities";
import { getCustomers } from "@/lib/supabase/queries/customers";

export default async function CustomersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  if (!(await hasCapability("customer.manage"))) redirect({ href: "/register", locale });
  const { q } = await searchParams;
  const [t, customers] = await Promise.all([getTranslations("customers"), getCustomers(q)]);
  const when = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });

  return (
    <div className="flex w-full flex-col gap-4">
      <PageHeader className="mb-0" title={t("title")} description={t("description")} />
      <form className="flex max-w-md gap-2" method="get">
        <Input name="q" defaultValue={q} placeholder={t("searchPlaceholder")} aria-label={t("searchPlaceholder")} />
        <Button type="submit" variant="outline">
          {t("search")}
        </Button>
      </form>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="p-3 text-start">{t("name")}</th>
              <th className="p-3 text-start">{t("phone")}</th>
              <th className="p-3 text-start">{t("marketingConsent")}</th>
              <th className="p-3 text-start">{t("registered")}</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((customer) => (
              <tr key={customer.id} className="border-b last:border-0">
                <td className="p-3">
                  <Link className="text-primary underline-offset-4 hover:underline" href={`/customers/${customer.id}`}>
                    {customer.name}
                  </Link>
                  {customer.anonymized_at && <Badge variant="outline" className="ms-2">{t("anonymizedBadge")}</Badge>}
                </td>
                <td className="p-3 tabular-nums" dir="ltr">{customer.phone ?? "—"}</td>
                <td className="p-3">{customer.consent_marketing ? t("yes") : t("no")}</td>
                <td className="p-3">{when.format(new Date(customer.created_at))}</td>
              </tr>
            ))}
            {customers.length === 0 && (
              <tr>
                <td colSpan={4}>
                  <EmptyState icon={Users} title={t("empty")} className="py-8" />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
