/**
 * Structured JSON logging with secret redaction. One line per event, so a
 * log drain (Vercel, Better Stack, Datadog...) can index fields without
 * parsing prose.
 *
 * REDACTION: any field whose NAME looks sensitive is replaced, and string
 * VALUES that look like credentials (JWTs, bearer tokens, long hex/base64
 * secrets, card-number-shaped digit runs) are masked wherever they appear,
 * including inside error messages. Logging a secret is a bug, so the logger
 * defends against it instead of trusting every call site.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

const SENSITIVE_KEY = /(pin|token|secret|passw|authoriz|api.?key|cookie|set-cookie|card|cvv|credential|signature|dsn)/i;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const BEARER = /\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const KEY_VALUE = /(\b[A-Za-z0-9_]*(?:api[_-]?key|token|secret|passw(?:or)?d)|\bpin)(\s*[=:]\s*)["']?[^\s"'&,;]{3,}/gi;
const LONG_SECRET = /\b(?=[A-Za-z0-9_-]*[0-9])(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{32,}\b/g;
const PAN_LIKE = /\b\d{13,19}\b/g;

export const REDACTED = "[redacted]";

export function redactString(value: string): string {
  return value
    .replace(JWT, REDACTED)
    .replace(BEARER, (_m, scheme: string) => `${scheme} ${REDACTED}`)
    .replace(KEY_VALUE, (_m, key: string, sep: string) => `${key}${sep}${REDACTED}`)
    .replace(LONG_SECRET, REDACTED)
    .replace(PAN_LIKE, REDACTED);
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[truncated]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactString(value.length > 2000 ? `${value.slice(0, 2000)}...` : value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Error) {
    return { name: value.name, message: redactString(value.message), stack: value.stack ? redactString(value.stack).split("\n").slice(0, 8).join("\n") : undefined };
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redact(item, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY.test(key) ? REDACTED : redact(item, depth + 1);
    }
    return out;
  }
  return String(value);
}

type Sink = (line: string, level: LogLevel) => void;

const defaultSink: Sink = (line, level) => {
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
};

let sink: Sink = defaultSink;

/** Tests (and a future log shipper) can replace where lines go. */
export function setLogSink(next: Sink | null): void {
  sink = next ?? defaultSink;
}

export function logEvent(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
  const record = {
    ts: new Date().toISOString(),
    level,
    event,
    ...(redact(fields) as Record<string, unknown>),
  };
  sink(JSON.stringify(record), level);
}

export const log = {
  debug: (event: string, fields?: Record<string, unknown>) => logEvent("debug", event, fields),
  info: (event: string, fields?: Record<string, unknown>) => logEvent("info", event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => logEvent("warn", event, fields),
  error: (event: string, fields?: Record<string, unknown>) => logEvent("error", event, fields),
};
