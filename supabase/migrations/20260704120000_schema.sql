-- ============================================================
-- Cachier POS — Phase 1 schema
--
-- Money convention: all money columns are INTEGER PIASTERS
-- (EGP * 100) stored as numeric. 1550 = EGP 15.50.
-- Prices are VAT-INCLUSIVE (Egyptian shelf prices); the VAT
-- portion is extracted at sale time from the snapshot tax_rate.
-- tax_rate is a fraction: 0.14 = 14% VAT, 0 = exempt.
-- Quantities are numeric(10,3) so per-kg items can sell 0.435 kg.
-- ============================================================

-- ---------- Enums ----------

create type public.user_role as enum ('admin', 'cashier');
create type public.product_unit as enum ('piece', 'kg');
create type public.payment_method as enum ('cash', 'card');
create type public.stock_movement_reason as enum ('sale', 'received', 'damaged', 'correction');

-- ---------- Tables ----------

create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  name_ar     text not null,
  name_en     text not null,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

create table public.products (
  id                  uuid primary key default gen_random_uuid(),
  barcode             text not null,
  name_ar             text not null,
  name_en             text not null,
  category_id         uuid references public.categories(id) on delete set null,
  price               numeric(12,0) not null check (price >= 0),          -- piasters, VAT-inclusive
  cost                numeric(12,0) not null default 0 check (cost >= 0), -- piasters
  tax_rate            numeric(5,4) not null default 0.14 check (tax_rate >= 0 and tax_rate <= 1),
  stock_qty           numeric(10,3) not null default 0 check (stock_qty >= 0),
  low_stock_threshold numeric(10,3) not null default 10,
  unit                public.product_unit not null default 'piece',
  active              boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index products_barcode_key on public.products (barcode);
create index products_category_id_idx on public.products (category_id);
-- Register lookups only ever see active products
create index products_active_idx on public.products (active) where active;

create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null,
  role        public.user_role not null default 'cashier',
  pin_hash    text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table public.shifts (
  id              uuid primary key default gen_random_uuid(),
  cashier_id      uuid not null references public.profiles(id),
  opened_at       timestamptz not null default now(),
  closed_at       timestamptz,
  opening_float   numeric(12,0) not null default 0 check (opening_float >= 0), -- piasters
  closing_counted numeric(12,0) check (closing_counted >= 0),                  -- piasters
  expected_cash   numeric(12,0) check (expected_cash >= 0),                    -- piasters
  created_at      timestamptz not null default now()
);

create index shifts_cashier_id_idx on public.shifts (cashier_id);

-- Human-friendly sequential receipt number, independent of uuid PKs
create sequence public.sale_number_seq;

create table public.sales (
  id              uuid primary key default gen_random_uuid(),
  sale_number     bigint not null unique default nextval('public.sale_number_seq'),
  shift_id        uuid references public.shifts(id),
  cashier_id      uuid not null references public.profiles(id),
  subtotal        numeric(12,0) not null check (subtotal >= 0),       -- piasters, net of VAT
  tax_total       numeric(12,0) not null check (tax_total >= 0),      -- piasters
  discount_total  numeric(12,0) not null default 0 check (discount_total >= 0),
  total           numeric(12,0) not null check (total >= 0),          -- piasters, what the customer pays
  payment_method  public.payment_method not null,
  amount_tendered numeric(12,0) check (amount_tendered >= 0),         -- piasters, cash only
  change_due      numeric(12,0) check (change_due >= 0),              -- piasters, cash only
  created_at      timestamptz not null default now()
);

create index sales_shift_id_idx on public.sales (shift_id);
create index sales_cashier_id_idx on public.sales (cashier_id);
create index sales_created_at_idx on public.sales (created_at);

create table public.sale_items (
  id            uuid primary key default gen_random_uuid(),
  sale_id       uuid not null references public.sales(id) on delete cascade,
  -- restrict: products must be deactivated (active=false), never deleted,
  -- so historical receipts keep a valid reference
  product_id    uuid not null references public.products(id) on delete restrict,
  -- snapshots (mandatory): receipts must never change when products are edited
  name_ar       text not null,
  name_en       text not null,
  unit_price    numeric(12,0) not null check (unit_price >= 0),  -- piasters at time of sale
  tax_rate      numeric(5,4) not null,
  qty           numeric(10,3) not null check (qty > 0),
  line_discount numeric(12,0) not null default 0 check (line_discount >= 0), -- piasters
  line_total    numeric(12,0) not null check (line_total >= 0),  -- piasters: round(unit_price*qty) - line_discount
  created_at    timestamptz not null default now()
);

create index sale_items_sale_id_idx on public.sale_items (sale_id);
create index sale_items_product_id_idx on public.sale_items (product_id);

create table public.stock_movements (
  id           uuid primary key default gen_random_uuid(),
  product_id   uuid not null references public.products(id) on delete restrict,
  qty_change   numeric(10,3) not null check (qty_change <> 0), -- negative = out, positive = in
  reason       public.stock_movement_reason not null,
  reference_id uuid,          -- e.g. sales.id when reason = 'sale'
  note         text,
  created_by   uuid references public.profiles(id),
  created_at   timestamptz not null default now()
);

create index stock_movements_product_id_idx on public.stock_movements (product_id);
create index stock_movements_reference_id_idx on public.stock_movements (reference_id);

-- ---------- updated_at maintenance ----------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

-- ---------- Role helpers (used by RLS and create_sale) ----------

-- security definer so it can read profiles without tripping RLS recursion
create or replace function public.current_user_role()
returns public.user_role
language sql
security definer
set search_path = ''
stable
as $$
  select role from public.profiles where id = auth.uid() and active;
$$;

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and active
  );
