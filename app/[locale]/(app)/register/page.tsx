import { setRequestLocale } from "next-intl/server";
import { getCurrentProfile, getSwitchableCashiers } from "@/lib/supabase/queries/profiles";
import { getActiveShift } from "@/lib/supabase/queries/shifts";
import { Register } from "@/components/register/register";
import { OpenShiftGate } from "@/components/register/open-shift-gate";

export default async function RegisterPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [profile, shift, cashiers] = await Promise.all([
    getCurrentProfile(),
    getActiveShift(),
    getSwitchableCashiers(),
  ]);

  // no open shift → the register is blocked until one is opened
  if (!shift) return <OpenShiftGate cashiers={cashiers} />;

  return (
    <Register
      isAdmin={profile?.role === "admin"}
      cashiers={cashiers}
      userId={profile?.id ?? ""}
      shiftId={shift.id}
      cashierName={profile?.full_name ?? null}
    />
  );
}
