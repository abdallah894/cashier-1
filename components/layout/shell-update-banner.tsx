"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { Download, TriangleAlert } from "lucide-react";
import { getCachierShell, type UpdateStatus } from "@/lib/devices/shell";
import { shellIsTooOld } from "@/lib/shell/version";
import { useCart } from "@/lib/store/cart";
import { Button } from "@/components/ui/button";

/**
 * Shown only inside the Windows desktop app.
 *  - the app is older than this website supports -> a clear "update the till app" notice;
 *  - a new version has been downloaded -> "Restart to update", which is only enabled when the
 *    cart is empty (a restart must never interrupt a sale; otherwise it installs on the next close).
 */
export function ShellUpdateBanner() {
  const t = useTranslations("shellUpdate");
  const shell = useSyncExternalStore(
    () => () => {},
    getCachierShell,
    () => null
  );
  const cartEmpty = useCart((state) => state.items.length === 0);
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    const updates = shell?.updates;
    if (!updates) return;
    let active = true;
    void updates.status().then((current) => active && setStatus(current)).catch(() => undefined);
    const unsubscribe = updates.onStatus((next) => active && setStatus(next));
    return () => {
      active = false;
      unsubscribe();
    };
  }, [shell]);

  if (!shell) return null;

  if (shellIsTooOld(shell.version)) {
    return (
      <div role="alert" className="bg-destructive/10 text-destructive flex items-center gap-2 border-b px-4 py-2 text-sm">
        <TriangleAlert className="size-4 shrink-0" />
        {t("tooOld", { version: shell.version })}
      </div>
    );
  }

  if (status?.state === "ready") {
    return (
      <div role="status" className="bg-primary/10 text-primary flex flex-wrap items-center gap-2 border-b px-4 py-2 text-sm">
        <Download className="size-4 shrink-0" />
        <span>{t("ready", { version: status.version ?? "" })}</span>
        <span className="text-muted-foreground text-xs">{cartEmpty ? t("readyHint") : t("finishSaleFirst")}</span>
        <Button
          size="sm"
          className="ms-auto"
          disabled={!cartEmpty || restarting}
          onClick={() => {
            setRestarting(true);
            void shell.updates?.restartToUpdate().then((result) => !result.ok && setRestarting(false)).catch(() => setRestarting(false));
          }}
        >
          {t("restart")}
        </Button>
      </div>
    );
  }
  return null;
}
