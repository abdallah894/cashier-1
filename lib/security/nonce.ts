/**
 * The CSP nonce of the current request. proxy.ts puts it on the request as
 * `x-nonce` (and inside the CSP header); pages read it to stamp the few inline
 * scripts that React/Next don't stamp themselves (e.g. the theme script).
 */
export function nonceFromHeaders(headers: Pick<Headers, "get">): string | undefined {
  const direct = headers.get("x-nonce");
  if (direct) return direct;
  const csp = headers.get("content-security-policy") ?? headers.get("content-security-policy-report-only");
  return csp ? /'nonce-([^']+)'/.exec(csp)?.[1] : undefined;
}
