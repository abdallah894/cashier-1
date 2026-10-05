-- Customers (optional, consent-based, privacy-aware) and rule-based promotions.
--
-- PRIVACY MODEL: the customers table is readable only with the
-- customer.manage capability (admins always have it). Cashiers get two
-- narrow RPCs instead: an exact-phone lookup that returns id, first name
-- and the last four digits, and a create call. Marketing consent is opt-in,
-- every change is an immutable consent event, and erasure anonymises the
-- row (sales keep an anonymous link so accounting stays consistent).
--
-- PROMOTION RULES (explicit):
--   * evaluated server-side in ascending priority (ties by id);
--   * manual discounts apply first; promotions act on what is left;
--   * a stackable promotion compounds on the remaining line amount;
--   * a non-stackable promotion skips lines that already carry a promotion,
--     and once it applies it locks the line against later promotions;
--   * a line never goes below zero;
--   * a coupon (code) that cannot apply is an error, an automatic promotion
--     that cannot apply is silently skipped;
--   * 'fixed' on item scope is per unit, on order scope it is per order;
--   * expiry, usage limits and customer requirements are checked at sale time.
--   Gift cards, store credit and loyalty points are deliberately NOT
--   implemented: their accounting rules are not defined yet.

insert into public.audit_actions (action, target_type) values
  ('customer_consent_changed', 'customer'),
  ('customer_anonymized', 'customer'),
  ('promotion_created', 'promotion'),
  ('promotion_toggled', 'promotion'),
  ('promotion_applied', 'sale');

-- ---------- customers ----------
create or replace function public.normalize_phone(p_phone text)
returns text
language plpgsql immutable set search_path = ''
as $$
declare d text;
begin
  d := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  if d like '00%' then d := substr(d, 3); end if;
  if d like '0%' and length(d) = 11 then d := '20' || substr(d, 2); end if;
  if length(d) < 8 or length(d) > 15 then return null; end if;
  return d;
end;
$$;

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  phone text,
  email text,
  consent_marketing boolean not null default false,
  consent_updated_at timestamptz,
  created_by uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  anonymized_at timestamptz
);
create unique index customers_phone_key on public.customers (phone) where phone is not null;

create table public.customer_consent_events (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete restrict,
  consent boolean not null,
  source text not null check (length(btrim(source)) > 0),
  recorded_by uuid not null references public.profiles(id) on delete restrict,
  recorded_at timestamptz not null default now()
);
create index customer_consent_events_customer_idx on public.customer_consent_events (customer_id, recorded_at);

alter table public.customers enable row level security;
alter table public.customer_consent_events enable row level security;
create policy "customers: authorised staff read" on public.customers for select to authenticated
  using (public.has_capability('customer.manage'));
create policy "consent events: authorised staff read" on public.customer_consent_events for select to authenticated
  using (public.has_capability('customer.manage'));
-- No write policies: customers change only through the RPCs below.

create trigger customer_consent_events_immutable before update or delete on public.customer_consent_events
  for each row execute function public.reject_ledger_change();
create trigger customer_consent_events_no_truncate before truncate on public.customer_consent_events
  for each statement execute function public.reject_ledger_change();
create trigger customers_no_delete before delete on public.customers
  for each row execute function public.reject_ledger_change();

alter table public.sales add column customer_id uuid references public.customers(id) on delete restrict;
create index sales_customer_idx on public.sales (customer_id) where customer_id is not null;

