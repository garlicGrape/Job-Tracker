# AGENTS.md

Job Tracker is a **static Vite + React** web app. Accounts and listings live
in **the user’s Supabase project** (Postgres + Auth + RLS). CSV is a backup
export, not the database. It is not a Google Apps Script project.

## What this project is

- `src/App.tsx` — the UI (sign in / sign up + form). Vanilla React.
- `src/lib/applications.ts` — validation, dates, formula escaping, abuse limits.
- `src/lib/supabase-account.ts` — injected Supabase client; Auth + `applications`. Reads are paged.
- `src/lib/supabase-config.ts` — publishable-key parsing; runtime `config.json`.
- `src/lib/store.ts` — `{ getItem, setItem }` helpers used by unit tests.
- `src/lib/csv.ts` — CSV export / import.
- `supabase/schema.sql` — table, RLS, field CHECKs, write-rate trigger. Run in the SQL editor.
- `test/*.test.ts` — Vitest suites that import `src/lib` directly.

## Hard constraints

- **Database is Supabase.** Do not add Express, Apps Script, a Google Sheet, or
  a second database. Privacy is RLS (`auth.uid() = user_id`). The client uses a
  **publishable** key (`sb_publishable_...`), never `sb_secret_...` or
  `service_role`. Do not commit keys. Production builds must not inline
  `VITE_SUPABASE_*` (dev-only fallback). Runtime `config.json` is gitignored.
- **Keep `src/lib` framework-free.** No React, no `window`, no `document` except
  inside `downloadCsv`. Tests import these modules from Node.
- **Every text value written to CSV must pass through `escapeFormula`.** A
  value starting with `=`, `+`, `-`, or `@` is otherwise evaluated by Excel /
  Sheets. Storage itself keeps the original string so the table stays readable.
- **Store dates as `YYYY-MM-DD` text, never `Date` objects.** The Postgres
  column is `text` (`date_applied`) for the same reason.
- **Listings are unlimited. Do not reintroduce a per-account row cap.** Abuse is
  bounded by row size (`CHECK`s) and write rate (5,000 rows per statement,
  20,000 per hour), which hold at any table size. `LIMITS` in
  `src/lib/applications.ts` and `supabase/schema.sql` must stay in sync, and
  `list()` must stay paged.
- **Never edit `test/harness.ts` to make a test pass.** Fix `src/lib` instead.
- `npm test` is the gate. **Do not open a PR on red.** Tests must not need a
  live Supabase project (use a fake client).
- GitHub Pages: committed `docs/` is key-free. The `pages` workflow injects
  `config.json` from Actions secrets at deploy time. Local sign-in: gitignored
  `public/config.json` or `.env` (`VITE_SUPABASE_PUBLISHABLE_KEY`, dev only).

## Commands

```bash
npm ci            # install (also the environment install step)
npm test          # Vitest suite — the gate
npm run dev       # Vite dev server (http://localhost:5173)
npm run build     # static output in dist/
```

Copy `public/config.example.json` to `public/config.json` (gitignored) or
`.env.example` to `.env` for local sign-in.

## Cursor Cloud specific instructions

- Cloud agents can run `npm ci && npm test` with no external services.
- The optional `start` step runs Vite. Without `public/config.json` / `.env`,
  the UI shows “Connect your Supabase project” — that is expected. Do not
  invent keys or commit them.
- Agents **can** verify that setup/sign-in screens render. They **cannot**
  complete a real sign-up unless a publishable key is present in this
  environment (gitignored config). They **cannot** verify a published GitHub
  Pages / Lovable URL unless that host is in this environment.
- Do not add Google credentials, clasp tokens, or a bound spreadsheet.
