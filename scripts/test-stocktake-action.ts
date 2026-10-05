import {
  approveStocktakeSchema,
  createStocktakeSchema,
  saveCountsSchema,
} from "../lib/validation/stocktake";

let failures = 0;
function check(name: string, condition: boolean) {
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}`);
  if (!condition) failures++;
}

const ID = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";

check("full count needs no category", createStocktakeSchema.safeParse({ scope: "full" }).success);
check("cycle count needs a category", !createStocktakeSchema.safeParse({ scope: "cycle" }).success);
check("cycle count with a category is valid", createStocktakeSchema.safeParse({ scope: "cycle", categoryId: ID }).success);

const counts = (countedQty: number | null) => ({ stocktakeId: ID, counts: [{ productId: ID2, countedQty }] });
check("accepts a weighed quantity", saveCountsSchema.safeParse(counts(5.25)).success);
check("accepts null to clear a count", saveCountsSchema.safeParse(counts(null)).success);
check("rejects a negative quantity", !saveCountsSchema.safeParse(counts(-1)).success);
check("rejects more than three decimals", !saveCountsSchema.safeParse(counts(1.2345)).success);
check("rejects an empty batch", !saveCountsSchema.safeParse({ stocktakeId: ID, counts: [] }).success);

check("approval defaults to no resolutions", JSON.stringify(approveStocktakeSchema.parse({ stocktakeId: ID }).resolutions) === "{}");
check("approval accepts known resolutions", approveStocktakeSchema.safeParse({ stocktakeId: ID, resolutions: { [ID2]: "use_count" } }).success);
check("approval rejects unknown resolutions", !approveStocktakeSchema.safeParse({ stocktakeId: ID, resolutions: { [ID2]: "guess" } }).success);

if (failures > 0) process.exit(1);
console.log("Stocktake action validation passes.");
