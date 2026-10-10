/**
 * Content-Security-Policy for the app (also used by the Electron and Android
 * shells, which load the same site). A per-request nonce lets Next.js's own
 * inline scripts run while blocking any injected script; 'strict-dynamic'
 * lets those trusted scripts load their chunks.
 *
 * Rollout: CSP_MODE=report-only (default) sends the policy as
 * Content-Security-Policy-Report-Only and violations are logged by
 * /api/csp-report without blocking anything; CSP_MODE=enforce blocks.
 * Watch the logs for `csp_violation` for a few trading days, then enforce.
 */
export type CspMode = "report-only" | "enforce";

export function cspMode(value: string | undefined): CspMode {
  return value?.trim().toLowerCase() === "enforce" ? "enforce" : "report-only";
}

export function cspHeaderName(mode: CspMode): string {
  return mode === "enforce" ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only";
}

export function buildCsp({ nonce, supabaseUrl, dev = false, enforce = true }: { nonce: string; supabaseUrl: string; dev?: boolean; enforce?: boolean }): string {
  let supabaseOrigin = "";
  let supabaseWs = "";
  try {
    const url = new URL(supabaseUrl);
    supabaseOrigin = url.origin;
    supabaseWs = `${url.protocol === "https:" ? "wss" : "ws"}://${url.host}`;
  } catch {
    // an unparsable URL just means no extra origin is allowed
  }
  const list = (...parts: (string | false)[]) => parts.filter(Boolean).join(" ");

  const directives: [string, string][] = [
    ["default-src", "'self'"],
    // 'unsafe-eval' only in development (React refresh); never in production
    // 'wasm-unsafe-eval' lets the barcode decoder compile WebAssembly; it does NOT allow eval()
    ["script-src", list("'self'", `'nonce-${nonce}'`, "'strict-dynamic'", "'wasm-unsafe-eval'", dev && "'unsafe-eval'")],
    // component libraries set inline style attributes at runtime
    ["style-src", "'self' 'unsafe-inline'"],
    ["img-src", list("'self'", "data:", "blob:", supabaseOrigin)],
    ["font-src", "'self' data:"],
    ["connect-src", list("'self'", supabaseOrigin, supabaseWs, dev && "ws://localhost:* http://localhost:*")],
    ["media-src", "'self' blob: mediastream:"],
    ["worker-src", "'self' blob:"],
    ["manifest-src", "'self'"],
    ["object-src", "'none'"],
    ["base-uri", "'self'"],
    ["form-action", "'self'"],
    ["frame-ancestors", "'none'"],
    ["report-uri", "/api/csp-report"],
  ];
  // browsers ignore (and warn about) this directive in a report-only policy
  if (!dev && enforce) directives.push(["upgrade-insecure-requests", ""]);
  return directives.map(([name, value]) => (value ? `${name} ${value}` : name)).join("; ");
}

/** A fresh, unguessable nonce for one response. */
export function newNonce(): string {
  return btoa(crypto.randomUUID());
}
