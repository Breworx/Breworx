# Breworx — Fermentation Log

A brewery batch, inventory, purchase order, and recipe tracker, backed by Supabase
(Postgres + auth) so data persists and each user only sees their own brewery.

## 1. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) → New project (free tier is enough to start).
2. Once it's created, open **SQL Editor** → New query, paste in the contents of
   `schema.sql` from this folder, and run it. This creates the `batches`,
   `inventory_items`, `purchase_orders`, and `recipes` tables, each locked down
   with row-level security so a user can only ever read or write their own rows.
3. Go to **Project Settings → API**. You'll need two values from there:
   - **Project URL**
   - **anon public** key

## 2. Configure the app

```
cp .env.example .env
```

Edit `.env` and paste in your Project URL and anon key from step 1.

## 3. Email confirmation (optional but recommended for now)

By default Supabase requires users to confirm their email before signing in.
For a quick personal test, you can turn this off under **Authentication →
Providers → Email → "Confirm email"**. For anything real, leave it on and
users will get a confirmation link automatically.

## 4. Run locally

```
npm install
npm run dev
```

Create an account on the sign-up screen, and you're in. Every batch, inventory
item, order, and recipe you add is now saved to your Supabase project — refresh
the page, or open the app on another device and sign in, and it's all still there.

## 5. Build & deploy

```
npm run build
```

This outputs a static `dist/` folder.

**Vercel or Netlify (recommended)**
1. Push this folder to a GitHub repo.
2. Import the repo in Vercel or Netlify.
3. Build command: `npm run build` — Output directory: `dist`.
4. Add the same two environment variables from your `.env` file in the
   host's dashboard (Vercel: Project Settings → Environment Variables;
   Netlify: Site settings → Environment variables) — they need the
   `VITE_` prefix preserved exactly.
5. Deploy. Every push updates the live site automatically.

**Netlify drag-and-drop (no git needed)**
1. Run `npm run build` locally (with `.env` in place so the build picks up
   your Supabase credentials).
2. Go to app.netlify.com/drop and drag the `dist/` folder in.
   (Note: this bakes your credentials into that one build — fine for the
   anon key, which is meant to be public, but you'll need to rebuild and
   re-drag if you ever change projects.)

## How the data model works

Each table has a `user_id` column tied to the signed-in user, and Postgres
row-level security policies (in `schema.sql`) enforce that a user's queries
only ever touch their own rows — there's no way for one brewery's data to
leak into another's, even if someone tampered with the client.

Nested data (fermentation readings, recipe ingredients, PO line items,
inventory lot history, packaging counts) is stored as JSON columns rather
than fully separate tables, to keep the schema simple. That's a fine
tradeoff for a single-brewery tool; if you outgrow it (e.g. you want to
query "every batch that used lot X" efficiently across thousands of
batches), that's the point where you'd normalize those into their own
tables with foreign keys.

## What's still worth adding

- **Team accounts**: right now each login only sees their own data. If
  multiple people at the same brewery need shared access, you'd add a
  `breweries` table and a join table linking users to a brewery, then
  scope the RLS policies to brewery membership instead of `user_id`
  directly.
- **Realtime**: Supabase supports realtime subscriptions — useful if two
  people might be looking at the same batch at once and you want changes
  to show up live without a refresh.
- **File uploads**: if you want to attach photos (label art, mash tun
  setup, etc.), Supabase Storage plugs in alongside the same project.
