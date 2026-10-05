import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";

// Runs every DB-backed/in-memory suite (PGlite) and fails if any one fails.
// Gemini/Groq suites are excluded: they exercise provider mocks, not POS data.
const suites = readdirSync("scripts")
  .filter((f) => /^test-.*\.ts$/.test(f) && !/gemini|groq/.test(f))
  .sort();

const failed: string[] = [];
for (const suite of suites) {
  console.log(`\n=== ${suite}`);
  const result = spawnSync("npx", ["tsx", `scripts/${suite}`], { stdio: "inherit", shell: true });
  if (result.status !== 0) failed.push(suite);
}

if (failed.length > 0) {
  console.error(`\nFAILED: ${failed.join(", ")}`);
  process.exit(1);
}
console.log(`\nAll ${suites.length} suites passed.`);
