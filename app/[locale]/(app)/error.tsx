"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { RotateCcw, ShoppingCart, ReceiptText, TriangleAlert } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { reportClientError } from "@/lib/actions/ops-health";

// Error boundary for the signed-in shell: a page that throws shows this instead
// of a blank screen, and the sidebar keeps working (Vue/Nuxt: <NuxtErrorBoundary>).
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("common");

  useEffect(() => {
    console.error("page error", { digest: error.digest, message: error.message });
    // tell the owner: a till showing this screen is otherwise invisible to them
    void reportClientError({ message: error.message || "unknown error", digest: error.digest, path: window.location.pathname }).catch(() => undefined);
  }, [error]);

  return (
    <div role="alert" className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
      <div className="bg-destructive/10 text-destructive flex size-14 items-center justify-center rounded-full">
        <TriangleAlert className="size-7" />
      </div>
      <h2 className="text-xl font-semibold">{t("errorTitle")}</h2>
      <p className="text-muted-foreground text-sm">{t("error")}</p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button size="lg" onClick={reset}>
          <RotateCcw className="size-4" />
          {t("retry")}
        </Button>
        <Button size="lg" variant="outline" asChild>
          <Link href="/register">
            <ShoppingCart className="size-4" />
            {t("errorToRegister")}
          </Link>
        </Button>
        <Button size="lg" variant="ghost" asChild>
          <Link href="/receipts">
            <ReceiptText className="size-4" />
            {t("errorToSales")}
          </Link>
        </Button>
      </div>
      {/* quote this to support: it finds the server log entry */}
      {error.digest ? <p className="text-muted-foreground text-xs" dir="ltr">{t("errorCode", { code: error.digest })}</p> : null}
    </div>
  );
}
