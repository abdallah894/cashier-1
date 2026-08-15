/**
 * Cart math tests — run with: npm run test:cart
 *
 * 1. Unit-checks computeTotals (integer piaster math, VAT extraction,
 *    largest-remainder sale-discount distribution).
 * 2. Cross-checks against the REAL create_sale RPC in PGlite: the totals
 *    the register displays must equal what Postgres records.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { computeTotals, toSaleItems, type CartItem, type Discount } from "../lib/store/cart";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!cond) failures++;
}

const item = (over: Partial<CartItem>): CartItem => ({
  productId: "p",
  barcode: "b",
  nameAr: "منتج",
  nameEn: "Product",
  unitPrice: 1000,
  rateBp: 0,
  unit: "piece",
  stockQty: 999,
  qty: 1,
  discount: null,
  ...over,
});

// ---------- 1. pure math ----------

{
  // mirror of the PGlite phase-1 scenario: 2 rice + 1 cola + 1.25kg tomatoes(-1.00)
  const totals = computeTotals(
    [
      item({ productId: "rice", unitPrice: 4800, rateBp: 0, qty: 2 }),
      item({ productId: "cola", unitPrice: 2600, rateBp: 1400, qty: 1 }),
      item({
        productId: "tomato",
        unitPrice: 1995,
        rateBp: 0,
        unit: "kg",
        qty: 1.25,
        discount: { kind: "fixed", piasters: 100 },
      }),
    ],
    null
  );
  check("known scenario: total 14594", totals.total === 14594, String(totals.total));
  check("known scenario: subtotal 14275", totals.subtotal === 14275, String(totals.subtotal));
  check("known scenario: tax 319", totals.taxTotal === 319, String(totals.taxTotal));
  check("known scenario: discount 100", totals.discountTotal === 100);
  check(
    "VAT breakdown: 0% net 11994, 14% tax 319",
    totals.vatByRate.get(0)?.net === 11994 && totals.vatByRate.get(1400)?.tax === 319
  );
}

{
  // percent line discount: 10% of 2600 = 260
  const totals = computeTotals(
    [item({ unitPrice: 2600, discount: { kind: "percent", bp: 1000 } })],
    null
  );
  check("10% line discount = 260", totals.discountTotal === 260 && totals.total === 2340);
}

{
  // kg rounding: 0.435 kg × 19.95 EGP = 867.825 → 868 piasters
  const totals = computeTotals([item({ unitPrice: 1995, unit: "kg", qty: 0.435 })], null);
  check("0.435 kg × 1995 rounds to 868", totals.total === 868, String(totals.total));
}

{
  // sale discount distribution: 1000 + 500 gross, fixed 100 → 67 + 33
  const totals = computeTotals(
    [item({ productId: "a", unitPrice: 1000 }), item({ productId: "b", unitPrice: 500 })],
    { kind: "fixed", piasters: 100 }
  );
  const shares = totals.lines.map((l) => l.saleDiscountShare);
  check("largest-remainder shares 67/33", shares[0] === 67 && shares[1] === 33, shares.join("/"));
  check("distributed sum equals sale discount", shares[0] + shares[1] === 100);
  check("total 1400", totals.total === 1400);
}

{
  // percent sale discount over mixed rates: invariants only
  const items = [
    item({ productId: "a", unitPrice: 3333, rateBp: 1400, qty: 3 }),
    item({ productId: "b", unitPrice: 777, rateBp: 0, qty: 1.111, unit: "kg" }),
    item({
      productId: "c",
      unitPrice: 12345,
      rateBp: 1400,
      qty: 1,
      discount: { kind: "percent", bp: 550 },
    }),
  ];
  const totals = computeTotals(items, { kind: "percent", bp: 725 });
  const shareSum = totals.lines.reduce((a, l) => a + l.saleDiscountShare, 0);
  check("Σshares = saleDiscountAmount", shareSum === totals.saleDiscountAmount);
  check(
    "every line: gross = net + tax and gross ≥ 0",
    totals.lines.every((l) => l.gross === l.net + l.tax && l.gross >= 0)
  );
  check("total = subtotal + tax", totals.total === totals.subtotal + totals.taxTotal);
  check(
    "all integers",
    totals.lines.every((l) =>
      [l.base, l.gross, l.net, l.tax, l.lineDiscount, l.saleDiscountShare].every(Number.isInteger)
    )
  );
}

{
  // sale discount larger than one line's gross must not go negative
  const totals = computeTotals(
    [item({ productId: "a", unitPrice: 10 }), item({ productId: "b", unitPrice: 100000 })],
    { kind: "fixed", piasters: 100000 }
  );
  check(
    "no negative line after huge sale discount",
    totals.lines.every((l) => l.gross >= 0)
  );
}

// ---------- 2. cross-check vs create_sale in PGlite ----------

async function crossCheck() {
  const db = new PGlite();
  await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean default false);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
  alter table storage.objects enable row level security;
`);
  for (const f of [
    "20260704120000_schema.sql",
    "20260704120100_rls.sql",
    "20260705090000_stock_and_images.sql",
  ]) {
    await db.exec(await readFile(`supabase/migrations/${f}`, "utf8"));
  }
  await db.exec(`
  insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000001', 'c@t');
  insert into public.profiles (id, full_name, role) values ('00000000-0000-0000-0000-000000000001', 'C', 'cashier');
  insert into public.products (id, barcode, name_ar, name_en, price, cost, tax_rate, stock_qty, unit) values
    ('00000000-0000-0000-0000-0000000000a1', '1', 'أ', 'A', 4800, 0, 0,    100, 'piece'),
    ('00000000-0000-0000-0000-0000000000a2', '2', 'ب', 'B', 2600, 0, 0.14, 100, 'piece'),
    ('00000000-0000-0000-0000-0000000000a3', '3', 'ت', 'C', 1995, 0, 0,    100, 'kg'),
    ('00000000-0000-0000-0000-0000000000a4', '4', 'ث', 'D', 12345, 0, 0.14, 100, 'piece');
`);

  const scenarios: { name: string; items: CartItem[]; saleDiscount: Discount | null }[] = [
    {
      name: "scan flow (dup item, kg line, line discount)",
      items: [
        item({
          productId: "00000000-0000-0000-0000-0000000000a1",
          unitPrice: 4800,
          rateBp: 0,
          qty: 2,
        }),
        item({
          productId: "00000000-0000-0000-0000-0000000000a2",
          unitPrice: 2600,
          rateBp: 1400,
          qty: 1,
        }),
        item({
          productId: "00000000-0000-0000-0000-0000000000a3",
          unitPrice: 1995,
          rateBp: 0,
          unit: "kg",
          qty: 1.25,
          discount: { kind: "fixed", piasters: 100 },
        }),
      ],
      saleDiscount: null,
    },
    {
      name: "percent sale discount over mixed rates",
      items: [
        item({
          productId: "00000000-0000-0000-0000-0000000000a2",
          unitPrice: 2600,
          rateBp: 1400,
          qty: 3,
        }),
        item({
          productId: "00000000-0000-0000-0000-0000000000a3",
          unitPrice: 1995,
          rateBp: 0,
          unit: "kg",
          qty: 0.435,
        }),
        item({
          productId: "00000000-0000-0000-0000-0000000000a4",
          unitPrice: 12345,
          rateBp: 1400,
          qty: 1,
          discount: { kind: "percent", bp: 550 },
        }),
      ],
      saleDiscount: { kind: "percent", bp: 725 },
    },
  ];

  for (const s of scenarios) {
    const totals = computeTotals(s.items, s.saleDiscount);
    const payload = toSaleItems(totals);
    const { rows } = await db.query<{
      subtotal: string;
      tax_total: string;
      discount_total: string;
      total: string;
      change_due: string;
    }>(
      `select * from public.create_sale($1::jsonb, 'cash', null, $2, '00000000-0000-0000-0000-000000000001'::uuid)`,
      [JSON.stringify(payload), totals.total + 5000]
    );
    const sql = rows[0];
    check(
      `RPC match [${s.name}]: total`,
      Number(sql.total) === totals.total,
      `sql=${sql.total} client=${totals.total}`
    );
    check(
      `RPC match [${s.name}]: subtotal`,
      Number(sql.subtotal) === totals.subtotal,
      `sql=${sql.subtotal} client=${totals.subtotal}`
    );
    check(
      `RPC match [${s.name}]: tax`,
      Number(sql.tax_total) === totals.taxTotal,
      `sql=${sql.tax_total} client=${totals.taxTotal}`
    );
    check(
      `RPC match [${s.name}]: discount`,
      Number(sql.discount_total) === totals.discountTotal,
      `sql=${sql.discount_total} client=${totals.discountTotal}`
    );
    check(`RPC match [${s.name}]: change`, Number(sql.change_due) === 5000);
  }
}

crossCheck().then(() => {
  console.log(failures === 0 ? "\nALL CART MATH CHECKS PASSED" : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
});
