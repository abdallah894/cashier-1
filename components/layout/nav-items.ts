import {
  ShoppingCart,
  Package,
  Tags,
  BarChart3,
  Clock,
  ReceiptText,
  UsersRound,
  ShieldCheck,
  CloudUpload,
  ClipboardList,
  Truck,
  PackageCheck,
  Contact,
  Percent,
  Wallet,
  Printer,
  PackageMinus,
  FileUp,
  ChartColumn,
  type LucideIcon,
} from "lucide-react";

export type NavKey =
  | "register"
  | "sales"
  | "shifts"
  | "payments"
  | "offlineSales"
  | "products"
  | "categories"
  | "stockAlerts"
  | "stocktakes"
  | "importProducts"
  | "purchaseOrders"
  | "suppliers"
  | "purchasingReports"
  | "customers"
  | "promotions"
  | "reports"
  | "users"
  | "devices"
  | "audit";

export type NavItem = { key: NavKey; href: string; icon: LucideIcon };
export type NavGroup = { key: "sell" | "stock" | "purchasing" | "customers" | "insights" | "admin"; adminOnly: boolean; items: NavItem[] };

/** One list for the sidebar and the header title, so a page is named the same in both. */
export const NAV_GROUPS: NavGroup[] = [
  {
    key: "sell",
    adminOnly: false,
    items: [
      { key: "register", href: "/register", icon: ShoppingCart },
      { key: "sales", href: "/receipts", icon: ReceiptText },
      { key: "shifts", href: "/shifts", icon: Clock },
      { key: "payments", href: "/payments", icon: Wallet },
      { key: "offlineSales", href: "/offline-sales", icon: CloudUpload },
    ],
  },
  {
    key: "stock",
    adminOnly: true,
    items: [
      { key: "products", href: "/products", icon: Package },
      { key: "categories", href: "/categories", icon: Tags },
      { key: "stockAlerts", href: "/stock-alerts", icon: PackageMinus },
      { key: "stocktakes", href: "/stocktakes", icon: ClipboardList },
      { key: "importProducts", href: "/products/import", icon: FileUp },
    ],
  },
  {
    key: "purchasing",
    adminOnly: true,
    items: [
      { key: "purchaseOrders", href: "/purchase-orders", icon: PackageCheck },
      { key: "suppliers", href: "/suppliers", icon: Truck },
      { key: "purchasingReports", href: "/purchase-orders/reports", icon: ChartColumn },
    ],
  },
  {
    key: "customers",
    adminOnly: true,
    items: [
      { key: "customers", href: "/customers", icon: Contact },
      { key: "promotions", href: "/promotions", icon: Percent },
    ],
  },
  {
    key: "insights",
    adminOnly: true,
    items: [{ key: "reports", href: "/reports", icon: BarChart3 }],
  },
  {
    key: "admin",
    adminOnly: true,
    items: [
      { key: "users", href: "/users", icon: UsersRound },
      { key: "devices", href: "/devices", icon: Printer },
      { key: "audit", href: "/audit", icon: ShieldCheck },
    ],
  },
];

export function navGroupsFor(role: "admin" | "cashier"): NavGroup[] {
  return NAV_GROUPS.filter((group) => role === "admin" || !group.adminOnly);
}

/**
 * The menu entry a path belongs to: the longest matching href wins, so
 * /products/import is "Import products", not "Products".
 * `detail` is true below the entry's own page (/products/<id>).
 */
export function matchNav(pathname: string): { item: NavItem; detail: boolean } | null {
  let best: NavItem | null = null;
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      if ((pathname === item.href || pathname.startsWith(item.href + "/")) && (!best || item.href.length > best.href.length)) {
        best = item;
      }
    }
  }
  return best ? { item: best, detail: pathname !== best.href } : null;
}
