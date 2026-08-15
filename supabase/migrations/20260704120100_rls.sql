-- ============================================================
-- Cachier POS — Row Level Security
--
-- Deny by default: RLS is enabled on every table, so a request
-- matches no policy = no access. anon gets nothing anywhere.
--
-- admin   → everything
-- cashier → read catalog, own shifts, own sales; checkout goes
--           through the security-definer create_sale() RPC
--
-- Receipts are immutable: NO update/delete policies exist on
-- sales / sale_items — not even for admins (returns/refunds are
-- a later phase and will be their own audited flow).
-- ============================================================

alter table public.categories       enable row level security;
alter table public.products         enable row level security;
alter table public.profiles         enable row level security;
alter table public.shifts           enable row level security;
alter table public.sales            enable row level security;
alter table public.sale_items       enable row level security;
alter table public.stock_movements  enable row level security;

-- ---------- profiles ----------

create policy "profiles: read own or admin reads all"
  on public.profiles for select
  to authenticated
  using (id = (select auth.uid()) or public.is_admin());

create policy "profiles: admin inserts"
  on public.profiles for insert
  to authenticated
  with check (public.is_admin());

create policy "profiles: admin updates"
  on public.profiles for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "profiles: admin deletes"
  on public.profiles for delete
  to authenticated
  using (public.is_admin());

-- ---------- categories (catalog: all staff read, admin writes) ----------

create policy "categories: staff read"
  on public.categories for select
  to authenticated
  using (public.current_user_role() is not null);

create policy "categories: admin writes"
  on public.categories for insert
  to authenticated
  with check (public.is_admin());

create policy "categories: admin updates"
  on public.categories for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "categories: admin deletes"
  on public.categories for delete
  to authenticated
  using (public.is_admin());

-- ---------- products ----------

create policy "products: staff read"
  on public.products for select
  to authenticated
  using (public.current_user_role() is not null);

create policy "products: admin writes"
  on public.products for insert
  to authenticated
  with check (public.is_admin());

create policy "products: admin updates"
  on public.products for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "products: admin deletes"
  on public.products for delete
  to authenticated
  using (public.is_admin());

-- ---------- shifts (cashier: own only; admin: all) ----------

create policy "shifts: read own or admin"
  on public.shifts for select
  to authenticated
  using (cashier_id = (select auth.uid()) or public.is_admin());

create policy "shifts: open own shift"
  on public.shifts for insert
  to authenticated
  with check (
    (cashier_id = (select auth.uid()) and public.current_user_role() is not null)
    or public.is_admin()
  );

create policy "shifts: close own shift or admin"
  on public.shifts for update
  to authenticated
  using (cashier_id = (select auth.uid()) or public.is_admin())
  with check (cashier_id = (select auth.uid()) or public.is_admin());

create policy "shifts: admin deletes"
  on public.shifts for delete
  to authenticated
  using (public.is_admin());

-- ---------- sales (insert via RPC or own; read own; IMMUTABLE) ----------

create policy "sales: read own or admin"
  on public.sales for select
  to authenticated
  using (cashier_id = (select auth.uid()) or public.is_admin());

create policy "sales: record own sale"
  on public.sales for insert
  to authenticated
  with check (
    (cashier_id = (select auth.uid()) and public.current_user_role() is not null)
    or public.is_admin()
  );

-- no update/delete policies: receipts never change

-- ---------- sale_items (follow the parent sale; IMMUTABLE) ----------

create policy "sale_items: read via own sale or admin"
  on public.sale_items for select
  to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.sales s
      where s.id = sale_id and s.cashier_id = (select auth.uid())
    )
  );

create policy "sale_items: insert via own sale or admin"
  on public.sale_items for insert
  to authenticated
  with check (
    public.is_admin()
    or exists (
      select 1 from public.sales s
      where s.id = sale_id and s.cashier_id = (select auth.uid())
    )
  );

-- no update/delete policies: receipts never change

-- ---------- stock_movements (admin-only; sale movements come from the RPC) ----------

create policy "stock_movements: admin reads"
  on public.stock_movements for select
  to authenticated
  using (public.is_admin());

create policy "stock_movements: admin inserts"
  on public.stock_movements for insert
  to authenticated
  with check (public.is_admin());

create policy "stock_movements: admin updates"
  on public.stock_movements for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "stock_movements: admin deletes"
  on public.stock_movements for delete
  to authenticated
  using (public.is_admin());
