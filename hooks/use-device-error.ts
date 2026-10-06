"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { deviceErrorKey } from "@/lib/devices/errors";

/**
 * Turns whatever a printer/drawer flow reported into text in the user's
 * language: a server refusal arrives as a key under "errors", a device
 * failure as English prose (mapped via lib/devices/errors), anything else is
 * shown after a translated generic sentence so support can still read it.
 */
export function useDeviceErrorText(): (message: string) => string {
  const tErrors = useTranslations("errors");
  const tDevice = useTranslations("deviceErrors");
  // stable identity: callers list it in effect dependencies without re-running them
  return useCallback(
    (message: string) => {
      if (tErrors.has(message)) return tErrors(message);
      const key = deviceErrorKey(message);
      return key ? tDevice(key) : tDevice("generic", { detail: message });
    },
    [tErrors, tDevice]
  );
}
