# Job Tracker

A **static** Vite + React app with **accounts**. You sign in with email and
password; job listings persist in **your Supabase Postgres database**, private
to that account via row-level security.

Five fields — **Company**, **Title**, **Date Applied**, **Stage**, **Posting
URL** — plus a list and a board view, search / filter / sort, pipeline metrics,
follow-up tracking, and CSV export/import as a personal backup that will not
duplicate what you already have.

**Stages:** `Applied → Interviewing → Offer` or `Rejected`. Change one inline
from any row or card without opening the edit form. `Received Offer` still
exists as a mirror of the offer stage, so older CSV exports keep working.

## Seeing what you applied to

The page opens on the listings, not on a form. Every row leads with a **company
badge** — the initials, tinted by a hue derived from the company name, so the
same employer looks the same everywhere and a long list stays scannable — then
the role, when you applied and how long ago, the stage, and the posting link.

Two views, switched from the toolbar:

- **List** — a table on a wide screen. Under 760px the same rows restyle into
  cards: company and stage on the first line, the role on the second, date and
  actions on the third. Nothing is duplicated in the DOM, so a long list is one
  node per row either way.
- **Board** — one column per stage, all four always present, because an empty
  Interviewing column next to a full Applied one is itself the answer. On a
  phone the columns become a snapping horizontal rail.

Add and edit happen in a panel that stays closed until you ask for it (the
**Add** button, or the floating button on a phone), so the list keeps the
screen.

The interface follows your system light/dark setting and the moon/sun button in
the header overrides it; the choice is remembered per browser.

## Metrics

A summary card leads with the total, how many are open, and your **weekly
pace**, over a **pipeline bar** showing the share of listings in each stage —
each legend row also filters the list. Beside it, **applications per week** for
the last eight Monday-to-Sunday weeks. Then the derived numbers: **response
rate** (anything that left "Applied"), **interview rate**, **offer rate**,
**last 7 days**, **average wait** on the applications still open with the
longest one named, how many are worth a **follow-up**, how many **distinct
companies** you have applied to, and how many are **still open**. The follow-up
and still-open tiles filter the list when clicked. If the app reports
“Database schema is out of date”, re-run `supabase/schema.sql`; the table is
missing the `status` column.

The toolbar above the list holds a search box (company, title, URL, stage),
stage filter chips with counts, five sort orders, and the view switch. Search
splits on whitespace and every term has to land somewhere in the row, so
`acme senior` finds Acme / Senior Engineer even though the words sit in
different fields. All of it runs on the list already in memory, so switching
views costs no extra queries. Both are pure functions in
[`src/lib/metrics.ts`](src/lib/metrics.ts) and
[`src/lib/organize.ts`](src/lib/organize.ts), unit-tested without a browser.

### Follow-ups

An application still in **Applied** or **Interviewing** 14 days after the date
applied is one nobody has answered, so it gets a **Follow up** badge on its row
or card, a tile in the metrics that filters the list, and its own chip next to
the stage chips.
Offer and Rejected never qualify — the company already answered. The threshold
is `FOLLOW_UP_DAYS` in [`src/lib/metrics.ts`](src/lib/metrics.ts).

## Database

**Supabase** (hosted PostgreSQL + Auth). Not a Google Sheet, not `localStorage`,
not a Node server you have to keep alive.

| Piece | What it does |
| ----- | ------------ |
| Supabase Auth | Email / password accounts |
| `public.applications` | Your rows (`user_id`, company, title, `date_applied` as `YYYY-MM-DD` text, `status`, offer flag, posting URL) |
| Row-level security | `auth.uid() = user_id` on select/insert/update/delete. Account B cannot read account A. |
| Abuse limits | **No cap on how many listings you keep.** Postgres bounds row *size* (field length, date shape, http(s) URLs) and write *rate* (5,000 rows per statement, 20,000 rows per hour, per account). Enforced in the database, not only the form. |
| Publishable key | `sb_publishable_...` — low privilege, same as the old anon JWT. The browser needs *some* public identifier. **Secret** keys (`sb_secret_...`, `service_role`) never go in the app or git. |

GitHub Pages and Lovable only serve the UI. They never see the table.

### Unlimited listings, still protected

**There is no limit on how many listings an account keeps.** Apply to as many
jobs as you want.

A row cap was never what protected the database. What protects it is bounding
how large one row can be and how fast rows can be created. Those two bounds
hold no matter how many listings you accumulate, so the ceiling is unnecessary.

Anyone can read the publishable key from DevTools and call the Supabase REST API
directly, so **the limits live in Postgres**. Re-run
[`supabase/schema.sql`](supabase/schema.sql) in the SQL editor after pulling this
change. The UI shows the same errors.

