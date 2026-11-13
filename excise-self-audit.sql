-- Brewpoint — Excise self-audit
-- Run once in Supabase → SQL Editor → New query → paste → Run.
-- Safe to run twice: it skips anything that already exists.
--
-- One row per month per company: what was actually declared in TSW for
-- that period, plus a snapshot of what Brewpoint calculated at the moment
-- the return was recorded. Comparing that snapshot to today's figures is
-- how the self-audit spots records edited after the return was filed.

do $$
declare
  company_id_type text;
begin
  -- Match whatever type companies.id already uses, so the foreign key
  -- (and "Delete company" cascading to these rows) always works.
  select format_type(a.atttypid, a.atttypmod)
    into company_id_type
    from pg_attribute a
   where a.attrelid = 'public.companies'::regclass
     and a.attname = 'id';

  execute format($f$
    create table if not exists public.excise_returns (
      id uuid primary key default gen_random_uuid(),
      company_id %s not null references public.companies(id) on delete cascade,
      period text not null check (period ~ '^\d{4}-\d{2}$'),
      declared_litres numeric,
      declared_lal numeric,
      declared_duty numeric,
      entry_number text,
      filed_date date,
      notes text,
      variance_explanation text,
      app_litres_at_filing numeric,
      app_lal_at_filing numeric,
      reviewed_by text,
      reviewed_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (company_id, period)
    )
  $f$, company_id_type);
end $$;

alter table public.excise_returns enable row level security;

drop policy if exists "company excise returns" on public.excise_returns;
create policy "company excise returns" on public.excise_returns
  for all
  using (company_id in (select company_id from public.profiles where id = auth.uid()))
  with check (company_id in (select company_id from public.profiles where id = auth.uid()));

-- Keep updated_at honest on every edit.
create or replace function public.excise_returns_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists excise_returns_touch on public.excise_returns;
create trigger excise_returns_touch
  before update on public.excise_returns
  for each row execute function public.excise_returns_touch();

-- ─── TSW screenshots kept as evidence ───────────────────────────────────────
alter table public.excise_returns add column if not exists screenshot_paths text[] not null default '{}';

-- Private bucket: files live under <company_id>/<YYYY-MM>/..., and only
-- people in that company can read, add or remove them.
insert into storage.buckets (id, name, public)
values ('excise-evidence', 'excise-evidence', false)
on conflict (id) do nothing;

drop policy if exists "company excise evidence read" on storage.objects;
create policy "company excise evidence read" on storage.objects
  for select using (
    bucket_id = 'excise-evidence'
    and (storage.foldername(name))[1] in (select company_id::text from public.profiles where id = auth.uid())
  );

drop policy if exists "company excise evidence write" on storage.objects;
create policy "company excise evidence write" on storage.objects
  for insert with check (
    bucket_id = 'excise-evidence'
    and (storage.foldername(name))[1] in (select company_id::text from public.profiles where id = auth.uid())
  );

drop policy if exists "company excise evidence delete" on storage.objects;
create policy "company excise evidence delete" on storage.objects
  for delete using (
    bucket_id = 'excise-evidence'
    and (storage.foldername(name))[1] in (select company_id::text from public.profiles where id = auth.uid())
  );

-- Each line read off the TSW return, for the line-by-line comparison.
alter table public.excise_returns add column if not exists declared_lines jsonb not null default '[]'::jsonb;

-- Packaged stock cleared outside of sales orders (see Finished stock → Clear stock).
alter table public.batches add column if not exists stock_cleared jsonb not null default '[]'::jsonb;

-- ─── Two-way stock with Xero (applied as migration xero_two_way_stock) ─────
-- xero_sales_item_map: which Xero item is which beer/container (+ units per Xero unit).
-- xero_stock_sales: every Xero sale line counted once, so nothing comes off twice.
-- xero_settings: sales_sync_enabled, sales_sync_from, last_sales_sync.
alter table public.batches add column if not exists xero_sold jsonb not null default '[]'::jsonb;

