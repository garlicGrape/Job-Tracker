# AGENTS.md

Job Tracker is a **static Vite + React** web app. Accounts and listings live
in **the user’s Supabase project** (Postgres + Auth + RLS). CSV is a backup
export, not the database. It is not a Google Apps Script project.

## What this project is

- `src/App.tsx` — the UI (sign in / sign up + form). Vanilla React.
- `src/lib/applications.ts` — validation, date checks, ids, formula escaping.
- `src/lib/supabase-account.ts` — injected Supabase client; Auth + `applications`.
- `src/lib/store.ts` — `{ getItem, setItem }` helpers used by unit tests.
- `src/lib/csv.ts` — CSV export / import.
- `supabase/schema.sql` — table + row-level security. Run in the SQL editor.
- `test/*.test.ts` — Vitest suites that import `src/lib` directly.

## Hard constraints

- **Database is Supabase.** Do not add Express, Apps Script, a Google Sheet, or
  a second database. Privacy is RLS (`auth.uid() = user_id`), not a passphrase
  vault and not a service-role key in the client.
- **Keep `src/lib` framework-free.** No React, no `window`, no `document` except
  inside `downloadCsv`. Tests import these modules from Node.
- **Every text value written to CSV must pass through `escapeFormula`.** A
  value starting with `=`, `+`, `-`, or `@` is otherwise evaluated by Excel /
  Sheets. Storage itself keeps the original string so the table stays readable.
- **Store dates as `YYYY-MM-DD` text, never `Date` objects.** The Postgres
  column is `text` (`date_applied`) for the same reason.
- **Never edit `test/harness.ts` to make a test pass.** Fix `src/lib` instead.
- `npm test` is the gate. **Do not open a PR on red.** Tests must not need a
  live Supabase project (use a fake client).
- GitHub Pages publishes `docs/` from `main`. After a UI change run
  `npm run build:pages` and commit `docs/`. Pass `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_ANON_KEY` at build time (repo Actions secrets).

## Commands

```bash
npm ci            # install (also the environment install step)
npm test          # Vitest suite — the gate
npm run dev       # Vite dev server (http://localhost:5173)
npm run build     # static output in dist/
```

Copy `.env.example` to `.env` for local sign-in.

## Cursor Cloud specific instructions

- Cloud agents can run `npm ci && npm test` with no external services.
- The optional `start` step runs Vite. Without `.env`, the UI shows
  “Connect your Supabase project” — that is expected. Do not invent keys.
- Agents **can** verify that setup/sign-in screens render. They **cannot**
  complete a real sign-up unless `VITE_SUPABASE_*` is present in this
  environment. They **cannot** verify a published GitHub Pages / Lovable URL
  unless that host is in this environment.
- Do not add Google credentials, clasp tokens, or a bound spreadsheet.
