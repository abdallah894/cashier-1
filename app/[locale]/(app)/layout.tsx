import { redirect } from "next/navigation";
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { LocaleSwitcher } from "@/components/layout/locale-switcher";
import { NetworkIndicator } from "@/components/layout/network-indicator";
import { SyncProvider } from "@/components/offline/sync-provider";
import { ChatWidget } from "@/components/chat-widget";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { UserMenu } from "@/components/layout/user-menu";
import { getCurrentProfile } from "@/lib/supabase/queries/profiles";

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

  return (
    <SidebarProvider>
      <SyncProvider userId={profile.id} />
      <AppSidebar role={profile.role} />
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-6" />
          <div className="ms-auto flex items-center gap-1">
            <NetworkIndicator userId={profile.id} />
            <LocaleSwitcher />
            <ThemeToggle />
            <UserMenu name={profile.full_name} role={profile.role} />
          </div>
        </header>
        <main className="flex flex-1 flex-col p-6">{children}</main>
      </SidebarInset>
      <ChatWidget />
    </SidebarProvider>
  );
}