-- ─── New rows get the company's main site (applied as migration default_site_on_insert) ───
-- The site-based access rules (added 24 Aug) hide rows with no site, and the app
-- doesn't send one, so inserts were rejected. This fills it in on the server.
create or replace function public.fill_default_site_id()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.site_id is null and new.company_id is not null then
    select s.id into new.site_id from public.sites s
     where s.company_id = new.company_id
     order by s.is_default desc nulls last, s.created_at limit 1;
  end if;
  return new;
end $$;
do $$
declare t text;
begin
  foreach t in array array['batches','tanks','purchase_orders','inventory_items','stock_takes','food_safety_records','kegs','consumables']
  loop
    execute format('drop trigger if exists fill_default_site_id on public.%I', t);
    execute format('create trigger fill_default_site_id before insert on public.%I for each row execute function public.fill_default_site_id()', t);
  end loop;
end $$;

-- "Declared on TSW" tick per month (locks label strengths for that month).
alter table public.excise_returns add column if not exists declared_on_tsw boolean not null default false;
alter table public.excise_returns add column if not exists declared_on_tsw_at timestamptz;
alter table public.excise_returns add column if not exists declared_on_tsw_by text;

-- Alcohol levy and the GST on it, for each saved return. Worked out from
-- the declared lines (litres × levy rate for the strength class, rate in
-- force for that period), since TSW charges both on top of the duty.
alter table public.excise_returns add column if not exists declared_levy numeric;
alter table public.excise_returns add column if not exists declared_levy_gst numeric;

-- Cider page: juice intake and blend records per batch (back_sweetenings already existed).
alter table public.batches add column if not exists juice_intake jsonb not null default '[]'::jsonb;
alter table public.batches add column if not exists blend_log jsonb not null default '[]'::jsonb;
alter table public.batches alter column split_group_id type text using split_group_id::text;

-- Brew planner settings, one row per company.
create table if not exists public.brew_plan_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.brew_plan_settings enable row level security;
drop policy if exists "own company brew plan settings" on public.brew_plan_settings;
create policy "own company brew plan settings" on public.brew_plan_settings
  for all using (company_id = get_my_company_id()) with check (company_id = get_my_company_id());

-- Cider built on the day: the day's juice, rates and stock items on the batch.
alter table public.batches add column if not exists day_recipe jsonb;

-- Juice gravity on juice stock items, used by the cider plan.
alter table public.inventory_items add column if not exists juice_sg numeric;

-- Label strength per beer (product key = recipe family, or cleaned batch name).
create table if not exists public.label_strengths (
  company_id uuid not null references public.companies(id) on delete cascade,
  product_key text not null,
  abv numeric not null,
  updated_at timestamptz not null default now(),
  primary key (company_id, product_key)
);
alter table public.label_strengths enable row level security;
drop policy if exists "own company label strengths" on public.label_strengths;
create policy "own company label strengths" on public.label_strengths
  for all using (company_id = get_my_company_id()) with check (company_id = get_my_company_id());

