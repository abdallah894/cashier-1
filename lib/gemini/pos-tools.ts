import { piastersToEgpInput } from "@/lib/money";

export type PosData = {
  findActiveProducts: (query: string) => Promise<
    Array<{
      barcode: string;
      nameAr: string;
      nameEn: string;
      pricePiasters: number;
      stockQty: number;
      lowStockThreshold: number;
      unit: string;
    }>
  >;
  getTodaySales: () => Promise<
    Array<{
      totalPiasters: number;
      items: Array<{ nameAr: string; nameEn: string; qty: number; lineTotalPiasters: number }>;
    }>
  >;
};

type Product = Awaited<ReturnType<PosData["findActiveProducts"]>>[number];

function toProductResult(product: Product) {
  return {
    barcode: product.barcode,
    nameAr: product.nameAr,
    nameEn: product.nameEn,
    pricePiasters: product.pricePiasters,
    priceEgp: piastersToEgpInput(product.pricePiasters),
    stockQty: product.stockQty,
    lowStockThreshold: product.lowStockThreshold,
    lowStock: product.stockQty <= product.lowStockThreshold,
    unit: product.unit,
  };
}

export function createPosTools(data: PosData) {
  async function productsFor(query: unknown) {
    const value = String(query ?? "").trim();
    if (!value) return [];
    return data.findActiveProducts(value);
  }

  return {
    async lookupProduct(args: Record<string, unknown>) {
      return { products: (await productsFor(args.query)).map(toProductResult) };
    },
    async checkStock(args: Record<string, unknown>) {
      return { products: (await productsFor(args.query)).map(toProductResult) };
    },
    async getTodaysSales() {
      const sales = await data.getTodaySales();
      const items = new Map<
        string,
        { nameAr: string; nameEn: string; qty: number; revenuePiasters: number }
      >();
      for (const sale of sales) {
        for (const item of sale.items) {
          const key = `${item.nameAr}\u0000${item.nameEn}`;
          const current = items.get(key) ?? {
            nameAr: item.nameAr,
            nameEn: item.nameEn,
            qty: 0,
            revenuePiasters: 0,
          };
          current.qty += item.qty;
          current.revenuePiasters += item.lineTotalPiasters;
          items.set(key, current);
        }
      }
      const totalPiasters = sales.reduce((sum, sale) => sum + sale.totalPiasters, 0);
      return {
        transactionCount: sales.length,
        totalPiasters,
        totalEgp: piastersToEgpInput(totalPiasters),
        topItems: [...items.values()]
          .sort((a, b) => b.revenuePiasters - a.revenuePiasters)
          .slice(0, 5),
      };
    },
  };
}
