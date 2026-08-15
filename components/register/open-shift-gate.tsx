"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Clock, UserRoundCog } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { OpenShiftForm } from "@/components/shifts/open-shift-form";
import { PinSwitchDialog, type SwitchableCashier } from "./pin-switch-dialog";

/** Blocks the register until the ACTIVE cashier has an open shift.
 *  Switching cashiers is still possible from here (relief mid-shift). */
export function OpenShiftGate({ cashiers }: { cashiers: SwitchableCashier[] }) {
  const t = useTranslations("shifts");
  const [switchOpen, setSwitchOpen] = useState(false);

  return (
    <div className="flex flex-1 items-center justify-center">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <Clock className="text-muted-foreground size-8" />
          <CardTitle>{t("gateTitle")}</CardTitle>
          <CardDescription>{t("gateDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4">
          <span className="text-muted-foreground text-sm">{t("openingFloat")}</span>
          <OpenShiftForm />
          <Button variant="ghost" size="sm" onClick={() => setSwitchOpen(true)}>
            <UserRoundCog className="size-4" />
            {t("switchInstead")}
          </Button>
        </CardContent>
      </Card>
      <PinSwitchDialog cashiers={cashiers} open={switchOpen} onOpenChange={setSwitchOpen} />
    </div>
  );
}
