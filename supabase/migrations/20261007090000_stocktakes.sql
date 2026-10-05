-- Stocktakes: auditable full and cycle counts. Entering a count never moves
-- stock; only an admin's approval does, and every adjustment is a normal
-- immutable stock movement linked back to the count.

-- ---------- Audit vocabulary becomes data-driven ----------
-- New features register their actions here instead of rewriting CHECK
-- constraints and write_audit_event every time.
create table public.audit_actions (
  action text primary key,
  target_type text not null
);
create table public.audit_metadata_keys (
  key text primary key
);
alter table public.audit_actions enable row level security;
alter table public.audit_metadata_keys enable row level security;

insert into public.audit_actions (action, target_type) values
  ('approval_created', 'approval'),
  ('stock_correction', 'product'),
  ('cash_drawer_event', 'shift'),
  ('return_created', 'return'),
  ('sale_discount_override', 'sale'),
  ('shift_close', 'shift'),
  ('cart_void', 'shift'),
  ('stocktake_approved', 'stocktake');

insert into public.audit_metadata_keys (key) values
  ('amount'), ('capability'), ('discount_total'), ('event_type'), ('expected_cash'),
  ('hash_prefix'), ('item_count'), ('payment_method'), ('reason_length'), ('refund_total'),
  ('restock'), ('shift_id'), ('signed_qty_change'), ('variance');

alter table public.audit_events drop constraint audit_events_action_check;
alter table public.audit_events drop constraint audit_events_target_type_check;
alter table public.audit_events
  add constraint audit_events_action_fkey foreign key (action) references public.audit_actions (action);

create or replace function public.write_audit_event(
  p_actor_id uuid,
  p_approved_by uuid,
  p_action text,
  p_target_type text,
  p_target_id uuid,
  p_metadata jsonb,
  p_request_id uuid default null
)
returns public.audit_events
language plpgsql security definer set search_path = ''
as $$
declare v_event public.audit_events%rowtype; v_key text;
begin
  if p_actor_id is null
     or not exists (select 1 from public.audit_actions where action = p_action and target_type = p_target_type) then
    raise exception 'audit: invalid event';
  end if;
  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'audit: metadata must be an object';
  end if;
  for v_key in select jsonb_object_keys(p_metadata) loop
    if not exists (select 1 from public.audit_metadata_keys where key = v_key) then
      raise exception 'audit: unsafe metadata key';
    end if;
  end loop;
  insert into public.audit_events
    (actor_id, approved_by, action, target_type, target_id, metadata, request_id)
  values
    (p_actor_id, p_approved_by, p_action, p_target_type, p_target_id, p_metadata, p_request_id)
  returning * into v_event;
  return v_event;
end;
$$;
revoke all on function public.write_audit_event(uuid, uuid, text, text, uuid, jsonb, uuid)
  from public, anon, authenticated;

-- ---------- Tables ----------
create type public.stocktake_scope as enum ('full', 'cycle');
create type public.stocktake_status as enum ('open', 'submitted', 'approved', 'cancelled');
create sequence public.stocktake_number_seq;

create table public.stocktakes (
  id uuid primary key default gen_random_uuid(),
  stocktake_number bigint not null unique default nextval('public.stocktake_number_seq'),
  scope public.stocktake_scope not null,
  -- snapshot, not a foreign key: categories can be renamed or removed later
  category_id uuid,
  category_name_en text,
  category_name_ar text,
  status public.stocktake_status not null default 'open',
  note text,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  submitted_by uuid references public.profiles(id) on delete restrict,
  submitted_at timestamptz,
  approved_by uuid references public.profiles(id) on delete restrict,
  approved_at timestamptz,
  cancelled_by uuid references public.profiles(id) on delete restrict,
  cancelled_at timestamptz
);
create index stocktakes_status_idx on public.stocktakes (status, created_at desc);