create or replace function public.create_customer(
  p_name text,
  p_phone text,
  p_email text default null,
  p_marketing_consent boolean default false,
  p_consent_source text default 'register'
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := auth.uid(); v_phone text; v_id uuid;
begin
  if v_actor is null or not exists (select 1 from public.profiles where id = v_actor and active) then
    raise exception 'customer: not authenticated';
  end if;
  if p_name is null or length(btrim(p_name)) = 0 then raise exception 'customer: name is required'; end if;
  v_phone := public.normalize_phone(p_phone);
  if v_phone is null then raise exception 'customer: a valid phone number is required'; end if;
  if exists (select 1 from public.customers where phone = v_phone) then
    raise exception 'customer: phone already registered';
  end if;
  insert into public.customers (name, phone, email, consent_marketing, consent_updated_at, created_by)
  values (btrim(p_name), v_phone, nullif(btrim(coalesce(p_email, '')), ''), coalesce(p_marketing_consent, false),
          case when coalesce(p_marketing_consent, false) then now() end, v_actor)
  returning id into v_id;
  if coalesce(p_marketing_consent, false) then
    insert into public.customer_consent_events (customer_id, consent, source, recorded_by)
    values (v_id, true, coalesce(nullif(btrim(p_consent_source), ''), 'register'), v_actor);
    perform public.write_audit_event(v_actor, null, 'customer_consent_changed', 'customer', v_id,
      jsonb_build_object('event_type', 'granted'), null);
  end if;
  return v_id;
end;
$$;

-- Exact-phone lookup for the register; cannot be used to browse or search.
create or replace function public.find_customer(p_phone text)
returns table (id uuid, name text, phone_last4 text)
language plpgsql security definer set search_path = ''
as $$
declare v_phone text := public.normalize_phone(p_phone);
begin
  if auth.uid() is null then raise exception 'customer: not authenticated'; end if;
  if v_phone is null then return; end if;
  return query
    select c.id, c.name, right(c.phone, 4)
    from public.customers c
    where c.phone = v_phone and c.anonymized_at is null;
end;
$$;

create or replace function public.set_customer_consent(p_customer_id uuid, p_consent boolean, p_source text default 'register')
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null or not exists (select 1 from public.profiles where id = v_actor and active) then
    raise exception 'customer: not authenticated';
  end if;
  perform 1 from public.customers where id = p_customer_id and anonymized_at is null for update;
  if not found then raise exception 'customer: customer not found'; end if;
  update public.customers set consent_marketing = p_consent, consent_updated_at = now() where id = p_customer_id;
  insert into public.customer_consent_events (customer_id, consent, source, recorded_by)
  values (p_customer_id, p_consent, coalesce(nullif(btrim(p_source), ''), 'register'), v_actor);
  perform public.write_audit_event(v_actor, null, 'customer_consent_changed', 'customer', p_customer_id,
    jsonb_build_object('event_type', case when p_consent then 'granted' else 'withdrawn' end), null);
end;
$$;

create or replace function public.anonymize_customer(p_customer_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := auth.uid(); v_row public.customers%rowtype;
begin
  if v_actor is null or not public.has_capability('customer.manage') then
    raise exception 'customer: capability required';
  end if;
  select * into v_row from public.customers where id = p_customer_id for update;
  if not found then raise exception 'customer: customer not found'; end if;
  if v_row.anonymized_at is not null then raise exception 'customer: already anonymized'; end if;
  update public.customers
  set name = 'Anonymous customer', phone = null, email = null, consent_marketing = false,
      consent_updated_at = now(), anonymized_at = now()
  where id = p_customer_id;
  if v_row.consent_marketing then
    insert into public.customer_consent_events (customer_id, consent, source, recorded_by)
    values (p_customer_id, false, 'anonymized', v_actor);
  end if;
  perform public.write_audit_event(v_actor, null, 'customer_anonymized', 'customer', p_customer_id, '{}'::jsonb, null);
end;
$$;

create or replace function public.customer_purchase_history(p_customer_id uuid)
returns table (sale_id uuid, sale_number bigint, created_at timestamptz, total numeric, payment_method public.payment_method, item_count bigint)
language plpgsql security definer set search_path = '' stable
as $$
begin
  if auth.uid() is null or not public.has_capability('customer.manage') then
    raise exception 'customer: capability required';
  end if;
  return query
    select s.id, s.sale_number, s.created_at, s.total, s.payment_method,
           (select count(*) from public.sale_items si where si.sale_id = s.id)
    from public.sales s
    where s.customer_id = p_customer_id
    order by s.created_at desc;
end;
$$;

-- ---------- promotions ----------
create type public.promotion_scope as enum ('items', 'order');
create type public.promotion_discount_kind as enum ('percent', 'fixed');

create table public.promotions (
  id uuid primary key default gen_random_uuid(),
  name_ar text not null check (length(btrim(name_ar)) > 0),
  name_en text not null check (length(btrim(name_en)) > 0),
  code text,
  scope public.promotion_scope not null,
  discount_kind public.promotion_discount_kind not null,
  percent_bp integer check (percent_bp between 1 and 10000),
  fixed_amount numeric(12,0) check (fixed_amount > 0),
  category_id uuid references public.categories(id) on delete set null,
  min_spend numeric(12,0) not null default 0 check (min_spend >= 0),
  starts_at timestamptz,
  ends_at timestamptz,
  customer_required boolean not null default false,
  max_redemptions integer check (max_redemptions > 0),
  max_per_customer integer check (max_per_customer > 0),
  stackable boolean not null default false,
  priority integer not null default 100,
  active boolean not null default true,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  check ((discount_kind = 'percent' and percent_bp is not null and fixed_amount is null)
      or (discount_kind = 'fixed' and fixed_amount is not null and percent_bp is null)),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);
create unique index promotions_code_key on public.promotions (lower(btrim(code))) where code is not null;
create index promotions_active_idx on public.promotions (active, priority);

create table public.promotion_products (
  promotion_id uuid not null references public.promotions(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  primary key (promotion_id, product_id)
);

create table public.promotion_redemptions (
  id uuid primary key default gen_random_uuid(),
  promotion_id uuid not null references public.promotions(id) on delete restrict,
  sale_id uuid not null references public.sales(id) on delete restrict,
  customer_id uuid references public.customers(id) on delete restrict,
  code text,
  amount numeric(12,0) not null check (amount > 0),
  created_at timestamptz not null default now(),
  unique (promotion_id, sale_id)
);
create index promotion_redemptions_promotion_idx on public.promotion_redemptions (promotion_id, customer_id);

-- Snapshot of every promotion that touched a sale line: receipts and reports
-- keep reading the same even after the promotion is renamed or deactivated.
create table public.sale_item_promotions (
  id uuid primary key default gen_random_uuid(),
  sale_item_id uuid not null references public.sale_items(id) on delete restrict,
  promotion_id uuid not null references public.promotions(id) on delete restrict,
  name_ar text not null,
  name_en text not null,
  code text,
  discount numeric(12,0) not null check (discount > 0)
);
create index sale_item_promotions_item_idx on public.sale_item_promotions (sale_item_id);

alter table public.promotions enable row level security;
alter table public.promotion_products enable row level security;
alter table public.promotion_redemptions enable row level security;
alter table public.sale_item_promotions enable row level security;
create policy "promotions: admins read" on public.promotions for select to authenticated using (public.is_admin());
create policy "promotion products: admins read" on public.promotion_products for select to authenticated using (public.is_admin());
create policy "promotion redemptions: admins read" on public.promotion_redemptions for select to authenticated using (public.is_admin());
create policy "sale item promotions: readable with the sale" on public.sale_item_promotions for select to authenticated
  using (exists (select 1 from public.sale_items si where si.id = sale_item_id));

create or replace function public.guard_promotion_update()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'promotions is immutable (DELETE rejected)' using errcode = 'P0001';
  end if;
  if (to_jsonb(new) - 'active') is distinct from (to_jsonb(old) - 'active') then
    raise exception 'promotions is immutable (only active may change; create a new promotion)' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger promotions_guard before update or delete on public.promotions
  for each row execute function public.guard_promotion_update();
create trigger promotion_products_immutable before update or delete on public.promotion_products
  for each row execute function public.reject_ledger_change();
create trigger promotion_redemptions_immutable before update or delete on public.promotion_redemptions
  for each row execute function public.reject_ledger_change();
create trigger sale_item_promotions_immutable before update or delete on public.sale_item_promotions
  for each row execute function public.reject_ledger_change();
create trigger promotion_redemptions_no_truncate before truncate on public.promotion_redemptions
  for each statement execute function public.reject_ledger_change();
create trigger sale_item_promotions_no_truncate before truncate on public.sale_item_promotions
  for each statement execute function public.reject_ledger_change();

create or replace function public.create_promotion(p jsonb)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_id uuid;
  v_kind public.promotion_discount_kind;
  v_scope public.promotion_scope;
  v_starts timestamptz := nullif(p->>'starts_at', '')::timestamptz;
  v_ends timestamptz := nullif(p->>'ends_at', '')::timestamptz;
  v_code text := nullif(btrim(coalesce(p->>'code', '')), '');
  v_product text;
  v_products integer := 0;
begin
  if v_actor is null or not public.is_admin() then raise exception 'promotion: admin only'; end if;
  v_kind := (p->>'discount_kind')::public.promotion_discount_kind;
  v_scope := (p->>'scope')::public.promotion_scope;
  if v_kind = 'percent' and coalesce((p->>'percent_bp')::integer, 0) not between 1 and 10000 then
    raise exception 'promotion: a percent rate between 1 and 10000 basis points is required';
  end if;
  if v_kind = 'fixed' and coalesce((p->>'fixed_amount')::numeric, 0) <= 0 then
    raise exception 'promotion: a fixed amount is required';
  end if;
  if v_starts is not null and v_ends is not null and v_ends <= v_starts then
    raise exception 'promotion: end must be after start';
  end if;
  if v_code is not null and exists (select 1 from public.promotions where lower(btrim(code)) = lower(v_code)) then
    raise exception 'promotion: code already exists';
  end if;

  insert into public.promotions
    (name_ar, name_en, code, scope, discount_kind, percent_bp, fixed_amount, category_id, min_spend,
     starts_at, ends_at, customer_required, max_redemptions, max_per_customer, stackable, priority, created_by)
  values
    (btrim(p->>'name_ar'), btrim(p->>'name_en'), v_code, v_scope, v_kind,
     case when v_kind = 'percent' then (p->>'percent_bp')::integer end,
     case when v_kind = 'fixed' then (p->>'fixed_amount')::numeric end,
     nullif(p->>'category_id', '')::uuid, coalesce((p->>'min_spend')::numeric, 0),
     v_starts, v_ends, coalesce((p->>'customer_required')::boolean, false),
     (p->>'max_redemptions')::integer, (p->>'max_per_customer')::integer,
     coalesce((p->>'stackable')::boolean, false), coalesce((p->>'priority')::integer, 100), v_actor)
  returning id into v_id;

  if p ? 'product_ids' and jsonb_typeof(p->'product_ids') = 'array' then
    for v_product in select jsonb_array_elements_text(p->'product_ids') loop
      insert into public.promotion_products (promotion_id, product_id) values (v_id, v_product::uuid);
      v_products := v_products + 1;
    end loop;
  end if;

  perform public.write_audit_event(v_actor, null, 'promotion_created', 'promotion', v_id,
    jsonb_build_object('item_count', v_products), null);
  return v_id;
end;
$$;

create or replace function public.set_promotion_active(p_promotion_id uuid, p_active boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null or not public.is_admin() then raise exception 'promotion: admin only'; end if;
  update public.promotions set active = p_active where id = p_promotion_id;
  if not found then raise exception 'promotion: not found'; end if;
  perform public.write_audit_event(v_actor, null, 'promotion_toggled', 'promotion', p_promotion_id,
    jsonb_build_object('event_type', case when p_active then 'activated' else 'deactivated' end), null);
end;
$$;

-- Pure evaluation: given cart lines (product_id, qty, manual line_discount)
-- returns one row per (line, promotion) with the discount in piasters.
-- create_sale calls this itself, so the register preview and the sale agree.
create or replace function public.evaluate_promotions(
  p_lines jsonb,
  p_customer_id uuid,
  p_codes text[],
  p_now timestamptz default now()
)
returns table (line_idx integer, promotion_id uuid, discount numeric)
language plpgsql security definer set search_path = '' stable
as $$
#variable_conflict use_column
declare
  v_n integer := coalesce(jsonb_array_length(p_lines), 0);
  i integer;
  v_prod uuid[] := '{}';
  v_cat uuid[] := '{}';
  v_qty numeric[] := '{}';
  v_rem numeric[] := '{}';
  v_hit boolean[] := '{}';
  v_locked boolean[] := '{}';
  v_elig boolean[];
  v_share numeric[];
  v_frac numeric[];
  v_codes text[];
  v_code text;
  v_product record;
  v_promo public.promotions%rowtype;
  v_explicit boolean;
  v_used bigint;
  v_sum numeric;
  v_total numeric;
  v_given numeric;
  v_left numeric;
  v_best integer;
  v_out jsonb := '[]'::jsonb;
  v_any boolean;
begin
  for i in 0 .. v_n - 1 loop
    select pr.id, pr.category_id, pr.price into v_product
    from public.products pr where pr.id = (p_lines->i->>'product_id')::uuid and pr.active;
    if not found then raise exception 'promotion: product not found or inactive'; end if;
    v_prod[i + 1] := v_product.id;
    v_cat[i + 1] := v_product.category_id;
    v_qty[i + 1] := (p_lines->i->>'qty')::numeric;
    v_rem[i + 1] := greatest(0, round(v_product.price * v_qty[i + 1]) - coalesce((p_lines->i->>'line_discount')::numeric, 0));
    v_hit[i + 1] := false;
    v_locked[i + 1] := false;
  end loop;

  select coalesce(array_agg(lower(btrim(c))), '{}') into v_codes
  from unnest(coalesce(p_codes, '{}')) c where btrim(c) <> '';
  foreach v_code in array v_codes loop
    if not exists (
      select 1 from public.promotions
      where lower(btrim(code)) = v_code and active
        and (starts_at is null or starts_at <= p_now) and (ends_at is null or ends_at > p_now)
    ) then
      raise exception 'promotion code not valid: %', v_code;
    end if;
  end loop;

  for v_promo in
    select * from public.promotions pm
    where pm.active
      and (pm.starts_at is null or pm.starts_at <= p_now)
      and (pm.ends_at is null or pm.ends_at > p_now)
      and (pm.code is null or lower(btrim(pm.code)) = any (v_codes))
    order by pm.priority, pm.id
  loop
    v_explicit := v_promo.code is not null;

    if (v_promo.customer_required or v_promo.max_per_customer is not null) and p_customer_id is null then
      if v_explicit then raise exception 'promotion code: needs a customer'; end if;
      continue;
    end if;
    if v_promo.max_redemptions is not null then
      select count(*) into v_used from public.promotion_redemptions where promotion_id = v_promo.id;
      if v_used >= v_promo.max_redemptions then
        if v_explicit then raise exception 'promotion code: redemption limit reached'; end if;
        continue;
      end if;
    end if;
    if v_promo.max_per_customer is not null then
      select count(*) into v_used from public.promotion_redemptions
      where promotion_id = v_promo.id and customer_id = p_customer_id;
      if v_used >= v_promo.max_per_customer then
        if v_explicit then raise exception 'promotion code: redemption limit reached'; end if;
        continue;
      end if;
    end if;

    -- which lines may this promotion touch?
    v_elig := array_fill(false, array[greatest(v_n, 1)]);
    v_sum := 0;
    v_any := false;
    for i in 1 .. v_n loop
      if v_locked[i] or (not v_promo.stackable and v_hit[i]) or v_rem[i] <= 0 then continue; end if;
      if v_promo.scope = 'items' then
        if not (
          (v_promo.category_id is null and not exists (select 1 from public.promotion_products pp where pp.promotion_id = v_promo.id))
          or (v_promo.category_id is not null and v_cat[i] is not null and v_cat[i] = v_promo.category_id)
          or exists (select 1 from public.promotion_products pp where pp.promotion_id = v_promo.id and pp.product_id = v_prod[i])
        ) then continue; end if;
      end if;
      v_elig[i] := true;
      v_any := true;
      v_sum := v_sum + v_rem[i];
    end loop;
    if not v_any then
      if v_explicit then raise exception 'promotion code: no eligible items'; end if;
      continue;
    end if;
    if v_promo.min_spend > 0 and v_sum < v_promo.min_spend then
      if v_explicit then raise exception 'promotion code: minimum spend not met'; end if;
      continue;
    end if;

    v_share := array_fill(0::numeric, array[greatest(v_n, 1)]);
    if v_promo.scope = 'order' then
      v_total := case v_promo.discount_kind
        when 'percent' then round(v_sum * v_promo.percent_bp / 10000.0)
        else least(v_promo.fixed_amount, v_sum) end;
      -- exact allocation: floor shares, then hand the remainder to the largest fractions
      v_frac := array_fill(0::numeric, array[greatest(v_n, 1)]);
      v_given := 0;
      for i in 1 .. v_n loop
        if v_elig[i] then
          v_share[i] := floor(v_total * v_rem[i] / v_sum);
          v_frac[i] := (v_total * v_rem[i]) - v_share[i] * v_sum;
          v_given := v_given + v_share[i];
        end if;
      end loop;
      v_left := v_total - v_given;
      while v_left > 0 loop
        v_best := null;
        for i in 1 .. v_n loop
          if v_elig[i] and v_share[i] < v_rem[i] and (v_best is null or v_frac[i] > v_frac[v_best]) then v_best := i; end if;
        end loop;
        exit when v_best is null;
        v_share[v_best] := v_share[v_best] + 1;
        v_frac[v_best] := -1;
        v_left := v_left - 1;
      end loop;
    else
      for i in 1 .. v_n loop
        if v_elig[i] then
          v_share[i] := least(v_rem[i], case v_promo.discount_kind
            when 'percent' then round(v_rem[i] * v_promo.percent_bp / 10000.0)
            else round(v_promo.fixed_amount * v_qty[i]) end);
        end if;
      end loop;
    end if;

    for i in 1 .. v_n loop
      if v_share[i] > 0 then
        v_out := v_out || jsonb_build_object('i', i - 1, 'p', v_promo.id, 'd', v_share[i]);
        v_rem[i] := v_rem[i] - v_share[i];
        v_hit[i] := true;
        if not v_promo.stackable then v_locked[i] := true; end if;
      end if;
    end loop;
  end loop;

  return query
    select (e->>'i')::integer, (e->>'p')::uuid, (e->>'d')::numeric
    from jsonb_array_elements(v_out) e;
end;
$$;

-- ---------- create_sale: customer link + server-authoritative promotions ----------
drop function public.create_sale(jsonb, public.payment_method, uuid, numeric, uuid, uuid, uuid, timestamptz);

create or replace function public.create_sale(
  p_items jsonb,
  p_payment_method public.payment_method,
  p_shift_id uuid default null,
  p_amount_tendered numeric default null,
  p_cashier_id uuid default null,
  p_approval_id uuid default null,
  p_idempotency_key uuid default null,
  p_client_sold_at timestamptz default null,
  p_customer_id uuid default null,
  p_promotion_codes text[] default null,
  p_apply_promotions boolean default true,
  p_expected_total numeric default null
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
  v_gross_total numeric := 0;   -- piasters before any discount
  v_threshold_bp integer;
  v_needs_override boolean := false;
  v_approved_by uuid;
  v_hash text;
  v_existing public.sales%rowtype;
  v_promos jsonb := '[]'::jsonb;     -- [{i: line index, p: promotion id, d: discount}]
  v_manual_discount numeric := 0;    -- cashier discounts only: promotions are pre-authorised
  v_idx integer;
  v_promo_disc numeric;
  v_item_id uuid;
  v_promo_count integer := 0;
  v_promo_amount numeric := 0;
  v_has_limits boolean;
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

  -- Idempotency: a queued offline sale may be submitted more than once
  -- (lost response, retry, duplicate tab). Duplicates serialize on the key
  -- and replay the original result instead of creating a second sale.
  if p_idempotency_key is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));
    select * into v_existing from public.sales where idempotency_key = p_idempotency_key;
    if found then
      if v_existing.cashier_id <> v_cashier_id then
        raise exception 'create_sale: idempotency key belongs to another cashier';
      end if;
      return query
        select v_existing.id, v_existing.sale_number, v_existing.subtotal, v_existing.tax_total,
               v_existing.discount_total, v_existing.total, v_existing.change_due;
      return;
    end if;
  end if;

  if p_client_sold_at is not null
     and (p_client_sold_at > now() + interval '5 minutes' or p_client_sold_at < now() - interval '7 days') then
    raise exception 'create_sale: client sold_at is out of range';
  end if;

  if p_customer_id is not null
     and not exists (select 1 from public.customers where id = p_customer_id and anonymized_at is null) then
    raise exception 'create_sale: customer not found';
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
      'unit_cost', v_product.cost,
      'qty', v_item.qty,
      'line_discount', v_item.line_discount,
      'line_total', v_line_gross
    );

    v_subtotal := v_subtotal + v_line_net;
    v_tax_total := v_tax_total + (v_line_gross - v_line_net);
    v_discount_total := v_discount_total + v_item.line_discount;
    v_gross_total := v_gross_total + round(v_product.price * v_item.qty);
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

  v_manual_discount := v_discount_total;

  -- Promotions are evaluated here, on the locked and validated lines, so the
  -- register preview and the recorded sale use the very same function.
  if p_apply_promotions then
    select exists (select 1 from public.promotions where active and (max_redemptions is not null or max_per_customer is not null))
      into v_has_limits;
    if v_has_limits then
      perform pg_advisory_xact_lock(hashtextextended('promotion-limits', 0));
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('i', e.line_idx, 'p', e.promotion_id, 'd', e.discount)), '[]'::jsonb)
      into v_promos
      from public.evaluate_promotions(p_items, p_customer_id, p_promotion_codes) e;
  end if;
  if jsonb_array_length(v_promos) > 0 then
    v_subtotal := 0; v_tax_total := 0; v_total := 0; v_discount_total := 0;
    for v_idx in 0 .. jsonb_array_length(v_lines) - 1 loop
      v_line := v_lines -> v_idx;
      select coalesce(sum((e->>'d')::numeric), 0) into v_promo_disc
        from jsonb_array_elements(v_promos) e where (e->>'i')::integer = v_idx;
      v_line_gross := (v_line->>'line_total')::numeric - v_promo_disc;
      v_line_net := round(v_line_gross / (1 + (v_line->>'tax_rate')::numeric));
      v_lines := jsonb_set(v_lines, array[v_idx::text], v_line || jsonb_build_object(
        'line_discount', (v_line->>'line_discount')::numeric + v_promo_disc,
        'line_total', v_line_gross));
      v_subtotal := v_subtotal + v_line_net;
      v_tax_total := v_tax_total + (v_line_gross - v_line_net);
      v_total := v_total + v_line_gross;
      v_discount_total := v_discount_total + (v_line->>'line_discount')::numeric + v_promo_disc;
    end loop;
  end if;
  if p_expected_total is not null and p_expected_total <> v_total then
    raise exception 'create_sale: total changed (now %)', v_total;
  end if;

  -- Cashier discounts above the configured share of the gross need the
  -- discount.override capability or a bound one-time manager approval.
  select approval_threshold_bp into v_threshold_bp from public.discount_settings where id = true;
  v_needs_override := v_manual_discount > 0
    and v_manual_discount * 10000 > v_gross_total * coalesce(v_threshold_bp, 0);
  if v_needs_override and not public.has_capability('discount.override') then
    if p_approval_id is null then
      raise exception 'create_sale: manager approval is required for this discount';
    end if;
    v_hash := encode(extensions.digest('sale_discount|' || v_gross_total::text || '|' || v_manual_discount::text, 'sha256'), 'hex');
    v_approved_by := public.consume_manager_approval(p_approval_id, 'sale_discount', v_hash);
  end if;

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
     payment_method, amount_tendered, change_due, idempotency_key, client_sold_at, customer_id)
  values
    (p_shift_id, v_cashier_id, v_subtotal, v_tax_total, v_discount_total, v_total,
     p_payment_method,
     case when p_payment_method = 'cash' then p_amount_tendered end,
     v_change, p_idempotency_key, p_client_sold_at, p_customer_id)
  returning id, public.sales.sale_number into v_sale_id, v_sale_number;

  for v_idx in 0 .. jsonb_array_length(v_lines) - 1
  loop
    v_line := v_lines -> v_idx;
    insert into public.sale_items
      (sale_id, product_id, name_ar, name_en, unit_price, tax_rate, unit_cost, qty, line_discount, line_total)
    values
      (v_sale_id,
       (v_line->>'product_id')::uuid,
       v_line->>'name_ar',
       v_line->>'name_en',
       (v_line->>'unit_price')::numeric,
       (v_line->>'tax_rate')::numeric,
       (v_line->>'unit_cost')::numeric,
       (v_line->>'qty')::numeric,
       (v_line->>'line_discount')::numeric,
       (v_line->>'line_total')::numeric)
    returning id into v_item_id;

    insert into public.sale_item_promotions (sale_item_id, promotion_id, name_ar, name_en, code, discount)
    select v_item_id, pm.id, pm.name_ar, pm.name_en, pm.code, (e->>'d')::numeric
    from jsonb_array_elements(v_promos) e
    join public.promotions pm on pm.id = (e->>'p')::uuid
    where (e->>'i')::integer = v_idx;

    update public.products
    set stock_qty = stock_qty - (v_line->>'qty')::numeric
    where id = (v_line->>'product_id')::uuid;

    insert into public.stock_movements (product_id, qty_change, reason, reference_id, created_by)
    values ((v_line->>'product_id')::uuid, -(v_line->>'qty')::numeric, 'sale', v_sale_id, v_cashier_id);
  end loop;

  if v_needs_override then
    perform public.write_audit_event(v_cashier_id, v_approved_by, 'sale_discount_override', 'sale', v_sale_id,
      jsonb_build_object('discount_total', v_manual_discount, 'amount', v_gross_total), null);
  end if;

  if jsonb_array_length(v_promos) > 0 then
    insert into public.promotion_redemptions (promotion_id, sale_id, customer_id, code, amount)
    select pm.id, v_sale_id, p_customer_id, pm.code, sum((e->>'d')::numeric)
    from jsonb_array_elements(v_promos) e
    join public.promotions pm on pm.id = (e->>'p')::uuid
    group by pm.id, pm.code;
    select count(distinct e->>'p'), coalesce(sum((e->>'d')::numeric), 0) into v_promo_count, v_promo_amount
      from jsonb_array_elements(v_promos) e;
    perform public.write_audit_event(v_cashier_id, null, 'promotion_applied', 'sale', v_sale_id,
      jsonb_build_object('item_count', v_promo_count, 'discount_total', v_promo_amount), null);
  end if;

  return query
    select v_sale_id, v_sale_number, v_subtotal, v_tax_total, v_discount_total, v_total, v_change;
