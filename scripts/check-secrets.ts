import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

/**
 * Secrets hygiene, run by CI:
 *  - no credential-shaped literals in tracked files;
 *  - client code (components/, hooks/, "use client" files) never reads a
 *    server-only environment variable;
 *  - files that hold privileged clients import "server-only";
 *  - .env files are not tracked.
 */
const tracked = execSync("git ls-files", { encoding: "utf8" }).split("\n").filter(Boolean);
let failures = 0;
const fail = (message: string) => {
  console.error(`FAIL  ${message}`);
  failures++;
};

const SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const code = tracked.filter((f) => SOURCE.test(f) && !f.startsWith("node_modules/") && !f.startsWith(".next/"));

// ---- literals ----
const LITERALS: [string, RegExp][] = [
  ["Supabase secret key", /\bsb_secret_[A-Za-z0-9_-]{16,}/],
  ["JWT", /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/],
  ["Groq key", /\bgsk_[A-Za-z0-9]{20,}/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{30,}/],
  ["private key block", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
];
const allText = tracked.filter((f) => !/\.(png|ico|jpg|jpeg|webp|woff2?|lock)$/.test(f) && f !== "package-lock.json");
for (const file of allText) {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  // test fixtures deliberately contain fake credentials to prove redaction works
  if (file.startsWith("scripts/test-")) continue;
  for (const [label, re] of LITERALS) if (re.test(text)) fail(`${label} literal in ${file}`);
}

// ---- env files ----
for (const file of tracked) {
  if (/(^|\/)\.env(\.|$)/.test(file) && !file.endsWith(".example")) fail(`env file is tracked: ${file}`);
}

// ---- client files must not read server env ----
const SERVER_ENV = /process\.env\.(?!NEXT_PUBLIC_|NODE_ENV\b)([A-Z0-9_]+)/g;
for (const file of code) {
  const text = readFileSync(file, "utf8");
  const isClient = /^\s*["']use client["']/m.test(text.split("\n").slice(0, 5).join("\n")) || file.startsWith("components/") || file.startsWith("hooks/");
  if (!isClient) continue;
  for (const match of text.matchAll(SERVER_ENV)) fail(`client file ${file} reads server env ${match[1]}`);
}

// ---- privileged modules are server-only ----
const mustBeServerOnly = ["lib/supabase/admin.ts", "lib/ops/events.ts", "lib/ai/pos-data.ts"];
for (const file of mustBeServerOnly) {
  if (!tracked.includes(file)) continue;
  if (!/import\s+["']server-only["']/.test(readFileSync(file, "utf8"))) fail(`${file} must import "server-only"`);
}

// ---- the service-role key is only ever referenced by server code ----
for (const file of code) {
  // developer tooling that never ships (seed/test scripts, the browser-test config) may pass the key through
  if (file.startsWith("scripts/") || file.startsWith("e2e/") || file === "playwright.config.ts" || file.startsWith("lib/supabase/admin.ts")) continue;
  const text = readFileSync(file, "utf8");
  if (/SUPABASE_SERVICE_ROLE_KEY/.test(text)) fail(`${file} references SUPABASE_SERVICE_ROLE_KEY; use createAdminClient()`);
}

if (failures > 0) {
  console.error(`\n${failures} secrets check(s) failed`);
  process.exit(1);
}
console.log(`PASS  ${tracked.length} tracked files scanned: no secrets, no server env in client code, privileged modules are server-only`);