| Limit | Where it is enforced | Why |
| ----- | -------------------- | --- |
| Sign-in required | RLS: `to authenticated` | Anonymous traffic cannot insert. |
| Own rows only | RLS: `auth.uid() = user_id` | Account B cannot read or write account A. |
| Company / title ≤ 200 chars | `CHECK` + `validateApplication` | Bounds one row. Many rows cannot mean unbounded bytes. |
| Posting URL ≤ 2048 chars, `http(s)` only | `CHECK` + `validateApplication` | Stops junk protocols and huge URLs. |
| Date `YYYY-MM-DD` | `CHECK` + calendar check in JS | Stops garbage in the text date column. |
| Stage is one of four values | `CHECK` + `normalizeStatus` | `received_offer` is `CHECK`ed to mirror the offer stage, so the two cannot drift. |
| 5,000 rows per statement | `applications_write_rate` trigger | One runaway insert cannot dump millions of rows. |
| 20,000 rows per rolling hour | same trigger, via `application_write_log` | Bounds growth *rate* per account. No lifetime ceiling. |
| CSV file ≤ 5 MB | UI, before `FileReader` | Avoids loading a huge file in the browser. |

Client checks exist for a clear error message. Skipping them (curl, a script)
still hits the same Postgres constraints.

**What this means in practice.** Hand-entering listings is one row per save, so
the hourly budget is unreachable by a human. A CSV import of a few thousand past
applications is one statement and lands in one write. Only a script hammering
the API runs into the ceiling, and even then it is throttled rather than
letting the table grow without bound.

Reads are paged (`LIMITS.pageSize`, 1,000 rows per request) because PostgREST
caps a single response, and the table is ordered by
`(user_id, date_applied, id)` so a large account still reads from an index
instead of re-sorting. The UI renders 250 rows at a time with a **Show more**
button, so thousands of listings do not stall the browser.

**Sign-up spam** (many accounts, then one listing each) is Auth, not this table.
In the Supabase dashboard: **Authentication → Rate Limits**, and optionally
**Authentication → Attack Protection** (CAPTCHA). This app cannot add a secret
CAPTCHA key; that setting stays in your project.

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
  ├── React UI (src/App.tsx)                     ← auth, list / board views, form panel
  ├── Domain logic (src/lib/applications.ts)     ← validation, dates, stages, ids, limits
  ├── Metrics (src/lib/metrics.ts)               ← rates, pace, waiting times
  ├── Organizing (src/lib/organize.ts)           ← search, filter, sort, group by stage
  ├── Duplicates (src/lib/dedupe.ts)             ← import planning, form warning
  ├── Supabase adapter (src/lib/supabase-account.ts)
  ├── Store helpers (src/lib/store.ts)           ← used by tests / CSV shape
  └── CSV (src/lib/csv.ts)                       ← export + import
```

1. **Account** — create an account or sign in. The session is a Supabase Auth
   JWT in the browser.
2. **Add / edit / delete** — validated, then written to `applications` as *your* row. Delete asks for a second click to confirm, and so does saving a listing that matches one you already track.
3. **Stage** — the stage dropdown on a row writes `status` (and its
   `received_offer` mirror) for that row only.
4. **Organize** — search text, filter by stage, sort, or switch between the
   list and the stage board. All of it is client-side over the list already
   loaded, so nothing re-queries.
5. **Export CSV** — download a copy. With a search or stage filter on, the
   button says how many rows it will write and exports exactly those;
   otherwise it is the whole account. Formula-looking values get a leading `'`.
6. **Import CSV** — appends to *your* account in one insert, skipping rows the
   account already holds and rows the file repeats, so re-importing your own
   backup adds nothing instead of doubling everything. Nothing existing is
   deleted, so a rejected import cannot cost you data.

Sign out, close the tab, or open another device: sign in again and the list is
still there.

## Set up Supabase (once)

1. Create a free project at [supabase.com](https://supabase.com).
2. SQL editor: paste and run [`supabase/schema.sql`](supabase/schema.sql). If you
   already ran an older copy, run it again — it lifts the old 500-listing cap,
   installs the row-size and write-rate limits, and adds the `status` column
   (backfilled from your existing offer flags) without dropping your rows.
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
src/lib/applications.ts       # validation, dates, stages, formula escaping, limits
src/lib/metrics.ts            # pipeline metrics (pure functions)
src/lib/organize.ts           # search / filter / sort / group (pure functions)
src/lib/dedupe.ts             # duplicate detection for import and the form
src/lib/supabase-account.ts   # Auth + Postgres adapter
src/lib/supabase-config.ts    # publishable key only; runtime config.json
src/lib/store.ts              # in-memory helpers for tests
src/lib/csv.ts                # CSV export / import
supabase/schema.sql           # table + RLS + CHECKs + write-rate trigger
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
