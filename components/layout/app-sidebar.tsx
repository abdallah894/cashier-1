"use client";

import { useLocale, useTranslations } from "next-intl";
import {
  ShoppingCart,
  Package,
  Tags,
  BarChart3,
  Clock,
  Store,
  ReceiptText,
  UsersRound,
  ShieldCheck,
  CloudUpload,
  ClipboardList,
  Truck,
  PackageCheck,
} from "lucide-react";
import { Link, usePathname } from "@/i18n/navigation";
import { getDirection, type Locale } from "@/i18n/routing";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

const navItems = [
  { key: "register", href: "/register", icon: ShoppingCart, adminOnly: false },
  { key: "sales", href: "/receipts", icon: ReceiptText, adminOnly: false },
  { key: "shifts", href: "/shifts", icon: Clock, adminOnly: false },
  { key: "offlineSales", href: "/offline-sales", icon: CloudUpload, adminOnly: false },
  { key: "products", href: "/products", icon: Package, adminOnly: true },
  { key: "categories", href: "/categories", icon: Tags, adminOnly: true },
  { key: "stocktakes", href: "/stocktakes", icon: ClipboardList, adminOnly: true },
  { key: "purchaseOrders", href: "/purchase-orders", icon: PackageCheck, adminOnly: true },
  { key: "suppliers", href: "/suppliers", icon: Truck, adminOnly: true },
  { key: "reports", href: "/reports", icon: BarChart3, adminOnly: true },
  { key: "users", href: "/users", icon: UsersRound, adminOnly: true },
  { key: "audit", href: "/audit", icon: ShieldCheck, adminOnly: true },
] as const;

export function AppSidebar({ role }: { role: "admin" | "cashier" }) {
  // useTranslations is a hook — the Vue next-intl equivalent would be
  // useI18n().t, but here it's scoped to a namespace at call time.
  const t = useTranslations("nav");
  const tCommon = useTranslations("common");
  const locale = useLocale() as Locale;
  // usePathname from i18n/navigation strips the locale prefix,
  // so "/ar/products" comes back as "/products".
  const pathname = usePathname();

  return (
    <Sidebar side={getDirection(locale) === "rtl" ? "right" : "left"} collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/">
                <div className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-lg">
                  <Store className="size-4" />
                </div>
                <span className="text-base font-semibold">{tCommon("appName")}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems
                .filter((item) => role === "admin" || !item.adminOnly)
                .map((item) => (
                <SidebarMenuItem key={item.key}>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname === item.href || pathname.startsWith(item.href + "/")}
                    tooltip={t(item.key)}
                  >
                    <Link href={item.href}>
                      <item.icon />
                      <span>{t(item.key)}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
