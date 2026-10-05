"use client";

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  KeyRound,
  MoreHorizontal,
  Plus,
  ShieldCheck,
  UserRoundX,
  UserRoundCheck,
} from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { setStaffRole, toggleStaffActive } from "@/lib/actions/users";
import type { ActionResult } from "@/lib/actions/result";
import type { Database } from "@/lib/supabase/database.types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CreateUserDialog } from "./create-user-dialog";
import { SetPinDialog } from "./set-pin-dialog";
import { CapabilitiesDialog } from "./capabilities-dialog";

export type StaffRow = {
  id: string;
  fullName: string;
  role: "admin" | "cashier";
  active: boolean;
  hasPin: boolean;
  createdAt: string;
  capabilities: Database["public"]["Enums"]["capability"][];
};

export function UsersTable({ rows, selfId }: { rows: StaffRow[]; selfId: string }) {
  const t = useTranslations("users");
  const tErrors = useTranslations("errors");
  const format = useFormatter();
  const router = useRouter();

  const [createOpen, setCreateOpen] = useState(false);
  const [pinTarget, setPinTarget] = useState<StaffRow | null>(null);
  const [capabilityTarget, setCapabilityTarget] = useState<StaffRow | null>(null);

  async function run(promise: Promise<ActionResult<void>>, doneKey: string) {
    const result = await promise;
    if (!result.ok) {
      toast.error(tErrors(result.error));
      return;
    }
    toast.success(t(doneKey));
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" />
          {t("create")}
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("colName")}</TableHead>
              <TableHead>{t("colRole")}</TableHead>
              <TableHead>{t("colStatus")}</TableHead>
              <TableHead>{t("colPin")}</TableHead>
              <TableHead>{t("colCreated")}</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id} className={row.active ? "" : "opacity-60"}>
                <TableCell className="font-medium">
                  {row.fullName}
                  {row.id === selfId && (
                    <span className="text-muted-foreground ms-2 text-xs">{t("you")}</span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={row.role === "admin" ? "default" : "secondary"}>
                    {t(`roles.${row.role}`)}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge variant={row.active ? "outline" : "destructive"}>
                    {row.active ? t("active") : t("inactive")}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {row.hasPin ? t("pinSet") : t("pinMissing")}
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {format.dateTime(new Date(row.createdAt), { dateStyle: "medium" })}
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label={t("rowActions")}>
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => setPinTarget(row)}>
                        <KeyRound className="size-4" />
                        {t("setPin")}
                      </DropdownMenuItem>
                      {row.id !== selfId && row.role !== "admin" && (
                        <DropdownMenuItem onSelect={() => setCapabilityTarget(row)}>
                          <ShieldCheck className="size-4" />
                          {t("permissions")}
                        </DropdownMenuItem>
                      )}
                      {row.id !== selfId && (
                        <>
                          <DropdownMenuItem
                            onSelect={() =>
                              void run(
                                setStaffRole({
                                  userId: row.id,
                                  role: row.role === "admin" ? "cashier" : "admin",
                                }),
                                "roleChanged"
                              )
                            }
                          >
                            <ShieldCheck className="size-4" />
                            {row.role === "admin" ? t("makeCashier") : t("makeAdmin")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() =>
                              void run(
                                toggleStaffActive({ userId: row.id, active: !row.active }),
                                row.active ? "deactivated" : "activated"
                              )
                            }
                          >
                            {row.active ? (
                              <UserRoundX className="size-4" />
                            ) : (
                              <UserRoundCheck className="size-4" />
                            )}
                            {row.active ? t("deactivate") : t("activate")}
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <CreateUserDialog open={createOpen} onOpenChange={setCreateOpen} />
      <CapabilitiesDialog
        target={capabilityTarget}
        onOpenChange={(open) => !open && setCapabilityTarget(null)}
      />
      <SetPinDialog
        userId={pinTarget?.id ?? null}
        name={pinTarget?.fullName ?? ""}
        open={pinTarget !== null}
        onOpenChange={(open) => !open && setPinTarget(null)}
      />
    </div>
  );
}
