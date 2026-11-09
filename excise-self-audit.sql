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
