import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve("app/api/gemini/route.ts"), "utf8");

if (!source.includes("'gemini-3.8-flash'")) {
  throw new Error("Expected gemini-3.8-flash to be a fallback model");
}

if (source.includes("'gemini-2.5-flash'")) {
  throw new Error("gemini-2.5-flash is no longer available and must not be configured");
}
