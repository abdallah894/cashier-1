import { getTranslations, setRequestLocale } from "next-intl/server";
import { DevicesPanel } from "@/components/devices/devices-panel";
import { PageHeader } from "@/components/layout/page-header";
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
      <PageHeader className="mb-0" title={t("title")} description={t("description")} />
      <DevicesPanel tills={tills} devices={devices} profiles={profiles} jobs={jobs} />
    </div>
  );
}
