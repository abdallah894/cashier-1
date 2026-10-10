"use client";

import { useTranslations } from "next-intl";
import { ChevronLeft } from "lucide-react";
import { Link, usePathname } from "@/i18n/navigation";
import { matchNav } from "./nav-items";

/**
 * Where am I: the menu entry's name in the header, and on pages below it
 * (a product, a receipt, "new purchase order") a link back to the list.
 * The name matches the sidebar because both read nav-items.ts.
 */
export function PageTitle() {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const match = matchNav(pathname);
  if (!match) return null;
  const { item, detail } = match;

  if (detail) {
    return (
      <Link
        href={item.href}
        className="text-muted-foreground hover:text-foreground flex min-w-0 items-center gap-1 rounded-md px-1 text-sm font-medium"
      >
        <ChevronLeft className="size-4 shrink-0 rtl:rotate-180" />
        <span className="truncate">{t(item.key)}</span>
      </Link>
    );
  }

  return (
    <div className="flex min-w-0 items-center gap-2 px-1 text-sm font-semibold">
      <item.icon className="text-primary size-4 shrink-0" />
      <span className="truncate">{t(item.key)}</span>
    </div>
  );
}