$$;

-- ---------- Transactional checkout ----------
--
-- The whole checkout is ONE function call = ONE transaction:
-- insert sale + snapshot items, decrement stock, log stock_movements.
-- Any failure (including insufficient stock) rolls back everything.
--
-- p_items: jsonb array of {"product_id": uuid, "qty": number, "line_discount": piasters}
-- p_cashier_id defaults to auth.uid(); pass explicitly when testing
-- from the SQL editor (where there is no authenticated user).
--
-- Prices, names and tax rates are read from products SERVER-SIDE —
-- the client never sends prices, so it can never tamper with them.

create or replace function public.create_sale(
  p_items jsonb,
  p_payment_method public.payment_method,
  p_shift_id uuid default null,
  p_amount_tendered numeric default null,
  p_cashier_id uuid default null
)
returns table (
  sale_id uuid,
  sale_number bigint,
  subtotal numeric,
  tax_total numeric,
  discount_total numeric,
  total numeric,
  change_due numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cashier_id uuid;
  v_sale_id uuid;
  v_sale_number bigint;
  v_item record;
  v_product public.products%rowtype;
  v_line_gross numeric;   -- piasters, VAT-inclusive, after line discount
  v_line_net numeric;     -- piasters, VAT extracted
  v_lines jsonb := '[]'::jsonb; -- validated lines, written after the sale row exists
  v_line jsonb;
  v_subtotal numeric := 0;
  v_tax_total numeric := 0;
  v_discount_total numeric := 0;
  v_total numeric := 0;
  v_change numeric;
begin
  v_cashier_id := coalesce(p_cashier_id, auth.uid());
  if v_cashier_id is null then
    raise exception 'create_sale: no cashier (not authenticated and p_cashier_id is null)';
  end if;

  -- The caller must be an active profile; when called with an explicit
  -- p_cashier_id different from the session user, only admins may do so
  -- (prevents a cashier recording sales as someone else).
  if auth.uid() is not null
     and v_cashier_id <> auth.uid()
     and not public.is_admin() then
    raise exception 'create_sale: cannot record a sale for another cashier';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'create_sale: p_items must be a non-empty json array';
  end if;

  -- PASS 1 — validate every line and lock stock BEFORE inserting the sale.
  -- The sale_number sequence is only consumed once checkout is certain to
  -- succeed, so rejected checkouts (insufficient stock, bad tender, …)
  -- don't leave gaps in receipt numbers.
  for v_item in
    select
      (elem->>'product_id')::uuid  as product_id,
      (elem->>'qty')::numeric      as qty,
      coalesce((elem->>'line_discount')::numeric, 0) as line_discount
    from jsonb_array_elements(p_items) as elem
  loop
    if v_item.product_id is null or v_item.qty is null or v_item.qty <= 0 then
      raise exception 'create_sale: each item needs a product_id and a positive qty';
    end if;
    if v_item.line_discount < 0 then
      raise exception 'create_sale: line_discount cannot be negative';
    end if;

    -- Lock the product row: concurrent checkouts of the same product
    -- serialize here, so stock can never go negative.
    select * into v_product
    from public.products
    where id = v_item.product_id and active
    for update;

    if not found then
      raise exception 'create_sale: product % not found or inactive', v_item.product_id;
    end if;

    if v_product.unit = 'piece' and v_item.qty <> trunc(v_item.qty) then
      raise exception 'create_sale: product % (%) is sold per piece — qty must be a whole number',
        v_product.name_en, v_product.barcode;
    end if;

    if v_product.stock_qty < v_item.qty then
      raise exception 'create_sale: insufficient stock for % (%): have %, need %',
        v_product.name_en, v_product.barcode, v_product.stock_qty, v_item.qty
        using errcode = 'P0001';
    end if;

    -- All piaster amounts stay integers: round once per line.
    v_line_gross := round(v_product.price * v_item.qty) - v_item.line_discount;
    if v_line_gross < 0 then
      raise exception 'create_sale: discount exceeds line amount for % (%)',
        v_product.name_en, v_product.barcode;
    end if;
    -- Price is VAT-inclusive; extract the net portion.
    v_line_net := round(v_line_gross / (1 + v_product.tax_rate));

    v_lines := v_lines || jsonb_build_object(
      'product_id', v_product.id,
      'name_ar', v_product.name_ar,
      'name_en', v_product.name_en,
      'unit_price', v_product.price,
      'tax_rate', v_product.tax_rate,
      'qty', v_item.qty,
      'line_discount', v_item.line_discount,
      'line_total', v_line_gross
    );

    v_subtotal := v_subtotal + v_line_net;
    v_tax_total := v_tax_total + (v_line_gross - v_line_net);
    v_discount_total := v_discount_total + v_item.line_discount;
    v_total := v_total + v_line_gross;
  end loop;

  -- Cumulative stock check: the per-line check above misses the case of
  -- the same product appearing on several lines. Rows are already locked.
  for v_item in
    select p.name_en, p.barcode, p.stock_qty, sum((elem->>'qty')::numeric) as needed
    from jsonb_array_elements(p_items) as elem
    join public.products p on p.id = (elem->>'product_id')::uuid
    group by p.id, p.name_en, p.barcode, p.stock_qty
    having p.stock_qty < sum((elem->>'qty')::numeric)
  loop
    raise exception 'create_sale: insufficient stock for % (%): have %, need %',
      v_item.name_en, v_item.barcode, v_item.stock_qty, v_item.needed
      using errcode = 'P0001';
  end loop;

  if p_payment_method = 'cash' then
    if p_amount_tendered is null then
      raise exception 'create_sale: amount_tendered is required for cash payment';
    end if;
    if p_amount_tendered < v_total then
      raise exception 'create_sale: amount tendered (%) is less than total (%)',
        p_amount_tendered, v_total;
    end if;
    v_change := p_amount_tendered - v_total;
  end if;

  -- PASS 2 — everything validated; persist the sale, its snapshot items,
  -- the stock decrements and the movement log. Still one transaction:
  -- any failure below rolls back all of it.
  insert into public.sales
    (shift_id, cashier_id, subtotal, tax_total, discount_total, total,
     payment_method, amount_tendered, change_due)
  values
    (p_shift_id, v_cashier_id, v_subtotal, v_tax_total, v_discount_total, v_total,
     p_payment_method,
     case when p_payment_method = 'cash' then p_amount_tendered end,
     v_change)
  returning id, public.sales.sale_number into v_sale_id, v_sale_number;

  for v_line in select * from jsonb_array_elements(v_lines)
  loop
    insert into public.sale_items
      (sale_id, product_id, name_ar, name_en, unit_price, tax_rate, qty, line_discount, line_total)
    values
      (v_sale_id,
       (v_line->>'product_id')::uuid,
       v_line->>'name_ar',
       v_line->>'name_en',
       (v_line->>'unit_price')::numeric,
       (v_line->>'tax_rate')::numeric,
       (v_line->>'qty')::numeric,
       (v_line->>'line_discount')::numeric,
       (v_line->>'line_total')::numeric);

    update public.products
    set stock_qty = stock_qty - (v_line->>'qty')::numeric
    where id = (v_line->>'product_id')::uuid;

    insert into public.stock_movements (product_id, qty_change, reason, reference_id, created_by)
    values ((v_line->>'product_id')::uuid, -(v_line->>'qty')::numeric, 'sale', v_sale_id, v_cashier_id);
  end loop;

  return query
    select v_sale_id, v_sale_number, v_subtotal, v_tax_total, v_discount_total, v_total, v_change;
end;
$$;

-- Only authenticated users may call it; anon may not.
revoke execute on function public.create_sale from public, anon;
grant execute on function public.create_sale to authenticated, service_role;
