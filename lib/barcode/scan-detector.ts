/**
 * Distinguishes a barcode scanner from human typing.
 *
 * USB scanners in keyboard-wedge mode "type" the code in a burst (a few ms
 * between keys) and finish with Enter. A buffer that grew entirely from fast
 * keystrokes and ends with Enter is a scan; slow keystrokes restart the
 * buffer, so a person typing can never reach `minLength` that way.
 *
 * Pure and clock-injected so it is unit-tested without a browser; the
 * `useBarcodeScanner` hook feeds it real key events.
 */
export type ScanDetectorOptions = {
  /** minimum barcode length (EAN-8 = 8, but Code 128 can be shorter) */
  minLength?: number;
  /** keystrokes further apart than this are human typing, not a scanner */
  maxIntervalMs?: number;
};

export type KeyInput = {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  /** monotonic milliseconds (performance.now()) */
  now: number;
};

export type KeyResult = {
  /** set when this key completed a scan */
  scan?: string;
  /** true when the key belongs to a scan and must not reach the page (e.g. the closing Enter) */
  consume: boolean;
};

export function createScanDetector({ minLength = 4, maxIntervalMs = 50 }: ScanDetectorOptions = {}) {
  let buffer = "";
  let lastTime = 0;

  return {
    handleKey({ key, ctrlKey, metaKey, altKey, now }: KeyInput): KeyResult {
      if (ctrlKey || metaKey || altKey) return { consume: false };

      if (key === "Enter") {
        const isScan = buffer.length >= minLength && now - lastTime <= maxIntervalMs;
        const scan = isScan ? buffer : undefined;
        buffer = "";
        return scan !== undefined ? { scan, consume: true } : { consume: false };
      }

      if (key.length !== 1) return { consume: false }; // F-keys, arrows, Shift...

      buffer = now - lastTime > maxIntervalMs ? key : buffer + key;
      lastTime = now;
      return { consume: false };
    },
    reset() {
      buffer = "";
      lastTime = 0;
    },
  };
}
