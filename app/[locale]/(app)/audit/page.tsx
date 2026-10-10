import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireAdmin } from "@/lib/supabase/queries/profiles";
import { getAuditEvents } from "@/lib/supabase/queries/audit";

export default async function AuditPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAdmin();
  const [t, events] = await Promise.all([getTranslations("audit"), getAuditEvents()]);
  return <div className="flex w-full flex-col gap-4"><div><h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1><p className="text-muted-foreground max-w-prose text-sm">{t("pageDescription")}</p></div>
    <div className="overflow-x-auto rounded-md border"><table className="w-full text-sm"><thead><tr className="border-b text-start"><th className="p-3">{t("when")}</th><th className="p-3">{t("action")}</th><th className="p-3">{t("target")}</th><th className="p-3">{t("details")}</th></tr></thead><tbody>{events.map((event) => <tr key={event.id} className="border-b last:border-0"><td className="p-3">{new Date(event.created_at).toLocaleString(locale)}</td><td className="p-3">{event.action}</td><td className="p-3">{event.target_type}</td><td className="min-w-48 max-w-md p-3 font-mono text-xs break-all">{JSON.stringify(event.metadata)}</td></tr>)}{events.length === 0 && <tr><td className="p-6 text-center text-muted-foreground" colSpan={4}>{t("empty")}</td></tr>}</tbody></table></div></div>;
}
