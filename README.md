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
| Abuse limits | Postgres CHECKs (field length, date shape, http(s) URLs), **500 listings per account**, and **30 inserts per 10 minutes** per account. Enforced in the database, not only the form. |
| Publishable key | `sb_publishable_...` — low privilege, same as the old anon JWT. The browser needs *some* public identifier. **Secret** keys (`sb_secret_...`, `service_role`) never go in the app or git. |

GitHub Pages and Lovable only serve the UI. They never see the table.

### Abuse limits (spam / oversized rows)

Anyone can read the publishable key from DevTools and call the Supabase REST API
directly, so **limits live in Postgres**. Re-run [`supabase/schema.sql`](supabase/schema.sql)
in the SQL editor after pulling this change. The UI shows the same errors.

| Limit | Where it is enforced | Why |
| ----- | -------------------- | --- |
| Sign-in required | RLS: `to authenticated` | Anonymous traffic cannot insert. |
| Own rows only | RLS: `auth.uid() = user_id` | Account B cannot write into account A. |
| Company / title ≤ 200 chars | `CHECK` + `validateApplication` | Stops multi-megabyte strings. |
| Posting URL ≤ 2048 chars, `http(s)` only | `CHECK` + `validateApplication` | Stops junk protocols and huge URLs. |
| Date `YYYY-MM-DD` | `CHECK` + calendar check in JS | Stops garbage in the text date column. |
| 500 listings per account | `AFTER INSERT` trigger (statement-level) + `replace_own_applications` RPC | Caps table growth even on a bulk CSV import. |
| 30 insert **statements** / 10 minutes | write-log trigger | A form spam loop is many statements; one CSV import is one statement. |
| CSV import is one transaction | `replace_own_applications` RPC | Delete + insert roll back together, so a rejected import cannot wipe existing rows. |
| CSV file ≤ 512 KB | UI, before `FileReader` | Avoids loading a huge file in the browser. |

Client checks are for a clear error message. Skipping them (curl, a script) still
hits the same Postgres constraints.

**Sign-up spam** (many accounts, then one listing each) is Auth, not this table.
In the Supabase dashboard: **Authentication → Rate Limits**, and optionally
**Authentication → Attack Protection** (CAPTCHA). This app cannot add a secret
CAPTCHA key; that setting stays in your project.

The free-tier database size and the 500-row cap are what prevent “crash the
database.” Postgres will not fall over from 500 short rows.

### Why a key in the browser is not a “database password”

Anyone can open DevTools and read whatever the frontend uses. That is true of
every SPA. Supabase’s model is:

- **Publishable key** — only says “this request is for *this* project.” It does
  not bypass RLS. Rotatable; not a long-lived JWT. Safe to *use* in the client.
- **Your login JWT** — issued after email/password sign-in. Policies use
  `auth.uid()`.
- **Secret key** — bypasses RLS. Treat like a root password. Never in git,
  never in `docs/`, never in Lovable.

Do **not** commit keys to GitHub (not even the publishable one). Git history
keeps them forever, and you might paste a secret key by mistake. This repo
gitignores `.env`, `public/config.json`, and `docs/config.json`. Production
builds do **not** inline keys; the app loads `config.json` at runtime.

## How it works

```
Browser
  ├── React UI (src/App.tsx)                     ← sign in / sign up + form (Lovable)
  ├── Domain logic (src/lib/applications.ts)     ← validation, dates, ids, limits
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
2. SQL editor: paste and run [`supabase/schema.sql`](supabase/schema.sql). If you
   already ran an older copy, run it again — it adds CHECKs and quota triggers
   without dropping your rows.
3. Authentication → Providers → Email: turn **off** “Confirm email” if you want
   to sign in immediately on a personal app.
4. **Settings → API Keys** (not the legacy JWT tab). If you only see *anon* /
   *service_role*, click **Create new API keys**. Copy the **Project URL** and
   the **publishable** key (`sb_publishable_...`). Never copy a secret key.
5. Local connect (pick one; neither file is committed):

   - Copy `public/config.example.json` to `public/config.json` and fill it in,
     **or**
   - Copy `.env.example` to `.env` with `VITE_SUPABASE_PUBLISHABLE_KEY` (dev
     server only; production builds ignore these so keys are not baked into
     `docs/`).

6. `npm run dev` — you should see Sign in / Create account.

### GitHub Pages without putting keys in git

1. Repo **Settings → Secrets and variables → Actions → New repository secret**.
   Names must match exactly:
   - `SUPABASE_URL` = `https://YOUR_PROJECT.supabase.co`
   - `SUPABASE_PUBLISHABLE_KEY` = `sb_publishable_...`
2. Also add the same two names under **Settings → Environments → github-pages**
   (the Pages job uses that environment; repo secrets alone are sometimes empty there).
3. **Settings → Pages**: source **GitHub Actions**.
4. **Actions → pages → Run workflow** (the last deploy skipped config because the
   secrets were blank, and still showed a green check).

The committed `docs/` folder stays key-free so CI can check it. After a good
pages run, `https://garlicgrape.github.io/Job-Tracker/config.json` should exist
(it is a 404 until secrets are picked up).

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
src/lib/applications.ts       # validation, dates, formula escaping, limits
src/lib/supabase-account.ts   # Auth + Postgres adapter
src/lib/supabase-config.ts    # publishable key only; runtime config.json
src/lib/store.ts              # in-memory helpers for tests
src/lib/csv.ts                # CSV export / import
supabase/schema.sql           # table + RLS + CHECKs + quota/rate triggers
```

## Develop

```bash
npm ci           # install
npm test         # Vitest suite (the gate)
npm run dev      # Vite at http://localhost:5173
npm run build    # static files in dist/
```

Without `public/config.json` or a dev `.env`, the UI asks you to connect a
Supabase project. Tests do not need a live project; they use a fake client.

## Host it

### GitHub Pages

Live site: **https://garlicgrape.github.io/Job-Tracker/**

The committed `docs/` folder is a key-free static build. To actually sign in on
Pages, use the `pages` GitHub Action with `SUPABASE_URL` and
`SUPABASE_PUBLISHABLE_KEY` secrets, and set Pages source to **GitHub Actions**.

After a UI change, still run `npm run build:pages` and commit `docs/` so CI’s
key-free check stays green.

### Lovable as the frontend

1. Import the GitHub repo in [Lovable](https://lovable.dev).
2. Restyle `src/App.tsx` / `src/index.css` (`.lock-screen`, `.auth-tab`,
   `.privacy-note`). Leave `src/lib/` and `supabase/schema.sql` alone.
3. Give Lovable a **publishable** key via its env UI, never a secret or
   `service_role` key. Do not let it recreate the table without RLS.

## Moving off the old Google Sheet

1. Sheet: **File → Download → CSV**.
2. Sign in, then **Import CSV**.
3. **Export CSV** anytime you want a backup.

## Why it's testable offline

`src/lib` is plain TypeScript. Tests inject a fake Supabase client (or a
memory `{ getItem, setItem }` for CSV/validation). The suite does not call
your real project.
