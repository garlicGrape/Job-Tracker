# Job Tracker

A **static** Vite + React app with **accounts**. You sign in with email and
password; job listings persist in **your Supabase Postgres database**, private
to that account via row-level security.

Five fields — **Company**, **Title**, **Date Applied**, **Received Offer**,
**Posting URL** — plus CSV export/import as a personal backup.

## Database

**Supabase** (hosted PostgreSQL + Auth). Not a Google Sheet, not `localStorage`,
not a Node server you have to keep alive.

| Piece | What it does |
| ----- | ------------ |
| Supabase Auth | Email / password accounts |
| `public.applications` | Your rows (`user_id`, company, title, `date_applied` as `YYYY-MM-DD` text, offer flag, posting URL) |
| Row-level security | `auth.uid() = user_id` on select/insert/update/delete. Account B cannot read account A. |
| Anon key | Safe to ship in the static app. RLS is what keeps the table private. Never put the **service role** key in this repo. |

GitHub Pages and Lovable only serve the UI. They never see the table.

## How it works

```
Browser
  ├── React UI (src/App.tsx)                     ← sign in / sign up + form (Lovable)
  ├── Domain logic (src/lib/applications.ts)     ← validation, dates, ids
  ├── Supabase adapter (src/lib/supabase-account.ts)
  ├── Store helpers (src/lib/store.ts)           ← used by tests / CSV shape
  └── CSV (src/lib/csv.ts)                       ← export + import
```

1. **Account** — create an account or sign in. The session is a Supabase Auth
   JWT in the browser.
2. **Add / edit** — validated, then written to `applications` as *your* row.
3. **Offer checkbox** — updates only that row’s `received_offer`.
4. **Export CSV** — download a copy. Formula-looking values get a leading `'`.
5. **Import CSV** — appends those rows to *your* account.

Sign out, close the tab, or open another device: sign in again and the list is
still there.

## Set up Supabase (once)

1. Create a free project at [supabase.com](https://supabase.com).
2. SQL editor: paste and run [`supabase/schema.sql`](supabase/schema.sql).
3. Authentication → Providers → Email: turn **off** “Confirm email” if you want
   to sign in immediately on a personal app.
4. Project Settings → API: copy **Project URL** and **anon public** key.
5. Copy `.env.example` to `.env` and fill those two values:

```
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

6. `npm run dev` — sign up, add a listing, refresh, sign in again.

For GitHub Pages, add the same two names as repository **Actions secrets** so
`npm run build:pages` can inline them. Then commit the new `docs/` build.

## Stack

| Layer     | Choice                                      |
| --------- | ------------------------------------------- |
| UI        | React 18 + Vite                             |
| Database  | Supabase Postgres                           |
| Accounts  | Supabase Auth                               |
| Privacy   | Row-level security                          |
| Export    | CSV download                                |
| Tests     | [Vitest](https://vitest.dev) on Node        |
| Deploy    | Static host (GitHub Pages, Lovable, …)      |

## Layout

```
src/App.tsx                   # UI (the surface Lovable can restyle)
src/lib/applications.ts       # validation, dates, formula escaping
src/lib/supabase-account.ts   # Auth + Postgres adapter
src/lib/store.ts              # in-memory helpers for tests
src/lib/csv.ts                # CSV export / import
supabase/schema.sql           # table + RLS (run in the SQL editor)
```

## Develop

```bash
npm ci           # install
npm test         # Vitest suite (the gate)
npm run dev      # Vite at http://localhost:5173
npm run build    # static files in dist/
```

Without `.env`, the UI asks you to connect a Supabase project. Tests do not
need a live project; they use a fake client.

## Host it

### GitHub Pages

Live site: **https://garlicgrape.github.io/Job-Tracker/**

Pages source is **Deploy from a branch → `main` → `/docs`**. After a UI change
(and after setting Supabase env for the build), run `npm run build:pages` and
commit `docs/`.

### Lovable as the frontend

1. Import the GitHub repo in [Lovable](https://lovable.dev).
2. Restyle `src/App.tsx` / `src/index.css` (`.lock-screen`, `.auth-tab`,
   `.privacy-note`). Leave `src/lib/` and `supabase/schema.sql` alone.
3. Point Lovable at the same `VITE_SUPABASE_*` values. Do not let it recreate
   the table without RLS, and do not paste a **service role** key into the app.

## Moving off the old Google Sheet

1. Sheet: **File → Download → CSV**.
2. Sign in, then **Import CSV**.
3. **Export CSV** anytime you want a backup.

## Why it's testable offline

`src/lib` is plain TypeScript. Tests inject a fake Supabase client (or a
memory `{ getItem, setItem }` for CSV/validation). The suite does not call
your real project.
