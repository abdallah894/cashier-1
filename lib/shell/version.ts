/**
 * The oldest desktop-app version this website still supports. Raise it when a
 * release of the website needs something only a newer app provides (for
 * example a new print-bridge call); tills on an older app then see a clear
 * "please update" notice instead of a feature that silently does nothing.
 */
export const MIN_SHELL_VERSION = "1.0.0";

/** Compares dotted numeric versions ("1.10.0" > "1.2.0"); a pre-release suffix is ignored. Returns -1, 0 or 1. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const parts = (v: string) => v.split("-")[0].split(".").map((n) => Number.parseInt(n, 10) || 0);
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

export function shellIsTooOld(version: string, minimum: string = MIN_SHELL_VERSION): boolean {
  return compareVersions(version, minimum) < 0;
}
