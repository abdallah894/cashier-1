import { setRequestLocale } from "next-intl/server";
import { getCurrentProfile } from "@/lib/supabase/queries/profiles";
import { OfflineSalesList } from "@/components/offline/offline-sales-list";

export default async function OfflineSalesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const profile = await getCurrentProfile();
  return <OfflineSalesList userId={profile?.id ?? ""} />;
}
