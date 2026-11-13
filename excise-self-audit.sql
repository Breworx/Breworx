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

-- Team: last active + joined, pending invites, a log line when someone joins; see migration team_last_seen_and_invites.
alter table profiles add column if not exists last_seen_at timestamptz, add column if not exists joined_at timestamptz default now();
insert into purchase_orders (id,user_id,po_number,supplier,order_date,received_date,status,lines,company_id,delivery_cost,site_id) select r->>'id','38d75e2b-9faf-4027-b9d1-a061cfaa28a7',r->>'po_number','Gladfield Malt',(r->>'order_date')::date,(r->>'received_date')::date,'Received',r->'lines','ef7b9cc5-8123-47aa-80e4-3d205d302221',(r->>'delivery_cost')::numeric,'4f3f07fd-e883-47b4-b5af-2f9ce4f1314a' from jsonb_array_elements($j$[{"id":"gf44620","po_number":"GF SO-44620","order_date":"2026-06-11","received_date":"2026-06-12","lines":[{"id":"aieid09","qty":100.0,"name":"Gladfield Pilsner Malt","unit":"kg","category":"Grain","costPerUnit":1.692},{"id":"bl1qxtw","qty":150.0,"name":"American Ale Malt","unit":"kg","category":"Grain","costPerUnit":1.764}],"delivery_cost":67.0},{"id":"gf44286","po_number":"GF SO-44286","order_date":"2026-05-08","received_date":"2026-05-11","lines":[{"id":"gf-zetolite-63","qty":1.0,"name":"Zetolite 63 1kg Bag","unit":"ea","category":"Other","costPerUnit":124.0}],"delivery_cost":24.0},{"id":"gf44216","po_number":"GF SO-44216","order_date":"2026-05-05","received_date":"2026-05-06","lines":[{"id":"gf-koppakleer-tablets","qty":2.0,"name":"Koppakleer Tablets 1kg","unit":"ea","category":"Other","costPerUnit":83.0}],"delivery_cost":24.0},{"id":"gf44206","po_number":"GF SO-44206","order_date":"2026-05-04","received_date":"2026-05-05","lines":[{"id":"gf-refoam","qty":1.0,"name":"Refoam 1kg Bottle","unit":"ea","category":"Other","costPerUnit":26.0}],"delivery_cost":25.0},{"id":"gf44203","po_number":"GF SO-44203","order_date":"2026-05-04","received_date":"2026-05-05","lines":[{"id":"cpbuwzt","qty":500.0,"name":"Yeast Voss 500g","unit":"g","category":"Yeast","costPerUnit":0.453},{"id":"3wqlwqx","qty":500.0,"name":"Yeast Diamond 500g","unit":"g","category":"Yeast","costPerUnit":0.472}],"delivery_cost":0.0},{"id":"gf44190","po_number":"GF SO-44190","order_date":"2026-05-04","received_date":"2026-05-05","lines":[{"id":"3wqlwqx","qty":1000.0,"name":"Yeast Diamond 500g","unit":"g","category":"Yeast","costPerUnit":0.472},{"id":"cpbuwzt","qty":1000.0,"name":"Yeast Voss 500g","unit":"g","category":"Yeast","costPerUnit":0.453}],"delivery_cost":25.0},{"id":"gf42379","po_number":"GF SO-42379","order_date":"2026-01-12","received_date":"2026-01-13","lines":[{"id":"aieid09","qty":100.0,"name":"Gladfield Pilsner Malt","unit":"kg","category":"Grain","costPerUnit":1.692},{"id":"7i1xcht","qty":5.0,"name":"Super F","unit":"kg","category":"Other","costPerUnit":21.0},{"id":"8c4n3ao","qty":25.0,"name":"Munich Malt","unit":"kg","category":"Grain","costPerUnit":1.952}],"delivery_cost":60.0},{"id":"gf41786","po_number":"GF SO-41786","order_date":"2025-12-01","received_date":"2025-12-02","lines":[{"id":"7i1xcht","qty":5.0,"name":"Super F","unit":"kg","category":"Other","costPerUnit":21.0}],"delivery_cost":0},{"id":"gf41781","po_number":"GF SO-41781","order_date":"2025-12-01","received_date":"2025-12-02","lines":[{"id":"cpbuwzt","qty":1000.0,"name":"Yeast Voss 500g","unit":"g","category":"Yeast","costPerUnit":0.402},{"id":"3wqlwqx","qty":1000.0,"name":"Yeast Diamond 500g","unit":"g","category":"Yeast","costPerUnit":0.418},{"id":"42g45se","qty":50.0,"name":"Gladfield Wheat Malt","unit":"kg","category":"Grain","costPerUnit":2.1},{"id":"ttobcqk","qty":25.0,"name":"Gladfield Dark Crystal Malt","unit":"kg","category":"Grain","costPerUnit":2.452},{"id":"bl1qxtw","qty":150.0,"name":"American Ale Malt","unit":"kg","category":"Grain","costPerUnit":1.764}],"delivery_cost":60.0},{"id":"gf41137","po_number":"GF SO-41137","order_date":"2025-10-30","received_date":"2025-10-31","lines":[{"id":"3wqlwqx","qty":500.0,"name":"Yeast Diamond 500g","unit":"g","category":"Yeast","costPerUnit":0.418}],"delivery_cost":24.0},{"id":"gf40801","po_number":"GF SO-40801","order_date":"2025-10-09","received_date":"2025-10-10","lines":[{"id":"yvvxtnl","qty":20.0,"name":"Rolled Oats","unit":"kg","category":"Grain","costPerUnit":2.75},{"id":"ttobcqk","qty":25.0,"name":"Gladfield Dark Crystal Malt","unit":"kg","category":"Grain","costPerUnit":2.452},{"id":"lbxty99","qty":1.0,"name":"Gypsum (CaSO4)","unit":"kg","category":"Other","costPerUnit":5.5},{"id":"gf-alginex","qty":1.0,"name":"Alginex 1kg Bottle","unit":"ea","category":"Other","costPerUnit":150.0},{"id":"7i1xcht","qty":5.0,"name":"Super F","unit":"kg","category":"Other","costPerUnit":21.0},{"id":"42g45se","qty":50.0,"name":"Gladfield Wheat Malt","unit":"kg","category":"Grain","costPerUnit":2.1},{"id":"aieid09","qty":150.0,"name":"Gladfield Pilsner Malt","unit":"kg","category":"Grain","costPerUnit":1.692},{"id":"bl1qxtw","qty":150.0,"name":"American Ale Malt","unit":"kg","category":"Grain","costPerUnit":1.764}],"delivery_cost":91.01},{"id":"gf40096","po_number":"GF SO-40096","order_date":"2025-09-03","received_date":"2025-09-04","lines":[{"id":"2jt4poi","qty":1.0,"name":"Epsom Salt (MgSO4)","unit":"kg","category":"Other","costPerUnit":5.0},{"id":"wlp7gyc","qty":1.0,"name":"ALDC","unit":"kg","category":"Other","costPerUnit":300.0},{"id":"gf-ale-malt","qty":1.0,"name":"Ale Malt 25kg Bag","unit":"ea","category":"Other","costPerUnit":44.1},{"id":"yvvxtnl","qty":40.0,"name":"Rolled Oats","unit":"kg","category":"Grain","costPerUnit":2.75},{"id":"bl1qxtw","qty":150.0,"name":"American Ale Malt","unit":"kg","category":"Grain","costPerUnit":1.764},{"id":"42g45se","qty":50.0,"name":"Gladfield Wheat Malt","unit":"kg","category":"Grain","costPerUnit":2.1},{"id":"8c4n3ao","qty":50.0,"name":"Munich Malt","unit":"kg","category":"Grain","costPerUnit":1.952},{"id":"aieid09","qty":150.0,"name":"Gladfield Pilsner Malt","unit":"kg","category":"Grain","costPerUnit":1.692},{"id":"68990lt","qty":25.0,"name":"Gladfield Light Crystal Malt","unit":"kg","category":"Grain","costPerUnit":2.452},{"id":"atpczlt","qty":1.0,"name":"Calcium Chloride (CaCl2)","unit":"kg","category":"Other","costPerUnit":5.0}],"delivery_cost":111.0},{"id":"gf39745","po_number":"GF SO-39745","order_date":"2025-08-20","received_date":"2025-08-21","lines":[{"id":"an4wzue","qty":25.0,"name":"Gladfield Malted Maize","unit":"kg","category":"Grain","costPerUnit":2.924},{"id":"gf-organic-malt","qty":1.0,"name":"Organic Malt 25kg Bag","unit":"ea","category":"Other","costPerUnit":68.8},{"id":"bl1qxtw","qty":75.0,"name":"American Ale Malt","unit":"kg","category":"Grain","costPerUnit":1.764},{"id":"42g45se","qty":25.0,"name":"Gladfield Wheat Malt","unit":"kg","category":"Grain","costPerUnit":2.1},{"id":"7i1xcht","qty":5.0,"name":"Super F","unit":"kg","category":"Other","costPerUnit":21.0},{"id":"aieid09","qty":75.0,"name":"Gladfield Pilsner Malt","unit":"kg","category":"Grain","costPerUnit":1.692}],"delivery_cost":60.0},{"id":"gf39141","po_number":"GF SO-39141","order_date":"2025-07-07","received_date":"2025-07-08","lines":[{"id":"8c4n3ao","qty":25.0,"name":"Munich Malt","unit":"kg","category":"Grain","costPerUnit":1.952},{"id":"yvvxtnl","qty":20.0,"name":"Rolled Oats","unit":"kg","category":"Grain","costPerUnit":2.75},{"id":"gf-koppakleer-tablets","qty":1.0,"name":"Koppakleer Tablets 1kg","unit":"ea","category":"Other","costPerUnit":80.0},{"id":"42g45se","qty":25.0,"name":"Gladfield Wheat Malt","unit":"kg","category":"Grain","costPerUnit":2.1},{"id":"aieid09","qty":75.0,"name":"Gladfield Pilsner Malt","unit":"kg","category":"Grain","costPerUnit":1.692},{"id":"bl1qxtw","qty":75.0,"name":"American Ale Malt","unit":"kg","category":"Grain","costPerUnit":1.764},{"id":"an4wzue","qty":25.0,"name":"Gladfield Malted Maize","unit":"kg","category":"Grain","costPerUnit":2.924}],"delivery_cost":60.0},{"id":"gf38331","po_number":"GF SO-38331","order_date":"2025-05-29","received_date":"2025-05-30","lines":[{"id":"bl1qxtw","qty":50.0,"name":"American Ale Malt","unit":"kg","category":"Grain","costPerUnit":1.764},{"id":"gf-german-pilsner-malt","qty":2.0,"name":"German Pilsner Malt 25kg Bag","unit":"ea","category":"Other","costPerUnit":44.1},{"id":"42g45se","qty":25.0,"name":"Gladfield Wheat Malt","unit":"kg","category":"Grain","costPerUnit":2.1}],"delivery_cost":60.0},{"id":"gf37802","po_number":"GF SO-37802","order_date":"2025-05-13","received_date":"2025-05-14","lines":[{"id":"7i1xcht","qty":5.0,"name":"Super F","unit":"kg","category":"Other","costPerUnit":21.0}],"delivery_cost":24.0},{"id":"gf36078","po_number":"GF SO-36078","order_date":"2025-01-20","received_date":"2025-01-21","lines":[{"id":"bl1qxtw","qty":250.0,"name":"American Ale Malt","unit":"kg","category":"Grain","costPerUnit":1.764},{"id":"aieid09","qty":150.0,"name":"Gladfield Pilsner Malt","unit":"kg","category":"Grain","costPerUnit":1.692},{"id":"yvvxtnl","qty":40.0,"name":"Rolled Oats","unit":"kg","category":"Grain","costPerUnit":2.75},{"id":"42g45se","qty":50.0,"name":"Gladfield Wheat Malt","unit":"kg","category":"Grain","costPerUnit":2.1},{"id":"qz08q2m","qty":5.0,"name":"Lactic Acid 80%","unit":"kg","category":"Other","costPerUnit":20.0}],"delivery_cost":108.0},{"id":"gf35658","po_number":"GF SO-35658","order_date":"2024-12-18","received_date":"2024-12-19","lines":[{"id":"yvvxtnl","qty":20.0,"name":"Rolled Oats","unit":"kg","category":"Grain","costPerUnit":2.75},{"id":"7i1xcht","qty":5.0,"name":"Super F","unit":"kg","category":"Other","costPerUnit":21.0},{"id":"gf-antifoam","qty":1.0,"name":"Antifoam 1kg Bottle","unit":"ea","category":"Other","costPerUnit":25.0},{"id":"bl1qxtw","qty":125.0,"name":"American Ale Malt","unit":"kg","category":"Grain","costPerUnit":1.764},{"id":"atpczlt","qty":1.0,"name":"Calcium Chloride (CaCl2)","unit":"kg","category":"Other","costPerUnit":5.0}],"delivery_cost":116.0},{"id":"gf35602","po_number":"GF SO-35602","order_date":"2024-12-16","received_date":"2024-12-17","lines":[{"id":"wlp7gyc","qty":1.0,"name":"ALDC","unit":"kg","category":"Other","costPerUnit":300.0}],"delivery_cost":24.0},{"id":"gf35266","po_number":"GF SO-35266","order_date":"2024-12-02","received_date":"2024-12-03","lines":[{"id":"bl1qxtw","qty":25.0,"name":"American Ale Malt","unit":"kg","category":"Grain","costPerUnit":1.764},{"id":"gf-big-o-malt","qty":1.0,"name":"Big O Malt 25kg Bag","unit":"ea","category":"Other","costPerUnit":73.1},{"id":"gf-ale-malt","qty":1.0,"name":"Ale Malt 25kg Bag","unit":"ea","category":"Other","costPerUnit":44.1}],"delivery_cost":0.0},{"id":"gf35240","po_number":"GF SO-35240","order_date":"2024-12-02","received_date":"2024-12-03","lines":[{"id":"c4fd204","qty":0.25,"name":"Yeast Wildbrew Sour Pitch 250g","unit":"kg","category":"Yeast","costPerUnit":1008.0}],"delivery_cost":24.0},{"id":"gf35227","po_number":"GF SO-35227","order_date":"2024-12-02","received_date":"2024-12-03","lines":[{"id":"8c4n3ao","qty":25.0,"name":"Munich Malt","unit":"kg","category":"Grain","costPerUnit":1.952},{"id":"7i1xcht","qty":5.0,"name":"Super F","unit":"kg","category":"Other","costPerUnit":21.0},{"id":"yvvxtnl","qty":20.0,"name":"Rolled Oats","unit":"kg","category":"Grain","costPerUnit":2.75},{"id":"an4wzue","qty":25.0,"name":"Gladfield Malted Maize","unit":"kg","category":"Grain","costPerUnit":2.924},{"id":"42g45se","qty":100.0,"name":"Gladfield Wheat Malt","unit":"kg","category":"Grain","costPerUnit":2.1},{"id":"aieid09","qty":200.0,"name":"Gladfield Pilsner Malt","unit":"kg","category":"Grain","costPerUnit":1.692},{"id":"bl1qxtw","qty":200.0,"name":"American Ale Malt","unit":"kg","category":"Grain","costPerUnit":1.764}],"delivery_cost":331.0},{"id":"gf34385","po_number":"GF SO-34385","order_date":"2024-10-22","received_date":"2024-10-23","lines":[{"id":"aieid09","qty":100.0,"name":"Gladfield Pilsner Malt","unit":"kg","category":"Grain","costPerUnit":1.692},{"id":"42g45se","qty":25.0,"name":"Gladfield Wheat Malt","unit":"kg","category":"Grain","costPerUnit":2.1},{"id":"bl1qxtw","qty":100.0,"name":"American Ale Malt","unit":"kg","category":"Grain","costPerUnit":1.764}],"delivery_cost":143.0},{"id":"gf34190","po_number":"GF SO-34190","order_date":"2024-10-14","received_date":"2024-10-15","lines":[{"id":"3wqlwqx","qty":500.0,"name":"Yeast Diamond 500g","unit":"g","category":"Yeast","costPerUnit":0.418},{"id":"cpbuwzt","qty":500.0,"name":"Yeast Voss 500g","unit":"g","category":"Yeast","costPerUnit":0.402}],"delivery_cost":24.0},{"id":"gf34056","po_number":"GF SO-34056","order_date":"2024-10-08","received_date":"2024-10-09","lines":[{"id":"aieid09","qty":50.0,"name":"Gladfield Pilsner Malt","unit":"kg","category":"Grain","costPerUnit":1.692},{"id":"8c4n3ao","qty":25.0,"name":"Munich Malt","unit":"kg","category":"Grain","costPerUnit":1.952},{"id":"bl1qxtw","qty":75.0,"name":"American Ale Malt","unit":"kg","category":"Grain","costPerUnit":1.764}],"delivery_cost":0},{"id":"gf33051","po_number":"GF SO-33051","order_date":"2024-09-18","received_date":"2024-09-19","lines":[{"id":"cpbuwzt","qty":500.0,"name":"Yeast Voss 500g","unit":"g","category":"Yeast","costPerUnit":0.402}],"delivery_cost":19.0},{"id":"gf31984","po_number":"GF SO-31984","order_date":"2024-06-18","received_date":"2024-06-19","lines":[{"id":"an4wzue","qty":50.0,"name":"Gladfield Malted Maize","unit":"kg","category":"Grain","costPerUnit":2.924}],"delivery_cost":0.0},{"id":"gf31976","po_number":"GF SO-31976","order_date":"2024-06-18","received_date":"2024-06-19","lines":[{"id":"68990lt","qty":25.0,"name":"Gladfield Light Crystal Malt","unit":"kg","category":"Grain","costPerUnit":2.452},{"id":"gf-gladiator-malt","qty":2.0,"name":"Gladiator Malt 25kg Bag","unit":"ea","category":"Other","costPerUnit":61.3},{"id":"oumcvrv","qty":25.0,"name":"Gladfield Eclipse Wheat","unit":"kg","category":"Grain","costPerUnit":2.452},{"id":"j208hgu","qty":25.0,"name":"Dark Chocolate Malt","unit":"kg","category":"Grain","costPerUnit":2.452},{"id":"yvvxtnl","qty":40.0,"name":"Rolled Oats","unit":"kg","category":"Grain","costPerUnit":2.75},{"id":"0dv71z8","qty":25.0,"name":"Red Back Malt","unit":"kg","category":"Grain","costPerUnit":2.452},{"id":"ui1rxz1","qty":5.0,"name":"Gladfield Roast Barley","unit":"kg","category":"Grain","costPerUnit":5.2},{"id":"bl1qxtw","qty":250.0,"name":"American Ale Malt","unit":"kg","category":"Grain","costPerUnit":1.764},{"id":"wr9dqql","qty":50.0,"name":"Aurora Malt","unit":"kg","category":"Grain","costPerUnit":2.452},{"id":"x7y53nf","qty":25.0,"name":"Gladfield Medium Crystal Malt","unit":"kg","category":"Grain","costPerUnit":2.452},{"id":"it1c0w7","qty":25.0,"name":"Gladfield Light Chocolate Malt","unit":"kg","category":"Grain","costPerUnit":2.452},{"id":"aieid09","qty":150.0,"name":"Gladfield Pilsner Malt","unit":"kg","category":"Grain","costPerUnit":1.692},{"id":"7ilv26u","qty":25.0,"name":"Gladfield Shepherds Delight Malt","unit":"kg","category":"Grain","costPerUnit":2.516},{"id":"lxv6sjj","qty":1.0,"name":"amyloglucosidase","unit":"kg","category":"Other","costPerUnit":60.0},{"id":"ttobcqk","qty":25.0,"name":"Gladfield Dark Crystal Malt","unit":"kg","category":"Grain","costPerUnit":2.452},{"id":"7i1xcht","qty":10.0,"name":"Super F","unit":"kg","category":"Other","costPerUnit":21.0},{"id":"cpbuwzt","qty":1000.0,"name":"Yeast Voss 500g","unit":"g","category":"Yeast","costPerUnit":0.402},{"id":"42g45se","qty":100.0,"name":"Gladfield Wheat Malt","unit":"kg","category":"Grain","costPerUnit":2.1},{"id":"3wqlwqx","qty":1000.0,"name":"Yeast Diamond 500g","unit":"g","category":"Yeast","costPerUnit":0.418}],"delivery_cost":202.03},{"id":"gf31323","po_number":"GF SO-31323","order_date":"2024-05-09","received_date":"2024-05-10","lines":[{"id":"it1c0w7","qty":5.0,"name":"Gladfield Light Chocolate Malt","unit":"kg","category":"Grain","costPerUnit":5.2},{"id":"x7y53nf","qty":5.0,"name":"Gladfield Medium Crystal Malt","unit":"kg","category":"Grain","costPerUnit":5.2},{"id":"68990lt","qty":5.0,"name":"Gladfield Light Crystal Malt","unit":"kg","category":"Grain","costPerUnit":5.2},{"id":"j208hgu","qty":5.0,"name":"Dark Chocolate Malt","unit":"kg","category":"Grain","costPerUnit":5.2},{"id":"13a1bfd","qty":1.0,"name":"Yeast Vit 1kg Bag","unit":"kg","category":"Other","costPerUnit":23.0}],"delivery_cost":34.0},{"id":"gf31247","po_number":"GF SO-31247","order_date":"2024-05-07","received_date":"2024-05-08","lines":[{"id":"3wqlwqx","qty":1000.0,"name":"Yeast Diamond 500g","unit":"g","category":"Yeast","costPerUnit":0.418},{"id":"gf-yeast-lona","qty":1.0,"name":"Yeast LONA 500g","unit":"ea","category":"Other","costPerUnit":240.0},{"id":"cpbuwzt","qty":1000.0,"name":"Yeast Voss 500g","unit":"g","category":"Yeast","costPerUnit":0.402}],"delivery_cost":19.0},{"id":"gf30951","po_number":"GF SO-30951","order_date":"2024-04-22","received_date":"2024-04-23","lines":[{"id":"3wqlwqx","qty":500.0,"name":"Yeast Diamond 500g","unit":"g","category":"Yeast","costPerUnit":0.418},{"id":"42g45se","qty":50.0,"name":"Gladfield Wheat Malt","unit":"kg","category":"Grain","costPerUnit":2.1},{"id":"cpbuwzt","qty":500.0,"name":"Yeast Voss 500g","unit":"g","category":"Yeast","costPerUnit":0.402},{"id":"aieid09","qty":150.0,"name":"Gladfield Pilsner Malt","unit":"kg","category":"Grain","costPerUnit":1.692},{"id":"7i1xcht","qty":5.0,"name":"Super F","unit":"kg","category":"Other","costPerUnit":21.0},{"id":"gf-koppakleer-tablets","qty":1.0,"name":"Koppakleer Tablets 1kg","unit":"ea","category":"Other","costPerUnit":80.0},{"id":"bl1qxtw","qty":150.0,"name":"American Ale Malt","unit":"kg","category":"Grain","costPerUnit":1.764}],"delivery_cost":202.0},{"id":"gf30461","po_number":"GF SO-30461","order_date":"2024-03-28","received_date":"2024-04-02","lines":[{"id":"3wqlwqx","qty":500.0,"name":"Yeast Diamond 500g","unit":"g","category":"Yeast","costPerUnit":0.418},{"id":"cpbuwzt","qty":500.0,"name":"Yeast Voss 500g","unit":"g","category":"Yeast","costPerUnit":0.402}],"delivery_cost":24.0},{"id":"gf29713","po_number":"GF SO-29713","order_date":"2024-02-20","received_date":"2024-02-21","lines":[{"id":"cpbuwzt","qty":330.0,"name":"Yeast Voss 500g","unit":"g","category":"Yeast","costPerUnit":0.6364},{"id":"qz08q2m","qty":5.0,"name":"Lactic Acid 80%","unit":"kg","category":"Other","costPerUnit":20.0},{"id":"42g45se","qty":50.0,"name":"Gladfield Wheat Malt","unit":"kg","category":"Grain","costPerUnit":2.1},{"id":"yvvxtnl","qty":40.0,"name":"Rolled Oats","unit":"kg","category":"Grain","costPerUnit":2.75},{"id":"7i1xcht","qty":5.0,"name":"Super F","unit":"kg","category":"Other","costPerUnit":21.0},{"id":"bl1qxtw","qty":200.0,"name":"American Ale Malt","unit":"kg","category":"Grain","costPerUnit":1.764}],"delivery_cost":69.99},{"id":"gf28826","po_number":"GF SO-28826","order_date":"2024-01-08","received_date":"2024-01-09","lines":[{"id":"0dv71z8","qty":5.0,"name":"Red Back Malt","unit":"kg","category":"Grain","costPerUnit":5.2},{"id":"wr9dqql","qty":5.0,"name":"Aurora Malt","unit":"kg","category":"Grain","costPerUnit":5.2},{"id":"gf-gladiator-malt","qty":1.0,"name":"Gladiator Malt 5kg Bag","unit":"ea","category":"Other","costPerUnit":26.0},{"id":"7ilv26u","qty":5.0,"name":"Gladfield Shepherds Delight Malt","unit":"kg","category":"Grain","costPerUnit":5.2},{"id":"bl1qxtw","qty":50.0,"name":"American Ale Malt","unit":"kg","category":"Grain","costPerUnit":1.764},{"id":"8c4n3ao","qty":25.0,"name":"Munich Malt","unit":"kg","category":"Grain","costPerUnit":1.952},{"id":"68990lt","qty":5.0,"name":"Gladfield Light Crystal Malt","unit":"kg","category":"Grain","costPerUnit":5.2}],"delivery_cost":75.0},{"id":"gf28755","po_number":"GF SO-28755","order_date":"2024-01-08","received_date":"2024-01-09","lines":[{"id":"oumcvrv","qty":5.0,"name":"Gladfield Eclipse Wheat","unit":"kg","category":"Grain","costPerUnit":5.2},{"id":"it1c0w7","qty":5.0,"name":"Gladfield Light Chocolate Malt","unit":"kg","category":"Grain","costPerUnit":5.2},{"id":"bl1qxtw","qty":150.0,"name":"American Ale Malt","unit":"kg","category":"Grain","costPerUnit":1.764},{"id":"ttobcqk","qty":5.0,"name":"Gladfield Dark Crystal Malt","unit":"kg","category":"Grain","costPerUnit":5.2},{"id":"yvvxtnl","qty":20.0,"name":"Rolled Oats","unit":"kg","category":"Grain","costPerUnit":2.75},{"id":"gf-ale-malt","qty":2.0,"name":"Ale Malt 25kg Bag","unit":"ea","category":"Other","costPerUnit":44.1},{"id":"cpbuwzt","qty":1000.0,"name":"Yeast Voss 500g","unit":"g","category":"Yeast","costPerUnit":0.402},{"id":"j208hgu","qty":5.0,"name":"Dark Chocolate Malt","unit":"kg","category":"Grain","costPerUnit":5.2},{"id":"ui1rxz1","qty":5.0,"name":"Gladfield Roast Barley","unit":"kg","category":"Grain","costPerUnit":5.2},{"id":"x7y53nf","qty":5.0,"name":"Gladfield Medium Crystal Malt","unit":"kg","category":"Grain","costPerUnit":5.2},{"id":"42g45se","qty":25.0,"name":"Gladfield Wheat Malt","unit":"kg","category":"Grain","costPerUnit":2.1}],"delivery_cost":60.0},{"id":"gf28364","po_number":"GF SO-28364","order_date":"2023-12-06","received_date":"2023-12-07","lines":[{"id":"gf-ale-malt","qty":1.0,"name":"Ale Malt 25kg Bag","unit":"ea","category":"Other","costPerUnit":44.1}],"delivery_cost":51.0},{"id":"gf27714","po_number":"GF SO-27714","order_date":"2023-11-07","received_date":"2023-11-08","lines":[{"id":"gf-ale-malt","qty":1.0,"name":"Ale Malt 25kg Bag","unit":"ea","category":"Other","costPerUnit":44.1},{"id":"cpbuwzt","qty":544.0,"name":"Yeast Voss 500g","unit":"g","category":"Yeast","costPerUnit":0.4412},{"id":"bl1qxtw","qty":50.0,"name":"American Ale Malt","unit":"kg","category":"Grain","costPerUnit":1.764},{"id":"7i1xcht","qty":1.0,"name":"Super F","unit":"kg","category":"Other","costPerUnit":25.0}],"delivery_cost":172.99},{"id":"gf27552","po_number":"GF SO-27552","order_date":"2023-10-31","received_date":"2023-11-01","lines":[{"id":"cpbuwzt","qty":500.0,"name":"Yeast Voss 500g","unit":"g","category":"Yeast","costPerUnit":0.424}],"delivery_cost":24.0},{"id":"gf26164","po_number":"GF SO-26164","order_date":"2023-08-23","received_date":"2023-08-24","lines":[{"id":"42g45se","qty":50.0,"name":"Gladfield Wheat Malt","unit":"kg","category":"Grain","costPerUnit":2.1},{"id":"yvvxtnl","qty":40.0,"name":"Rolled Oats","unit":"kg","category":"Grain","costPerUnit":2.75},{"id":"cpbuwzt","qty":1000.0,"name":"Yeast Voss 500g","unit":"g","category":"Yeast","costPerUnit":0.424},{"id":"bl1qxtw","qty":150.0,"name":"American Ale Malt","unit":"kg","category":"Grain","costPerUnit":1.764}],"delivery_cost":338.0},{"id":"gf26057","po_number":"GF SO-26057","order_date":"2023-08-16","received_date":"2023-08-17","lines":[{"id":"42g45se","qty":25.0,"name":"Gladfield Wheat Malt","unit":"kg","category":"Grain","costPerUnit":2.1},{"id":"cpbuwzt","qty":88.0,"name":"Yeast Voss 500g","unit":"g","category":"Yeast","costPerUnit":0.6364},{"id":"yvvxtnl","qty":20.0,"name":"Rolled Oats","unit":"kg","category":"Grain","costPerUnit":2.75},{"id":"bl1qxtw","qty":25.0,"name":"American Ale Malt","unit":"kg","category":"Grain","costPerUnit":1.764},{"id":"qz08q2m","qty":1.0,"name":"Lactic Acid 80%","unit":"kg","category":"Other","costPerUnit":20.0}],"delivery_cost":234.01},{"id":"gf25874","po_number":"GF SO-25874","order_date":"2023-08-07","received_date":"2023-08-08","lines":[{"id":"oumcvrv","qty":1.0,"name":"Gladfield Eclipse Wheat","unit":"kg","category":"Grain","costPerUnit":7.0},{"id":"gf-ale-malt","qty":1.0,"name":"Ale Malt 25kg Bag","unit":"ea","category":"Other","costPerUnit":44.1},{"id":"gf-yeast-windsor","qty":8.0,"name":"Yeast Windsor 11g","unit":"ea","category":"Other","costPerUnit":5.5},{"id":"2jt4poi","qty":1.0,"name":"Epsom Salt (MgSO4)","unit":"kg","category":"Other","costPerUnit":5.0},{"id":"it1c0w7","qty":1.0,"name":"Gladfield Light Chocolate Malt","unit":"kg","category":"Grain","costPerUnit":7.0},{"id":"wr9dqql","qty":1.0,"name":"Aurora Malt","unit":"kg","category":"Grain","costPerUnit":7.0},{"id":"7ao19i9","qty":1.0,"name":"Chalk (CaCO3)","unit":"kg","category":"Other","costPerUnit":7.0},{"id":"ui1rxz1","qty":1.0,"name":"Gladfield Roast Barley","unit":"kg","category":"Grain","costPerUnit":7.0},{"id":"x7y53nf","qty":1.0,"name":"Gladfield Medium Crystal Malt","unit":"kg","category":"Grain","costPerUnit":7.0},{"id":"atpczlt","qty":1.0,"name":"Calcium Chloride (CaCl2)","unit":"kg","category":"Other","costPerUnit":5.0},{"id":"ttobcqk","qty":1.0,"name":"Gladfield Dark Crystal Malt","unit":"kg","category":"Grain","costPerUnit":7.0},{"id":"j208hgu","qty":1.0,"name":"Dark Chocolate Malt","unit":"kg","category":"Grain","costPerUnit":7.0},{"id":"lbxty99","qty":1.0,"name":"Gypsum (CaSO4)","unit":"kg","category":"Other","costPerUnit":5.5},{"id":"13a1bfd","qty":1.0,"name":"Yeast Vit 1kg Bag","unit":"kg","category":"Other","costPerUnit":23.0}],"delivery_cost":70.01},{"id":"gf24180","po_number":"GF SO-24180","order_date":"2023-05-08","received_date":"2023-05-09","lines":[{"id":"7i1xcht","qty":2.0,"name":"Super F","unit":"kg","category":"Other","costPerUnit":22.0}],"delivery_cost":15.0}]$j$::jsonb) r on conflict (id) do nothing returning po_number;