-- Past Xero sales recorded for tracing only (don't affect stock).
alter table public.batches add column if not exists sales_history jsonb not null default '[]'::jsonb;

-- Batch names grouped into one beer for Xero matching, stock and tracing.
create table if not exists public.beer_aliases (
  company_id uuid not null references public.companies(id) on delete cascade,
  batch_name text not null,
  beer_name text not null,
  updated_at timestamptz not null default now(),
  primary key (company_id, batch_name)
);
alter table public.beer_aliases enable row level security;
drop policy if exists "own company beer aliases" on public.beer_aliases;
create policy "own company beer aliases" on public.beer_aliases
  for all using (company_id = get_my_company_id()) with check (company_id = get_my_company_id());

-- Company settings: the owner can update their own company (logo, modules,
-- excise ABV method). Before this there was no update policy, so changes
-- silently didn't save.
drop policy if exists "owner updates own company" on public.companies;
create policy "owner updates own company" on public.companies
  for update to authenticated
  using (id = get_my_company_id() and is_company_owner())
  with check (id = get_my_company_id() and is_company_owner());

-- Any team member can accept the food safety disclaimer (only those two fields).
create or replace function public.accept_food_safety_disclaimer(accepted_by text)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare ts timestamptz := now();
begin
  if get_my_company_id() is null then raise exception 'not signed in'; end if;
  update companies set food_safety_disclaimer_accepted_at = ts,
                       food_safety_disclaimer_accepted_by = accepted_by
   where id = get_my_company_id() and food_safety_disclaimer_accepted_at is null;
  return ts;
end $$;
revoke all on function public.accept_food_safety_disclaimer(text) from public, anon;
grant execute on function public.accept_food_safety_disclaimer(text) to authenticated;

-- Xero keep-alive: a weekly job refreshes every Xero connection so it never
-- hits Xero's 60-day unused limit. Edge function: supabase/functions/xero-keepalive.
create extension if not exists pg_cron;
create extension if not exists pg_net;
alter table public.xero_connections
  add column if not exists last_keepalive_at timestamptz,
  add column if not exists keepalive_failed_at timestamptz;
do $$ begin
  if not exists (select 1 from vault.secrets where name = 'xero_keepalive_secret') then
    perform vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'xero_keepalive_secret');
  end if;
