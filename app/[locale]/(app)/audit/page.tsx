import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { ShieldCheck } from "lucide-react";
import { requireAdmin } from "@/lib/supabase/queries/profiles";
import { getAuditEvents } from "@/lib/supabase/queries/audit";
import { auditDetails, type AuditDetail } from "@/lib/audit/format";
import { formatEgp } from "@/lib/money";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { AuditFilter } from "@/components/audit/audit-filter";
import { TablePagination } from "@/components/products/table-pagination";

/** Every action write_audit_event may record (supabase/migrations: audit_actions). */
const AUDIT_ACTIONS = [
  "approval_created",
  "business_day_closed",
  "capabilities_changed",
  "cart_void",
  "cash_drawer_event",
  "customer_anonymized",
  "customer_consent_changed",
  "device_changed",
  "drawer_open_authorized",
  "goods_received",
  "payment_resolved",
  "payment_status_changed",
  "product_supplier_changed",
  "promotion_applied",
  "promotion_created",
  "promotion_toggled",
  "purchase_order_placed",
  "receipt_reprinted",
  "reorder_alert_handled",
  "return_created",
  "sale_discount_override",
  "shift_close",
  "stock_correction",
  "stocktake_approved",
  "store_settings_changed",
] as const;

export default async function AuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ action?: string; page?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAdmin();
  const sp = await searchParams;
  const action = (AUDIT_ACTIONS as readonly string[]).includes(sp.action ?? "") ? sp.action : undefined;
  const page = Math.max(1, Number(sp.page) || 1);
  const [t, format, events] = await Promise.all([
    getTranslations("audit"),
    getFormatter(),
    getAuditEvents({ action, page }),
  ]);

  // labels for values the database may add later fall back to the raw name
  const label = (group: "actions" | "targets" | "keys", key: string) =>
    t.has(`${group}.${key}`) ? t(`${group}.${key}`) : key.replaceAll("_", " ");

  function value(detail: AuditDetail): string {
    switch (detail.kind) {
      case "money":
        return formatEgp(detail.value, locale);
      case "signed":
        return `${detail.value > 0 ? "+" : ""}${format.number(detail.value)}`;
      case "number":
        return format.number(detail.value);
      case "bool":
        return detail.value ? t("yes") : t("no");
      case "tender":
        return t.has(`tenders.${detail.value}`) ? t(`tenders.${detail.value}`) : detail.value;
      default:
        return detail.value.replaceAll("_", " ");
    }
  }

  return (
    <div className="flex w-full flex-col gap-4">
      <PageHeader className="mb-0" title={t("title")} description={t("pageDescription")} actions={<AuditFilter actions={AUDIT_ACTIONS} />} />
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr className="border-b text-start">
              <th className="p-3 text-start font-medium">{t("when")}</th>
              <th className="p-3 text-start font-medium">{t("who")}</th>
              <th className="p-3 text-start font-medium">{t("action")}</th>
              <th className="p-3 text-start font-medium">{t("details")}</th>
            </tr>
          </thead>
          <tbody>
            {events.rows.map((event) => {
              const details = auditDetails(event.metadata);
              return (
                <tr key={event.id} className="border-b align-top last:border-0">
                  <td className="p-3 whitespace-nowrap tabular-nums">
                    {format.dateTime(new Date(event.created_at), { dateStyle: "medium", timeStyle: "short" })}
                  </td>
                  <td className="p-3">{event.profiles?.full_name ?? t("system")}</td>
                  <td className="p-3">
                    <div className="font-medium">{label("actions", event.action)}</div>
                    <div className="text-muted-foreground text-xs">{label("targets", event.target_type)}</div>
                  </td>
                  <td className="min-w-48 p-3">
                    {details.length === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {details.map((detail) => (
                          <Badge key={detail.key} variant="secondary" className="gap-1 font-normal">
                            <span className="text-muted-foreground">{label("keys", detail.key)}:</span>
                            <span className="tabular-nums" dir={detail.kind === "text" ? undefined : "ltr"}>
                              {value(detail)}
                            </span>
                          </Badge>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {events.rows.length === 0 && (
              <tr>
                <td colSpan={4}>
                  <EmptyState icon={ShieldCheck} title={t("empty")} className="py-8" />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <TablePagination page={events.page} pageCount={events.pageCount} total={events.total} />
    </div>
  );
}