end;
$$;


create or replace function public.preview_promotions(p_lines jsonb, p_customer_id uuid, p_codes text[])
returns table (line_idx integer, promotion_id uuid, name_ar text, name_en text, code text, discount numeric)
language plpgsql security definer set search_path = '' stable
as $$
#variable_conflict use_column
begin
  if auth.uid() is null then raise exception 'promotion: not authenticated'; end if;
  return query
    select e.line_idx, e.promotion_id, pm.name_ar, pm.name_en, pm.code, e.discount
    from public.evaluate_promotions(p_lines, p_customer_id, p_codes) e
    join public.promotions pm on pm.id = e.promotion_id
    order by e.line_idx, pm.priority, pm.id;
end;
$$;

revoke execute on function public.create_sale(jsonb, public.payment_method, uuid, numeric, uuid, uuid, uuid, timestamptz, uuid, text[], boolean, numeric) from public, anon;
grant execute on function public.create_sale(jsonb, public.payment_method, uuid, numeric, uuid, uuid, uuid, timestamptz, uuid, text[], boolean, numeric) to authenticated, service_role;

revoke execute on function
  public.normalize_phone(text),
  public.create_customer(text, text, text, boolean, text),
  public.find_customer(text),
  public.set_customer_consent(uuid, boolean, text),
  public.anonymize_customer(uuid),
  public.customer_purchase_history(uuid),
  public.create_promotion(jsonb),
  public.set_promotion_active(uuid, boolean),
  public.evaluate_promotions(jsonb, uuid, text[], timestamptz),
  public.preview_promotions(jsonb, uuid, text[])
from public, anon;
grant execute on function
  public.normalize_phone(text),
  public.create_customer(text, text, text, boolean, text),
  public.find_customer(text),
  public.set_customer_consent(uuid, boolean, text),
  public.anonymize_customer(uuid),
  public.customer_purchase_history(uuid),
  public.create_promotion(jsonb),
  public.set_promotion_active(uuid, boolean),
  public.evaluate_promotions(jsonb, uuid, text[], timestamptz),
  public.preview_promotions(jsonb, uuid, text[])
to authenticated, service_role;