create table public.stocktake_items (
  stocktake_id uuid not null references public.stocktakes(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  -- snapshots: a count must read the same after products are edited
  barcode text not null,
  name_ar text not null,
  name_en text not null,
  unit public.product_unit not null,
  unit_cost numeric(12,0) not null check (unit_cost >= 0),
  expected_qty numeric(10,3) not null check (expected_qty >= 0),
  counted_qty numeric(10,3) check (counted_qty >= 0),
  reason text,
  counted_by uuid references public.profiles(id) on delete restrict,
  counted_at timestamptz,
  resolution text check (resolution in ('use_count', 'keep_current')),
  current_qty_at_approval numeric(10,3),
  applied_delta numeric(10,3),
  primary key (stocktake_id, product_id)
);
create index stocktake_items_barcode_idx on public.stocktake_items (stocktake_id, barcode);

alter table public.stocktakes enable row level security;
alter table public.stocktake_items enable row level security;
create policy "stocktakes: capability holders read"
  on public.stocktakes for select to authenticated using (public.has_capability('stock.correct'));
create policy "stocktake items: capability holders read"
  on public.stocktake_items for select to authenticated using (public.has_capability('stock.correct'));
-- No insert/update/delete policies: every write goes through the RPCs below.

-- ---------- Guards ----------
create or replace function public.guard_stocktake_update()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'stocktakes is immutable (DELETE rejected)' using errcode = 'P0001';
  end if;
  if old.status in ('approved', 'cancelled') then
    raise exception 'stocktakes is immutable once % ', old.status using errcode = 'P0001';
  end if;
  if new.status <> old.status and not (
    (old.status = 'open' and new.status in ('submitted', 'cancelled'))
    or (old.status = 'submitted' and new.status in ('open', 'approved', 'cancelled'))
  ) then
    raise exception 'stocktakes: illegal status change % -> %', old.status, new.status using errcode = 'P0001';
  end if;
  if (new.id, new.stocktake_number, new.scope, new.category_id, new.created_by, new.created_at)
     is distinct from
     (old.id, old.stocktake_number, old.scope, old.category_id, old.created_by, old.created_at) then
    raise exception 'stocktakes is immutable (identity fields)' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger stocktakes_guard before update or delete on public.stocktakes
  for each row execute function public.guard_stocktake_update();
create trigger stocktakes_no_truncate before truncate on public.stocktakes
  for each statement execute function public.reject_ledger_change();

create or replace function public.guard_stocktake_item_change()
returns trigger
language plpgsql set search_path = ''
as $$
declare v_status public.stocktake_status;
begin
  if tg_op = 'DELETE' then
    raise exception 'stocktake_items is immutable (DELETE rejected)' using errcode = 'P0001';
  end if;
  select status into v_status from public.stocktakes where id = old.stocktake_id;
  if v_status in ('approved', 'cancelled') then
    raise exception 'stocktake_items is immutable once the count is %', v_status using errcode = 'P0001';
  end if;
  if (new.stocktake_id, new.product_id, new.barcode, new.name_ar, new.name_en, new.unit, new.unit_cost, new.expected_qty)
     is distinct from
     (old.stocktake_id, old.product_id, old.barcode, old.name_ar, old.name_en, old.unit, old.unit_cost, old.expected_qty) then
    raise exception 'stocktake_items is immutable (frozen snapshot)' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger stocktake_items_guard before update or delete on public.stocktake_items
  for each row execute function public.guard_stocktake_item_change();
create trigger stocktake_items_no_truncate before truncate on public.stocktake_items
  for each statement execute function public.reject_ledger_change();

-- ---------- RPCs ----------
create or replace function public.create_stocktake(
  p_scope public.stocktake_scope,
  p_category_id uuid default null,
  p_product_ids uuid[] default null,
  p_note text default null
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_id uuid;
  v_category public.categories%rowtype;
  v_count integer;
begin
  if v_actor is null or not public.has_capability('stock.correct') then
    raise exception 'stocktake: capability required';
  end if;
  if p_scope = 'cycle' and p_category_id is null and coalesce(array_length(p_product_ids, 1), 0) = 0 then
    raise exception 'stocktake: a cycle count needs a category or a product list';
  end if;
  if p_category_id is not null then
    select * into v_category from public.categories where id = p_category_id;
    if not found then raise exception 'stocktake: category not found'; end if;
  end if;

  insert into public.stocktakes (scope, category_id, category_name_en, category_name_ar, note, created_by)
  values (p_scope, p_category_id, v_category.name_en, v_category.name_ar, nullif(btrim(p_note), ''), v_actor)
  returning id into v_id;

  -- Lock the rows being frozen so the snapshot is internally consistent.
  insert into public.stocktake_items
    (stocktake_id, product_id, barcode, name_ar, name_en, unit, unit_cost, expected_qty)
  select v_id, p.id, p.barcode, p.name_ar, p.name_en, p.unit, p.cost, p.stock_qty
  from public.products p
  where p.active
    and (p_scope = 'full'
         or (p_category_id is not null and p.category_id = p_category_id)
         or (p_product_ids is not null and p.id = any (p_product_ids)))
  order by p.id
  for share of p;

  get diagnostics v_count = row_count;
  if v_count = 0 then raise exception 'stocktake: no products in scope'; end if;
  return v_id;
end;
$$;

create or replace function public.record_stocktake_counts(p_stocktake_id uuid, p_counts jsonb)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_status public.stocktake_status;
  v_entry jsonb;
  v_item public.stocktake_items%rowtype;
  v_qty numeric;
  v_saved integer := 0;
begin
  if v_actor is null or not public.has_capability('stock.correct') then
    raise exception 'stocktake: capability required';
  end if;
  if p_counts is null or jsonb_typeof(p_counts) <> 'array' then
    raise exception 'stocktake: counts must be an array';
  end if;
  select status into v_status from public.stocktakes where id = p_stocktake_id for update;
  if not found then raise exception 'stocktake: not found'; end if;
  if v_status <> 'open' then raise exception 'stocktake: count is not open for entry'; end if;

  for v_entry in select * from jsonb_array_elements(p_counts) loop
    select * into v_item from public.stocktake_items
    where stocktake_id = p_stocktake_id and product_id = (v_entry->>'product_id')::uuid;
    if not found then raise exception 'stocktake: product is not part of this count'; end if;

    if v_entry->'counted_qty' is null or jsonb_typeof(v_entry->'counted_qty') = 'null' then
      update public.stocktake_items
      set counted_qty = null, reason = null, counted_by = null, counted_at = null
      where stocktake_id = p_stocktake_id and product_id = v_item.product_id;
    else
      v_qty := (v_entry->>'counted_qty')::numeric;
      if v_qty < 0 then raise exception 'stocktake: counted quantity cannot be negative'; end if;
      if v_qty <> round(v_qty, 3) then raise exception 'stocktake: at most three decimal places'; end if;
      if v_item.unit = 'piece' and v_qty <> trunc(v_qty) then
        raise exception 'stocktake: % is counted per piece: quantity must be a whole number', v_item.name_en;
      end if;
      update public.stocktake_items
      set counted_qty = v_qty,
          reason = nullif(btrim(coalesce(v_entry->>'reason', '')), ''),
          counted_by = v_actor,
          counted_at = now()
      where stocktake_id = p_stocktake_id and product_id = v_item.product_id;
    end if;
    v_saved := v_saved + 1;
  end loop;
  return v_saved;
end;
$$;

create or replace function public.submit_stocktake(p_stocktake_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := auth.uid(); v_status public.stocktake_status;
begin
  if v_actor is null or not public.has_capability('stock.correct') then
    raise exception 'stocktake: capability required';
  end if;
  select status into v_status from public.stocktakes where id = p_stocktake_id for update;
  if not found then raise exception 'stocktake: not found'; end if;
  if v_status <> 'open' then raise exception 'stocktake: count is not open'; end if;
  if not exists (select 1 from public.stocktake_items where stocktake_id = p_stocktake_id and counted_qty is not null) then
    raise exception 'stocktake: nothing has been counted';
  end if;
  if exists (
    select 1 from public.stocktake_items
    where stocktake_id = p_stocktake_id and counted_qty is not null
      and counted_qty <> expected_qty and reason is null
  ) then
    raise exception 'stocktake: a reason is required for every variance';
  end if;
  update public.stocktakes set status = 'submitted', submitted_by = v_actor, submitted_at = now()
  where id = p_stocktake_id;
end;
$$;

create or replace function public.reopen_stocktake(p_stocktake_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_status public.stocktake_status;
begin
  if not public.is_admin() then raise exception 'stocktake: admin only'; end if;
  select status into v_status from public.stocktakes where id = p_stocktake_id for update;
  if not found then raise exception 'stocktake: not found'; end if;
  if v_status <> 'submitted' then raise exception 'stocktake: count is not submitted'; end if;
  update public.stocktakes set status = 'open', submitted_by = null, submitted_at = null where id = p_stocktake_id;
end;
$$;

create or replace function public.cancel_stocktake(p_stocktake_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := auth.uid(); v_row public.stocktakes%rowtype;
begin
  if v_actor is null or not public.has_capability('stock.correct') then
    raise exception 'stocktake: capability required';
  end if;
  select * into v_row from public.stocktakes where id = p_stocktake_id for update;
  if not found then raise exception 'stocktake: not found'; end if;
  if v_row.status not in ('open', 'submitted') then raise exception 'stocktake: count is already %', v_row.status; end if;
  if v_row.created_by <> v_actor and not public.is_admin() then
    raise exception 'stocktake: only the creator or an admin can cancel';
  end if;
  update public.stocktakes set status = 'cancelled', cancelled_by = v_actor, cancelled_at = now()
  where id = p_stocktake_id;
end;
$$;

-- Counted lines whose live stock no longer equals the frozen expected figure:
-- something (a sale, a receipt) moved stock after the count started.
create or replace function public.stocktake_conflicts(p_stocktake_id uuid)
returns table (product_id uuid, expected_qty numeric, current_qty numeric, counted_qty numeric)
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.has_capability('stock.correct') then raise exception 'stocktake: capability required'; end if;
  return query
    select i.product_id, i.expected_qty, p.stock_qty, i.counted_qty
    from public.stocktake_items i
    join public.products p on p.id = i.product_id
    where i.stocktake_id = p_stocktake_id and i.counted_qty is not null and p.stock_qty <> i.expected_qty
    order by i.barcode;
end;
$$;

create or replace function public.approve_stocktake(p_stocktake_id uuid, p_resolutions jsonb default '{}'::jsonb)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_row public.stocktakes%rowtype;
  v_item public.stocktake_items%rowtype;
  v_current numeric;
  v_resolution text;
  v_delta numeric;
  v_adjusted integer := 0;
  v_value numeric := 0;
  v_net numeric := 0;
  v_key text;
begin
  if v_actor is null or not public.is_admin() then raise exception 'stocktake: admin only'; end if;
  select * into v_row from public.stocktakes where id = p_stocktake_id for update;
  if not found then raise exception 'stocktake: not found'; end if;
  if v_row.status <> 'submitted' then raise exception 'stocktake: count is not submitted'; end if;

  for v_key in select jsonb_object_keys(coalesce(p_resolutions, '{}'::jsonb)) loop
    if p_resolutions->>v_key not in ('use_count', 'keep_current') then
      raise exception 'stocktake: invalid resolution for %', v_key;
    end if;
  end loop;

  -- Lock every counted product first (stable order), so the conflict check
  -- and the adjustments see one consistent view of stock.
  perform 1 from public.products
  where id in (select product_id from public.stocktake_items where stocktake_id = p_stocktake_id and counted_qty is not null)
  order by id for update;

  if exists (
    select 1
    from public.stocktake_items i
    join public.products p on p.id = i.product_id
    where i.stocktake_id = p_stocktake_id and i.counted_qty is not null and p.stock_qty <> i.expected_qty
      and coalesce(p_resolutions->>(i.product_id::text), '') = ''
  ) then
    raise exception 'stocktake: unresolved conflicts: stock moved after the count started';
  end if;

  for v_item in
    select * from public.stocktake_items
    where stocktake_id = p_stocktake_id and counted_qty is not null
    order by product_id
  loop
    select stock_qty into v_current from public.products where id = v_item.product_id;
    v_resolution := null;
    if v_current <> v_item.expected_qty then
      v_resolution := p_resolutions->>(v_item.product_id::text);
      v_delta := case v_resolution when 'use_count' then v_item.counted_qty - v_current else 0 end;
    else
      v_delta := v_item.counted_qty - v_current;
    end if;

    update public.stocktake_items
    set resolution = v_resolution, current_qty_at_approval = v_current, applied_delta = v_delta
    where stocktake_id = p_stocktake_id and product_id = v_item.product_id;

    if v_delta <> 0 then
      update public.products set stock_qty = stock_qty + v_delta where id = v_item.product_id;
      insert into public.stock_movements (product_id, qty_change, reason, reference_id, note, created_by)
      values (v_item.product_id, v_delta, 'correction', p_stocktake_id,
              'stocktake #' || v_row.stocktake_number || coalesce(': ' || v_item.reason, ''), v_actor);
      v_adjusted := v_adjusted + 1;
      v_net := v_net + v_delta;
      v_value := v_value + v_delta * v_item.unit_cost;
    end if;
  end loop;

  update public.stocktakes set status = 'approved', approved_by = v_actor, approved_at = now()
  where id = p_stocktake_id;

  perform public.write_audit_event(v_actor, null, 'stocktake_approved', 'stocktake', p_stocktake_id,
    jsonb_build_object('item_count', v_adjusted, 'variance', v_net, 'amount', round(v_value)), null);
  return v_adjusted;
end;
$$;

create or replace function public.stocktake_variance_report(p_stocktake_id uuid)
returns table (
  product_id uuid, barcode text, name_ar text, name_en text, unit public.product_unit,
  expected_qty numeric, counted_qty numeric, variance_qty numeric, unit_cost numeric,
  variance_value numeric, reason text, current_qty numeric, conflict boolean
)
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.has_capability('stock.correct') then raise exception 'stocktake: capability required'; end if;
  return query
    select i.product_id, i.barcode, i.name_ar, i.name_en, i.unit, i.expected_qty, i.counted_qty,
           i.counted_qty - i.expected_qty, i.unit_cost,
           round((i.counted_qty - i.expected_qty) * i.unit_cost), i.reason,
           coalesce(i.current_qty_at_approval, p.stock_qty),
           coalesce(i.current_qty_at_approval, p.stock_qty) <> i.expected_qty
    from public.stocktake_items i
    join public.products p on p.id = i.product_id
    where i.stocktake_id = p_stocktake_id and i.counted_qty is not null
    order by i.barcode;
end;
$$;

revoke execute on function
  public.create_stocktake(public.stocktake_scope, uuid, uuid[], text),
  public.record_stocktake_counts(uuid, jsonb),
  public.submit_stocktake(uuid),
  public.reopen_stocktake(uuid),
  public.cancel_stocktake(uuid),
  public.stocktake_conflicts(uuid),
  public.approve_stocktake(uuid, jsonb),
  public.stocktake_variance_report(uuid)
from public, anon;
grant execute on function
  public.create_stocktake(public.stocktake_scope, uuid, uuid[], text),
  public.record_stocktake_counts(uuid, jsonb),
  public.submit_stocktake(uuid),
  public.reopen_stocktake(uuid),
  public.cancel_stocktake(uuid),
  public.stocktake_conflicts(uuid),
  public.approve_stocktake(uuid, jsonb),
  public.stocktake_variance_report(uuid)
to authenticated, service_role;
