import { createPosTools } from "../lib/ai/pos-tools";

const tools = createPosTools({
  async findActiveProducts(query) {
    if (query !== "ice cream") throw new Error(`Unexpected product query: ${query}`);
    return [
      {
        barcode: "622123",
        nameAr: "آيس كريم",
        nameEn: "Ice cream",
        pricePiasters: 4895,
        stockQty: 3,
        lowStockThreshold: 5,
        unit: "piece",
      },
    ];
  },
  async getTodaySales() {
    return [
      {
        totalPiasters: 10000,
        items: [{ nameAr: "لبن", nameEn: "Milk", qty: 2, lineTotalPiasters: 6000 }],
      },
      {
        totalPiasters: 5000,
        items: [{ nameAr: "لبن", nameEn: "Milk", qty: 1, lineTotalPiasters: 3000 }],
      },
    ];
  },
});

void (async () => {
  const productResult = await tools.lookupProduct({ query: "ice cream" });
  if (productResult.products[0]?.priceEgp !== "48.95") {
    throw new Error(`Expected EGP price 48.95, received ${productResult.products[0]?.priceEgp}`);
  }

  const stockResult = await tools.checkStock({ query: "ice cream" });
  if (stockResult.products[0]?.lowStock !== true) {
    throw new Error("Expected ice cream to be marked low stock");
  }

  const salesResult = await tools.getTodaysSales();
  if (salesResult.transactionCount !== 2 || salesResult.totalPiasters !== 15000) {
    throw new Error(`Unexpected sales summary: ${JSON.stringify(salesResult)}`);
  }
  if (salesResult.topItems[0]?.qty !== 3 || salesResult.topItems[0]?.nameEn !== "Milk") {
    throw new Error(`Unexpected top items: ${JSON.stringify(salesResult.topItems)}`);
  }
})();
console.log("Gemini POS tools test passed");
