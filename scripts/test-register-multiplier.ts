import { parseMultiplier, qtyStep } from "../lib/register/multiplier";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failures++;
}

check('"3*" means quantity 3', parseMultiplier("3*") === 3);
check("spaces and a trailing × are accepted", parseMultiplier(" 12 × ") === 12 && parseMultiplier("2x") === 2);
check("a weight multiplier keeps 3 decimals", parseMultiplier("0.5*") === 0.5 && parseMultiplier("1.250*") === 1.25);
check("Arabic-Indic digits work", parseMultiplier("٣*") === 3);
check("4 decimals are not a quantity", parseMultiplier("1.2345*") === null);
check("zero is not a multiplier", parseMultiplier("0*") === null);
check("ordinary searches are never swallowed", parseMultiplier("milk") === null && parseMultiplier("3") === null && parseMultiplier("*3") === null && parseMultiplier("") === null && parseMultiplier("3*milk") === null);
check("a barcode-sized number is not a multiplier", parseMultiplier("6221031234567*") === null);
check("pieces step by one", qtyStep("piece") === 1);
check("weighed lines step by 100 g", qtyStep("kg") === 0.1);

if (failures > 0) process.exit(1);
console.log("Register multiplier tests passed.");
