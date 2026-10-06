import { createHash } from "node:crypto";

// Pure rate-limit helpers (no Next.js / database imports) so they can be unit-tested.

/** The caller's address as the platform reports it (Vercel sets x-forwarded-for). */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
}

type Window = { count: number; resetAt: number };
const windows = new Map<string, Window>();

/**
 * Fixed-window counter in this server instance's memory. Cheap enough for
 * public endpoints (health check, violation reports) where a per-request
 * database write would defeat the purpose; each instance enforces its own
 * limit, which still bounds a flood. `now` is injectable for tests.
 */
export function memoryRateLimit(key: string, limit: number, windowMs: number, now: number = Date.now()): { allowed: boolean; retryAfterSeconds: number } {
  if (windows.size > 5_000) for (const [k, w] of windows) if (w.resetAt <= now) windows.delete(k);
  const current = windows.get(key);
  if (!current || current.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  current.count++;
  return { allowed: current.count <= limit, retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) };
}

/** Test helper: forget every counter. */
export function resetMemoryRateLimits() {
  windows.clear();
}

/** The key sent to the database: scope plus a hash of the IP, so raw addresses are never stored. */
export function ipRateLimitKey(scope: string, ip: string): string {
  return `${scope}:${createHash("sha256").update(ip).digest("hex").slice(0, 32)}`;
}
