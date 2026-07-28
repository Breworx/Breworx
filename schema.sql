-- Breworx — Supabase schema
-- Run this in the Supabase SQL editor (Project > SQL Editor > New query > paste > Run)

create extension if not exists "pgcrypto";

-- ─── Batches ────────────────────────────────────────────────────────────────
create table if not exists batches (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  number text not null,
  name text not null,
  style text,
  volume numeric,
  og numeric,
  fg numeric,
  mash_ph numeric,
  pre_boil_gravity numeric,
  top_up_water numeric,
  stage text not null default 'Brewing',
  start_date date not null,
  recipe_id text,
  recipe_name text,
  readings jsonb not null default '[]',
  ingredients jsonb not null default '[]',
  packaging jsonb,
  created_at timestamptz not null default now()
);

-- ─── Inventory ──────────────────────────────────────────────────────────────
create table if not exists inventory_items (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  category text not null,
  qty numeric not null default 0,
  unit text not null,
  threshold numeric not null default 0,
  lots jsonb not null default '[]',
  created_at timestamptz not null default now()
);

-- ─── Purchase orders ────────────────────────────────────────────────────────
create table if not exists purchase_orders (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  po_number text not null,
  supplier text not null,
  order_date date not null,
  received_date date,
  status text not null default 'Ordered',
  lines jsonb not null default '[]',
  created_at timestamptz not null default now()
);

-- ─── Recipes ────────────────────────────────────────────────────────────────
create table if not exists recipes (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  style text,
  volume numeric,
  og numeric,
  fg numeric,
  ingredients jsonb not null default '[]',
  created_at timestamptz not null default now()
);

-- ─── Row Level Security: every user only ever sees their own rows ──────────
alter table batches enable row level security;
alter table inventory_items enable row level security;
alter table purchase_orders enable row level security;
alter table recipes enable row level security;

create policy "own batches" on batches
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own inventory" on inventory_items
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own purchase orders" on purchase_orders
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own recipes" on recipes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
