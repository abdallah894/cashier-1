/**
 * A receipt page must not disappear because an optional lookup failed.
 * Run with: npx tsx scripts/test-optional-query.ts
 */
import { describeError, optionalQuery } from "../lib/supabase/queries/optional";
import { mapDbError } from "../lib/actions/result";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!cond) failures++;
}

async function main() {
  const logged: string[] = [];
  const original = console.error;
  const originalLog = console.log;
  const capture = (...args: unknown[]) => logged.push(args.map(String).join(" "));
  console.error = capture;

  check("a working lookup returns its value", (await optionalQuery("ok", async () => 5, 0)) === 5);

  const pgError = { message: "permission denied for table tills", code: "42501", details: null, hint: null };
  console.log = capture;
  const value = await optionalQuery("current_till", async () => { throw pgError; }, "fallback");
  console.log = originalLog;
  check("a failing lookup returns the fallback", value === "fallback");
  const line = logged.find((l) => l.includes("optional_query_failed")) ?? "";
  check("the log names the lookup", line.includes("current_till"), line);
  check("the log carries the database error", line.includes("permission denied for table tills") && line.includes("42501"), line);

  check("describeError keeps message and code", JSON.stringify(describeError(pgError)) === JSON.stringify({ message: "permission denied for table tills", code: "42501" }));
  check("describeError handles plain values", describeError("boom").message === "boom");

  // an unrecognised database error still says "unknown" to the user, but the log keeps the reason
  logged.length = 0;
  console.log = capture;
  const key = mapDbError({ code: "23514", message: 'new row violates check constraint "products_price_check"' });
  const known = mapDbError({ code: "23505", message: "duplicate key" });
  console.log = originalLog;
  check("unmapped database errors map to unknown", key === "unknown");
  check("unmapped database errors are logged with code and message", logged.some((l) => l.includes("db_error_unmapped") && l.includes("23514") && l.includes("products_price_check")));
  check("known database errors are not logged as unmapped", known === "duplicateBarcode" && logged.filter((l) => l.includes("db_error_unmapped")).length === 1);

  console.error = original;
  if (failures > 0) process.exit(1);
  console.log("Optional query tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
