"use client";

import { useEffect, useRef } from "react";
import { createScanDetector } from "@/lib/barcode/scan-detector";

type Options = {
  /** pause detection (e.g. while the checkout dialog is open) */
  enabled?: boolean;
  /** minimum barcode length (EAN-8 = 8, but Code 128 can be shorter) */
  minLength?: number;
  /** keystrokes further apart than this are human typing, not a scanner */
  maxIntervalMs?: number;
};

/**
 * USB barcode scanners are keyboards that "type" the code in a burst
 * (a few ms between keys) and finish with Enter. This global listener
 * buffers printable keys; a buffer that grew entirely from fast
 * keystrokes and ends with Enter is treated as a scan.
 *
 * Human typing never triggers it: intervals > maxIntervalMs reset the
 * buffer to the latest character, so it can't reach minLength.
 *
 * Works regardless of focus. If the burst landed inside an input, the
 * caller should clear that input in onScan (we can't un-type it).
 *
 * (Vue mapping: the add/remove listener pair is onMounted/onUnmounted;
 * here it's one useEffect whose RETURN VALUE is the cleanup, re-run
 * whenever `enabled` changes.)
 */
export function useBarcodeScanner(
  onScan: (barcode: string) => void,
  { enabled = true, minLength = 4, maxIntervalMs = 50 }: Options = {}
) {
  // keep the latest callback without re-subscribing the listener
  const onScanRef = useRef(onScan);
  useEffect(() => {
    onScanRef.current = onScan;
  });

  useEffect(() => {
    if (!enabled) return;

    // the burst-vs-typing decision lives in a pure, unit-tested module
    const detector = createScanDetector({ minLength, maxIntervalMs });

    function onKeyDown(event: KeyboardEvent) {
      const result = detector.handleKey({
        key: event.key,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
        now: performance.now(),
      });
      if (result.scan !== undefined) {
        // don't submit whatever form the burst landed in
        event.preventDefault();
        event.stopPropagation();
        onScanRef.current(result.scan);
      }
    }

    // capture phase so we run even when an input has focus
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [enabled, minLength, maxIntervalMs]);
}
