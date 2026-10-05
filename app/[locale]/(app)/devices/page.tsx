import { getTranslations, setRequestLocale } from "next-intl/server";
import { DevicesPanel } from "@/components/devices/devices-panel";
import { getDeviceProfiles, getDevices, getRecentPrintJobs, getTills } from "@/lib/supabase/queries/devices";
import { requireAdmin } from "@/lib/supabase/queries/profiles";

export default async function DevicesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAdmin();
  const [t, tills, devices, profiles, jobs] = await Promise.all([
    getTranslations("devices"),
    getTills(),
    getDevices(),
    getDeviceProfiles(),
    getRecentPrintJobs(),
  ]);
  return (
    <div className="flex w-full flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground max-w-prose text-sm">{t("description")}</p>
      </div>
      <DevicesPanel tills={tills} devices={devices} profiles={profiles} jobs={jobs} />
    </div>
  );
}
