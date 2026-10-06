"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
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
    <div role="alert" className="flex flex-col items-center gap-3 py-16 text-center">
      <h2 className="text-lg font-semibold">{t("errorTitle")}</h2>
      <p className="text-muted-foreground max-w-md text-sm">{t("error")}</p>
      {error.digest ? <p className="text-muted-foreground text-xs">{error.digest}</p> : null}
      <Button onClick={reset}>{t("retry")}</Button>
    </div>
  );
}