end $$;
create or replace function public.get_xero_keepalive_secret()
returns text language sql security definer set search_path = public, vault as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'xero_keepalive_secret';
$$;
revoke all on function public.get_xero_keepalive_secret() from public, anon, authenticated;
grant execute on function public.get_xero_keepalive_secret() to service_role;
create or replace function public.run_xero_keepalive()
returns bigint language sql security definer set search_path = public, vault, net as $$
  select net.http_post(
    url := 'https://duefcixwiykpebfysexe.supabase.co/functions/v1/xero-keepalive',
    headers := jsonb_build_object('Content-Type','application/json','x-keepalive-secret',
      (select decrypted_secret from vault.decrypted_secrets where name = 'xero_keepalive_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000);
$$;
revoke all on function public.run_xero_keepalive() from public, anon, authenticated;
-- Mondays 3:17am NZ time (Sunday 14:17 UTC, NZDT).
select cron.schedule('xero-keepalive-weekly', '17 14 * * 0', $$select public.run_xero_keepalive()$$);
create or replace function public.xero_clear_keepalive_failure()
returns trigger language plpgsql as $$
begin
  if new.refresh_token is distinct from old.refresh_token
     and new.keepalive_failed_at is not distinct from old.keepalive_failed_at then
    new.keepalive_failed_at := null;
  end if;
  return new;
end $$;
drop trigger if exists xero_clear_keepalive_failure on public.xero_connections;
create trigger xero_clear_keepalive_failure before update on public.xero_connections
  for each row execute function public.xero_clear_keepalive_failure();

-- Costing (owner only): costed products, packaging/delivery defaults, the
-- imported costing-sheet prices, and prices set by hand.
create table if not exists public.costing_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.costing_settings enable row level security;
create policy "costing: owner reads" on public.costing_settings for select to authenticated using (company_id = get_my_company_id() and is_company_owner());
create policy "costing: owner inserts" on public.costing_settings for insert to authenticated with check (company_id = get_my_company_id() and is_company_owner());
create policy "costing: owner updates" on public.costing_settings for update to authenticated using (company_id = get_my_company_id() and is_company_owner()) with check (company_id = get_my_company_id() and is_company_owner());

-- Sales role: read-only, can't see Xero logins, purchasing or excise.
create or replace function public.is_sales_user()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'sales');
$$;
alter table public.companies add column if not exists sales_access jsonb not null default '{}'::jsonb;
do $$
declare t text;
begin
  for t in select distinct tablename from pg_policies where schemaname = 'public' and cmd = 'ALL' and tablename <> 'activity_log' loop
    execute format('drop policy if exists "sales read-only insert" on public.%I', t);
    execute format('drop policy if exists "sales read-only update" on public.%I', t);
    execute format('drop policy if exists "sales read-only delete" on public.%I', t);
    execute format('create policy "sales read-only insert" on public.%I as restrictive for insert to authenticated with check (not is_sales_user())', t);
    execute format('create policy "sales read-only update" on public.%I as restrictive for update to authenticated using (not is_sales_user())', t);
    execute format('create policy "sales read-only delete" on public.%I as restrictive for delete to authenticated using (not is_sales_user())', t);
  end loop;
  foreach t in array array['xero_connections','purchase_orders','suppliers','supplier_documents','excise_returns','excise_item_codes','company_invites','xero_settings'] loop
    execute format('drop policy if exists "sales cannot read" on public.%I', t);
    execute format('create policy "sales cannot read" on public.%I as restrictive for select to authenticated using (not is_sales_user())', t);
  end loop;
end $$;
-- Only update_teammate_role (owner) can change a role or company.
create or replace function public.profiles_protect_role()
returns trigger language plpgsql as $$
begin
  if current_user in ('authenticated', 'anon') and (new.role is distinct from old.role or new.company_id is distinct from old.company_id) then
    raise exception 'Roles are changed by the account owner in Settings → Team.';
  end if;
  return new;
end $$;
drop trigger if exists profiles_protect_role on public.profiles;
create trigger profiles_protect_role before update on public.profiles for each row execute function public.profiles_protect_role();
-- update_teammate_role now also accepts 'sales'.

-- Xero tokens owner-only; others read safe details via xero_connection_status().
create policy "xero tokens owner only (read)" on public.xero_connections as restrictive for select to authenticated using (is_company_owner());
create policy "xero tokens owner only (delete)" on public.xero_connections as restrictive for delete to authenticated using (is_company_owner());
create or replace function public.xero_connection_status()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when is_sales_user() then null else (
    select jsonb_build_object('company_id', company_id, 'tenant_name', tenant_name, 'connected_by', connected_by,
      'connected_at', connected_at, 'last_keepalive_at', last_keepalive_at, 'keepalive_failed_at', keepalive_failed_at)
    from xero_connections where company_id = get_my_company_id()) end;
$$;
revoke all on function public.xero_connection_status() from public, anon;
grant execute on function public.xero_connection_status() to authenticated;

-- Package types can be set per pack (e.g. 24 cans in a case).
alter table public.package_types add column if not exists units_per_pack integer not null default 1;

-- One-off Xero catch-up the app runs by itself when set.
alter table public.xero_settings add column if not exists catch_up_requested boolean not null default false;

-- Orders brought in from Xero invoices (history + ongoing). Never touch stock.
alter table sales_orders add column if not exists source text, add column if not exists xero_doc_id text;
create unique index if not exists sales_orders_company_xero_doc on sales_orders (company_id, xero_doc_id);
alter table sales_orders add constraint sales_orders_company_xero_doc_key unique using index sales_orders_company_xero_doc;

-- Server-side Xero sales check (edge function xero-sync), every 2 minutes,
-- plus the xero-webhook function for instant updates.
alter table xero_settings add column if not exists sync_lock_until timestamptz;
-- try_xero_sync_lock / release_xero_sync_lock / run_xero_sync / get_xero_webhook_key: see migration xero_server_sync
-- select cron.schedule('xero-sync-every-2-min', '*/2 * * * *', 'select public.run_xero_sync()');

-- Team invites carry the email and role (member or sales); see migration invite_with_email_and_role.
alter table company_invites add column if not exists email text, add column if not exists role text not null default 'member';

-- Pack sizes for ordering (e.g. 25kg bags); see migration inventory_pack_sizes.
alter table inventory_items add column if not exists pack_size numeric, add column if not exists pack_label text, add column if not exists supplier_product text;
alter table suppliers add column if not exists order_url text;
