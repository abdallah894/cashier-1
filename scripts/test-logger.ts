import { log, redact, redactString, REDACTED, setLogSink } from "../lib/observability/log";

let failures = 0;
function check(name: string, condition: boolean, detail = "") {
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!condition) failures++;
}

const lines: string[] = [];
setLogSink((line) => lines.push(line));

const JWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const SERVICE_KEY = "sb_secret_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6";

log.error("checkout_failed", { code: "rpc_unreachable", pin: "1234", apiKey: "abc", nested: { Authorization: `Bearer ${JWT}`, ok: "fine" } });
const out = JSON.parse(lines[0]);
check("a log line is one JSON object with time, level and event", typeof out.ts === "string" && out.level === "error" && out.event === "checkout_failed");
check("non-sensitive fields are kept", out.code === "rpc_unreachable" && out.nested.ok === "fine");
check("sensitive field names are redacted", out.pin === REDACTED && out.apiKey === REDACTED && out.nested.Authorization === REDACTED);

const cases: [string, string][] = [
  [`request failed with ${JWT} attached`, JWT],
  [`Authorization: Bearer abcdefgh12345678`, "abcdefgh12345678"],
  [`GROQ_API_KEY=gsk_abcdefghijklmnop failed`, "gsk_abcdefghijklmnop"],
  [`using key ${SERVICE_KEY} for admin`, SERVICE_KEY],
  [`card 4111111111111111 declined`, "4111111111111111"],
  [`password: hunter2hunter2`, "hunter2hunter2"],
  [`?token=abcdef123456&x=1`, "abcdef123456"],
];
for (const [input, secret] of cases) {
  const redacted = redactString(input);
  check(`secret values are masked inside text: ${input.slice(0, 32)}`, !redacted.includes(secret), redacted);
}
check("ordinary prose is left alone", redactString("Insufficient stock for Milk 1L: have 3, need 5") === "Insufficient stock for Milk 1L: have 3, need 5");
check("an order number or short id is not mistaken for a secret", redactString("sale #1234 shift 17") === "sale #1234 shift 17");

const err = redact(new Error(`boom with ${SERVICE_KEY}`)) as { message: string; name: string };
check("error messages are redacted and keep their name", err.name === "Error" && !err.message.includes(SERVICE_KEY));
check("deep and cyclic-ish structures are bounded", JSON.stringify(redact({ a: { b: { c: { d: { e: { f: { g: { h: 1 } } } } } } } })).includes("[truncated]"));
check("long arrays are capped", (redact(Array.from({ length: 500 }, (_, i) => i)) as number[]).length === 50);
check("very long strings are truncated", (redact("x".repeat(5000)) as string).length < 2100);
check("numbers and booleans pass through", redact({ n: 5, b: true }) !== undefined && (redact(7) as number) === 7);

lines.length = 0;
log.warn("provider_down", { provider: "groq", detail: `HTTP 401 ${SERVICE_KEY}` });
check("a secret inside a string field never reaches the sink", !lines[0].includes(SERVICE_KEY));
check("warn lines carry their level", JSON.parse(lines[0]).level === "warn");

setLogSink(null);
if (failures > 0) process.exit(1);
console.log("Logger redaction passes.");
