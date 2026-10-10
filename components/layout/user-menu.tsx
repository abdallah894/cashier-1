"use client";

import { useTranslations } from "next-intl";
import { CircleUser, LogOut } from "lucide-react";
import { signOut } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function UserMenu({ name, role }: { name: string; role: "admin" | "cashier" }) {
  const t = useTranslations("auth");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/* a chip with who is signed in, so a shared till shows whose shift it is */}
        <Button variant="ghost" className="h-10 gap-2 px-2" aria-label={t("account")}>
          <span className="bg-primary/10 text-primary flex size-7 shrink-0 items-center justify-center rounded-full">
            <CircleUser className="size-4" />
          </span>
          <span className="hidden max-w-36 flex-col items-start leading-tight md:flex">
            <span className="w-full truncate text-sm font-medium">{name}</span>
            <span className="text-muted-foreground text-xs">{t(`roles.${role}`)}</span>
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>
          <div className="font-medium">{name}</div>
          <div className="text-muted-foreground text-xs">{t(`roles.${role}`)}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut()}>
          <LogOut className="size-4" />
          {t("signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
