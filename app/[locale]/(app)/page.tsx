import { setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { getCurrentProfile } from "@/lib/supabase/queries/profiles";

// There is no separate home screen: the till is where a cashier works and the
// reports are where the owner starts. (A bare "/" must never show a placeholder.)
export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const profile = await getCurrentProfile();
  redirect({ href: profile?.role === "admin" ? "/reports" : "/register", locale });
}
