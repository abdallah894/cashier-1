"use client";

import { useFormatter, useLocale, useTranslations } from "next-intl";
import { Store } from "lucide-react";
import { Link, usePathname } from "@/i18n/navigation";
import { getDirection, type Locale } from "@/i18n/routing";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useOutboxCounts } from "@/hooks/use-outbox-counts";
import { matchNav, navGroupsFor } from "./nav-items";

// accent bar on the active entry; taller rows for touch
const ITEM_CLASS =
  "relative h-10 text-[0.9375rem] data-active:font-semibold data-active:before:absolute data-active:before:inset-y-2 data-active:before:start-0 data-active:before:w-1 data-active:before:rounded-full data-active:before:bg-sidebar-primary";

export function AppSidebar({
  role,
  storeName,
  userId,
}: {
  role: "admin" | "cashier";
  storeName?: string | null;
  userId: string;
}) {
  // useTranslations is a hook — the Vue next-intl equivalent would be
  // useI18n().t, but here it's scoped to a namespace at call time.
  const t = useTranslations("nav");
  const tCommon = useTranslations("common");
  const locale = useLocale() as Locale;
  // usePathname from i18n/navigation strips the locale prefix,
  // so "/ar/products" comes back as "/products".
  const pathname = usePathname();
  const active = matchNav(pathname)?.item.key;
  // sales waiting to reach the server (same live count as the header badge)
  const format = useFormatter();
  const counts = useOutboxCounts(userId);
  const pending = (counts?.queued ?? 0) + (counts?.syncing ?? 0) + (counts?.rejected ?? 0);

  return (
    <Sidebar side={getDirection(locale) === "rtl" ? "right" : "left"} collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/">
                <div className="bg-primary text-primary-foreground flex size-9 shrink-0 items-center justify-center rounded-xl shadow-xs">
                  <Store className="size-5" />
                </div>
                <div className="flex min-w-0 flex-col leading-tight">
                  <span className="text-base font-semibold">{tCommon("appName")}</span>
                  {storeName ? <span className="text-muted-foreground truncate text-xs">{storeName}</span> : null}
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {/* grouped so things are easy to find; cashiers only see "Sell" */}
        {navGroupsFor(role).map((group) => (
          <SidebarGroup key={group.key}>
            <SidebarGroupLabel>{t(`groups.${group.key}`)}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.key}>
                    <SidebarMenuButton asChild isActive={active === item.key} tooltip={t(item.key)} className={ITEM_CLASS}>
                      <Link href={item.href}>
                        <item.icon />
                        <span>{t(item.key)}</span>
                      </Link>
                    </SidebarMenuButton>
                    {item.key === "offlineSales" && pending > 0 ? (
                      <SidebarMenuBadge className="bg-amber-500/15 top-2.5! text-amber-700 dark:text-amber-400">{format.number(pending)}</SidebarMenuBadge>
                    ) : null}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </Sidebar>
  );
}
