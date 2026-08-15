/**
 * Seed script — run with: npm run seed
 *
 * Requires .env.local with NEXT_PUBLIC_SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY (service role bypasses RLS — server-side only).
 *
 * Idempotent: re-running never duplicates users, categories or products,
 * and never overwrites live stock quantities.
 *
 * Money convention: integer piasters (EGP 48.95 → 4895).
 * tax_rate: 0 for basic foods (VAT-exempt in Egypt), 0.14 otherwise.
 */
import { createClient } from "@supabase/supabase-js";
import type { Database, TablesInsert } from "../lib/supabase/database.types";

type UserRole = Database["public"]["Enums"]["user_role"];

try {
  process.loadEnvFile(".env.local");
} catch {
  // fine — env vars may already be set in the shell
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (see .env.example)");
  process.exit(1);
}

const supabase = createClient<Database>(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/** EGP to integer piasters. Defined so no float math leaks into amounts. */
function egp(pounds: number, piasters = 0): number {
  return pounds * 100 + piasters;
}

/** Valid EAN-13 from a 12-digit base (622 = Egypt GS1 prefix). */
function ean13(base12: string): string {
  const digits = base12.split("").map(Number);
  const sum = digits.reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 1 : 3), 0);
  return base12 + String((10 - (sum % 10)) % 10);
}

