import { getTranslations, setRequestLocale } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { SupplierDialog } from "@/components/purchasing/supplier-dialog";
import { requireAdmin } from "@/lib/supabase/queries/profiles";
import { getSuppliers } from "@/lib/supabase/queries/purchasing";

export default async function SuppliersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAdmin();
  const [t, suppliers] = await Promise.all([getTranslations("suppliers"), getSuppliers()]);

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <SupplierDialog />
      </div>
      <div className="rounded-md border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="p-3 text-start">{t("name")}</th>
              <th className="p-3 text-start">{t("phone")}</th>
              <th className="p-3 text-start">{t("paymentTerms")}</th>
              <th className="p-3 text-start">{t("status")}</th>
              <th className="p-3" />
            </tr>
          </thead>
          <tbody>
            {suppliers.map((supplier) => (
              <tr key={supplier.id} className="border-b last:border-0">
                <td className="p-3 font-medium">{supplier.name}</td>
                <td className="p-3 tabular-nums" dir="ltr">{supplier.phone}</td>
                <td className="p-3">{supplier.payment_terms}</td>
                <td className="p-3">
                  <Badge variant={supplier.active ? "secondary" : "outline"}>
                    {supplier.active ? t("active") : t("inactive")}
                  </Badge>
                </td>
                <td className="p-3 text-end">
                  <SupplierDialog supplier={supplier} />
                </td>
              </tr>
            ))}
            {suppliers.length === 0 && (
              <tr>
                <td className="text-muted-foreground p-6 text-center" colSpan={5}>
                  {t("empty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
