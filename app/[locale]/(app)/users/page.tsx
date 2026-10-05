import { setRequestLocale, getTranslations } from "next-intl/server";
import { requireAdmin } from "@/lib/supabase/queries/profiles";
import { createAdminClient } from "@/lib/supabase/admin";
import { UsersTable } from "@/components/users/users-table";

export default async function UsersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const me = await requireAdmin();

  const t = await getTranslations("users");
  // service-role list: RLS would also work for an admin, but this keeps
  // one source for the page and includes pin state without exposing hashes
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("profiles")
    .select("id, full_name, role, active, pin_hash, created_at")
    .order("created_at");
  if (error) throw error;

  const { data: grants, error: grantsError } = await admin.from("staff_capabilities").select("staff_id, capability");
  if (grantsError) throw grantsError;

  const rows = (data ?? []).map((p) => ({
    id: p.id,
    fullName: p.full_name,
    role: p.role,
    active: p.active,
    hasPin: p.pin_hash !== null, // boolean only — the hash never reaches the client
    createdAt: p.created_at,
    capabilities: (grants ?? []).filter((g) => g.staff_id === p.id).map((g) => g.capability),
  }));

  return (
    <div className="flex w-full flex-col gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <UsersTable rows={rows} selfId={me.id} />
    </div>
  );
}
