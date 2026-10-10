import { getTranslations, setRequestLocale } from "next-intl/server";
import { PurchaseOrderForm } from "@/components/purchasing/po-form";
import { requireAdmin } from "@/lib/supabase/queries/profiles";
import { getSuppliers } from "@/lib/supabase/queries/purchasing";

export default async function NewPurchaseOrderPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAdmin();
  const [t, suppliers] = await Promise.all([getTranslations("purchaseOrders"), getSuppliers()]);
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">{t("newTitle")}</h1>
      <p className="text-muted-foreground max-w-prose text-sm">{t("newDescription")}</p>
      <PurchaseOrderForm suppliers={suppliers.filter((supplier) => supplier.active).map(({ id, name }) => ({ id, name }))} />
    </div>
  );
}