async function ensureUser(email: string, password: string, fullName: string, role: UserRole) {
  let userId: string;

  const { data: created, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (created?.user) {
    userId = created.user.id;
  } else if (error?.code === "email_exists") {
    const { data: list, error: listError } = await supabase.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    if (listError) throw listError;
    const existing = list.users.find((u) => u.email === email);
    if (!existing) throw new Error(`User ${email} exists but was not found via listUsers`);
    userId = existing.id;
  } else {
    throw error ?? new Error(`Failed to create user ${email}`);
  }

  const { error: profileError } = await supabase
    .from("profiles")
    .upsert({ id: userId, full_name: fullName, role, active: true }, { onConflict: "id" });
  if (profileError) throw profileError;

  console.log(`  ${role.padEnd(7)} ${email} (${userId})`);
  return userId;
}

const categories: Array<{ name_en: string; name_ar: string; sort_order: number }> = [
  { name_en: "Groceries", name_ar: "بقالة", sort_order: 1 },
  { name_en: "Produce", name_ar: "خضروات وفواكه", sort_order: 2 },
  { name_en: "Dairy & Eggs", name_ar: "ألبان وبيض", sort_order: 3 },
  { name_en: "Beverages", name_ar: "مشروبات", sort_order: 4 },
  { name_en: "Snacks", name_ar: "سناكس وحلويات", sort_order: 5 },
  { name_en: "Frozen & Canned", name_ar: "مجمدات ومعلبات", sort_order: 6 },
  { name_en: "Cleaning", name_ar: "منظفات", sort_order: 7 },
  { name_en: "Personal Care", name_ar: "عناية شخصية", sort_order: 8 },
];

type SeedProduct = {
  category: string; // name_en of the category
  name_en: string;
  name_ar: string;
  price: number; // piasters, VAT-inclusive shelf price
  cost: number; // piasters
  tax_rate: number; // 0 = exempt basic food, 0.14 = standard VAT
  unit: "piece" | "kg";
  stock_qty: number;
  low_stock_threshold: number;
};

// Basic foods (rice, oil, dairy, produce…) are VAT-exempt in Egypt → tax_rate 0.
// Processed foods, drinks, cleaning and personal care carry 14%.
const products: SeedProduct[] = [
  // Groceries
  {
    category: "Groceries",
    name_en: "Egyptian Rice 1kg",
    name_ar: "أرز مصري ١ كجم",
    price: egp(48),
    cost: egp(41),
    tax_rate: 0,
    unit: "piece",
    stock_qty: 120,
    low_stock_threshold: 20,
  },
  {
    category: "Groceries",
    name_en: "Sugar 1kg",
    name_ar: "سكر ١ كجم",
    price: egp(38, 50),
    cost: egp(33),
    tax_rate: 0,
    unit: "piece",
    stock_qty: 150,
    low_stock_threshold: 25,
  },
  {
    category: "Groceries",
    name_en: "Sunflower Oil 800ml",
    name_ar: "زيت عباد الشمس ٨٠٠ مل",
    price: egp(74, 75),
    cost: egp(64),
    tax_rate: 0,
    unit: "piece",
    stock_qty: 80,
    low_stock_threshold: 15,
  },
  {
    category: "Groceries",
    name_en: "El Arosa Tea 250g",
    name_ar: "شاي العروسة ٢٥٠ جم",
    price: egp(65),
    cost: egp(55),
    tax_rate: 0.14,
    unit: "piece",
    stock_qty: 60,
    low_stock_threshold: 10,
  },
  {
    category: "Groceries",
    name_en: "Pasta Penne 400g",
    name_ar: "مكرونة قلم ٤٠٠ جم",
    price: egp(17, 50),
    cost: egp(14),
    tax_rate: 0,
    unit: "piece",
    stock_qty: 200,
    low_stock_threshold: 30,
  },
  {
    category: "Groceries",
    name_en: "Yellow Lentils 500g",
    name_ar: "عدس أصفر ٥٠٠ جم",
    price: egp(44),
    cost: egp(37),
    tax_rate: 0,
    unit: "piece",
    stock_qty: 90,
    low_stock_threshold: 15,
  },
  {
    category: "Groceries",
    name_en: "White Flour 1kg",
    name_ar: "دقيق أبيض ١ كجم",
    price: egp(28),
    cost: egp(23, 50),
    tax_rate: 0,
    unit: "piece",
    stock_qty: 100,
    low_stock_threshold: 20,
  },

  // Produce (per-kg — decimal quantities)
  {
    category: "Produce",
    name_en: "Tomatoes",
    name_ar: "طماطم",
    price: egp(19, 95),
    cost: egp(14),
    tax_rate: 0,
    unit: "kg",
    stock_qty: 45.5,
    low_stock_threshold: 10,
  },
  {
    category: "Produce",
    name_en: "Potatoes",
    name_ar: "بطاطس",
    price: egp(14, 50),
    cost: egp(10),
    tax_rate: 0,
    unit: "kg",
    stock_qty: 60,
    low_stock_threshold: 12,
  },
  {
    category: "Produce",
    name_en: "Onions",
    name_ar: "بصل",
    price: egp(12),
    cost: egp(8),
    tax_rate: 0,
    unit: "kg",
    stock_qty: 50,
    low_stock_threshold: 10,
  },
  {
    category: "Produce",
    name_en: "Cucumbers",
    name_ar: "خيار",
    price: egp(17, 50),
    cost: egp(12),
    tax_rate: 0,
    unit: "kg",
    stock_qty: 30,
    low_stock_threshold: 8,
  },
  {
    category: "Produce",
    name_en: "Bananas",
    name_ar: "موز",
    price: egp(32),
    cost: egp(25),
    tax_rate: 0,
    unit: "kg",
    stock_qty: 25,
    low_stock_threshold: 6,
  },

  // Dairy & Eggs
  {
    category: "Dairy & Eggs",
    name_en: "Juhayna Milk 1L",
    name_ar: "لبن جهينة ١ لتر",
    price: egp(54, 50),
    cost: egp(47),
    tax_rate: 0,
    unit: "piece",
    stock_qty: 70,
    low_stock_threshold: 15,
  },
  {
    category: "Dairy & Eggs",
    name_en: "White Cheese 500g",
    name_ar: "جبنة بيضاء ٥٠٠ جم",
    price: egp(89, 95),
    cost: egp(75),
    tax_rate: 0,
    unit: "piece",
    stock_qty: 40,
    low_stock_threshold: 8,
  },
  {
    category: "Dairy & Eggs",
    name_en: "Yogurt 105g",
    name_ar: "زبادي ١٠٥ جم",
    price: egp(14, 50),
    cost: egp(11),
    tax_rate: 0,
    unit: "piece",
    stock_qty: 120,
    low_stock_threshold: 24,
  },
  {
    category: "Dairy & Eggs",
    name_en: "Eggs Tray (30)",
    name_ar: "طبق بيض (٣٠)",
    price: egp(165),
    cost: egp(148),
    tax_rate: 0,
    unit: "piece",
    stock_qty: 35,
    low_stock_threshold: 8,
  },
  {
    category: "Dairy & Eggs",
    name_en: "Butter 100g",
    name_ar: "زبدة ١٠٠ جم",
    price: egp(46),
    cost: egp(38),
    tax_rate: 0,
    unit: "piece",
    stock_qty: 50,
    low_stock_threshold: 10,
  },

  // Beverages
  {
    category: "Beverages",
    name_en: "Orange Juice 1L",
    name_ar: "عصير برتقال ١ لتر",
    price: egp(42),
    cost: egp(33),
    tax_rate: 0.14,
    unit: "piece",
    stock_qty: 60,
    low_stock_threshold: 12,
  },
  {
    category: "Beverages",
    name_en: "Cola 1L",
    name_ar: "كولا ١ لتر",
    price: egp(26),
    cost: egp(20),
    tax_rate: 0.14,
    unit: "piece",
    stock_qty: 100,
    low_stock_threshold: 20,
  },
  {
    category: "Beverages",
    name_en: "Mineral Water 1.5L",
    name_ar: "مياه معدنية ١٫٥ لتر",
    price: egp(10),
    cost: egp(7),
    tax_rate: 0.14,
    unit: "piece",
    stock_qty: 200,
    low_stock_threshold: 40,
  },
  {
    category: "Beverages",
    name_en: "Mango Nectar 235ml",
    name_ar: "عصير مانجو ٢٣٥ مل",
    price: egp(15),
    cost: egp(11, 50),
    tax_rate: 0.14,
    unit: "piece",
    stock_qty: 90,
    low_stock_threshold: 18,
  },

  // Snacks
  {
    category: "Snacks",
    name_en: "Chipsy Chips 75g",
    name_ar: "شيبسي ٧٥ جم",
    price: egp(15),
    cost: egp(11),
    tax_rate: 0.14,
    unit: "piece",
    stock_qty: 150,
    low_stock_threshold: 30,
  },
  {
    category: "Snacks",
    name_en: "Tea Biscuits 120g",
    name_ar: "بسكويت شاي ١٢٠ جم",
    price: egp(10),
    cost: egp(7, 50),
    tax_rate: 0.14,
    unit: "piece",
    stock_qty: 180,
    low_stock_threshold: 36,
  },
  {
    category: "Snacks",
    name_en: "Chocolate Wafer 36g",
    name_ar: "ويفر شوكولاتة ٣٦ جم",
    price: egp(12),
    cost: egp(9),
    tax_rate: 0.14,
    unit: "piece",
    stock_qty: 140,
    low_stock_threshold: 28,
  },
  {
    category: "Snacks",
    name_en: "Halawa Tahinia 250g",
    name_ar: "حلاوة طحينية ٢٥٠ جم",
    price: egp(52),
    cost: egp(43),
    tax_rate: 0.14,
    unit: "piece",
    stock_qty: 45,
    low_stock_threshold: 9,
  },

  // Frozen & Canned
  {
    category: "Frozen & Canned",
    name_en: "Frozen Molokhia 400g",
    name_ar: "ملوخية مجمدة ٤٠٠ جم",
    price: egp(44, 50),
    cost: egp(36),
    tax_rate: 0.14,
    unit: "piece",
    stock_qty: 55,
    low_stock_threshold: 10,
  },
  {
    category: "Frozen & Canned",
    name_en: "Frozen Mixed Vegetables 900g",
    name_ar: "خضار مشكل مجمد ٩٠٠ جم",
    price: egp(74),
    cost: egp(60),
    tax_rate: 0.14,
    unit: "piece",
    stock_qty: 40,
    low_stock_threshold: 8,
  },
  {
    category: "Frozen & Canned",
    name_en: "Tuna 140g",
    name_ar: "تونة ١٤٠ جم",
    price: egp(55),
    cost: egp(46),
    tax_rate: 0.14,
    unit: "piece",
    stock_qty: 75,
    low_stock_threshold: 15,
  },
  {
    category: "Frozen & Canned",
    name_en: "Tomato Paste 320g",
    name_ar: "صلصة طماطم ٣٢٠ جم",
    price: egp(27, 50),
    cost: egp(22),
    tax_rate: 0.14,
    unit: "piece",
    stock_qty: 85,
    low_stock_threshold: 17,
  },
  {
    category: "Frozen & Canned",
    name_en: "Canned Foul 400g",
    name_ar: "فول مدمس ٤٠٠ جم",
    price: egp(21, 50),
    cost: egp(17),
    tax_rate: 0,
    unit: "piece",
    stock_qty: 110,
    low_stock_threshold: 22,
  },

  // Cleaning
  {
    category: "Cleaning",
    name_en: "Dish Soap 650ml",
    name_ar: "صابون أطباق ٦٥٠ مل",
    price: egp(47, 50),
    cost: egp(38),
    tax_rate: 0.14,
    unit: "piece",
    stock_qty: 65,
    low_stock_threshold: 13,
  },
  {
    category: "Cleaning",
    name_en: "Detergent Powder 800g",
    name_ar: "مسحوق غسيل ٨٠٠ جم",
    price: egp(59, 95),
    cost: egp(49),
    tax_rate: 0.14,
    unit: "piece",
    stock_qty: 70,
    low_stock_threshold: 14,
  },
  {
    category: "Cleaning",
    name_en: "Bleach 1L",
    name_ar: "كلور ١ لتر",
    price: egp(34, 50),
    cost: egp(27),
    tax_rate: 0.14,
    unit: "piece",
    stock_qty: 80,
    low_stock_threshold: 16,
  },

  // Personal Care
  {
    category: "Personal Care",
    name_en: "Shampoo 400ml",
    name_ar: "شامبو ٤٠٠ مل",
    price: egp(119, 95),
    cost: egp(98),
    tax_rate: 0.14,
    unit: "piece",
    stock_qty: 35,
    low_stock_threshold: 7,
  },
  {
    category: "Personal Care",
    name_en: "Soap Bar 125g",
    name_ar: "صابونة ١٢٥ جم",
    price: egp(24, 50),
    cost: egp(19),
    tax_rate: 0.14,
    unit: "piece",
    stock_qty: 95,
    low_stock_threshold: 19,
  },
  {
    category: "Personal Care",
    name_en: "Toothpaste 100ml",
    name_ar: "معجون أسنان ١٠٠ مل",
    price: egp(45),
    cost: egp(36),
    tax_rate: 0.14,
    unit: "piece",
    stock_qty: 55,
    low_stock_threshold: 11,
  },
];

async function main() {
  console.log("Seeding users…");
  await ensureUser(
    process.env.SEED_ADMIN_EMAIL ?? "admin@cachier.local",
    process.env.SEED_ADMIN_PASSWORD ?? "change-me-admin",
    "Admin",
    "admin"
  );
  await ensureUser(
    process.env.SEED_CASHIER_EMAIL ?? "cashier@cachier.local",
    process.env.SEED_CASHIER_PASSWORD ?? "change-me-cashier",
    "Cashier One",
    "cashier"
  );

  console.log("Seeding categories…");
  const { data: existingCats, error: catReadError } = await supabase
    .from("categories")
    .select("id, name_en");
  if (catReadError) throw catReadError;

  const catIdByName = new Map(existingCats.map((c) => [c.name_en, c.id]));
  const missing = categories.filter((c) => !catIdByName.has(c.name_en));
  if (missing.length > 0) {
    const { data: inserted, error } = await supabase
      .from("categories")
      .insert(missing)
      .select("id, name_en");
    if (error) throw error;
    for (const c of inserted) catIdByName.set(c.name_en, c.id);
  }
  console.log(`  ${categories.length} categories (${missing.length} new)`);

  console.log("Seeding products…");
  const rows: TablesInsert<"products">[] = products.map((p, i) => ({
    barcode: ean13(`622100${String(i + 1).padStart(6, "0")}`),
    name_ar: p.name_ar,
    name_en: p.name_en,
    category_id: catIdByName.get(p.category) ?? null,
    price: p.price,
    cost: p.cost,
    tax_rate: p.tax_rate,
    stock_qty: p.stock_qty,
    low_stock_threshold: p.low_stock_threshold,
    unit: p.unit,
    active: true,
  }));

  // ignoreDuplicates: reseeding must not clobber live stock/prices
  const { data: upserted, error: productError } = await supabase
    .from("products")
    .upsert(rows, { onConflict: "barcode", ignoreDuplicates: true })
    .select("id");
  if (productError) throw productError;
  console.log(`  ${rows.length} products (${upserted?.length ?? 0} new)`);

  console.log("Done.");
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
