import { redirect } from "next/navigation";
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { LocaleSwitcher } from "@/components/layout/locale-switcher";
import { NetworkIndicator } from "@/components/layout/network-indicator";
import { ShellUpdateBanner } from "@/components/layout/shell-update-banner";
import { SyncProvider } from "@/components/offline/sync-provider";
import { ChatWidget } from "@/components/chat-widget";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { UserMenu } from "@/components/layout/user-menu";
import { getCurrentProfile } from "@/lib/supabase/queries/profiles";
import { getStoreInfo } from "@/lib/supabase/queries/ops-reports";
import { DEFAULT_STORE_INFO } from "@/lib/receipts/store-info";

// Route-group layout: everything inside (app) gets the sidebar shell and
// requires a session (RLS gives anon nothing anyway). Fine-grained role
// gating and middleware protection arrive in Phase 5.
export default async function AppLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const profile = await getCurrentProfile();
  if (!profile) {
    redirect(`/${locale}/login`);
  }
  // the shop's own name under the app name; a missing/unreadable setting never breaks the shell
  const store = await getStoreInfo().catch(() => null);
  const storeName = store && store.nameEn !== DEFAULT_STORE_INFO.nameEn ? (locale === "ar" ? store.nameAr : store.nameEn) : null;

  return (
    <SidebarProvider>
      <SyncProvider userId={profile.id} />
      <AppSidebar role={profile.role} storeName={storeName} />
      <SidebarInset>
        <header className="bg-card/80 sticky top-0 z-10 flex h-16 shrink-0 items-center gap-2 border-b px-4 backdrop-blur">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-6" />
          <div className="ms-auto flex items-center gap-1">
            <NetworkIndicator userId={profile.id} />
            <LocaleSwitcher />
            <ThemeToggle />
            <UserMenu name={profile.full_name} role={profile.role} />
          </div>
        </header>
        <ShellUpdateBanner />
        <main className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col p-3 sm:p-6">{children}</main>
      </SidebarInset>
      <ChatWidget />
    </SidebarProvider>
  );
}
