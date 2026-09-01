# AGENTS.md

Job Tracker is a **static Vite + React** web app that records job applications
in `localStorage` (encrypted with a passphrase) and can export them as CSV. It
is not a Google Apps Script project and it is not a Node server. Read this
before changing code.

## What this project is

- `src/App.tsx` — the UI (lock screen + form). Vanilla React, no component library.
- `src/lib/applications.ts` — validation, date checks, ids, formula escaping.
- `src/lib/store.ts` — persistence behind a `{ getItem, setItem }` interface.
- `src/lib/vault.ts` — passphrase encryption (AES-GCM). The passphrase is never stored.
- `src/lib/csv.ts` — CSV export (and import for migrating from a sheet).
- `test/*.test.ts` — Vitest suites that import `src/lib` directly.

## Hard constraints

- **No backend.** Do not add Express, Apps Script, or a database unless the
  user explicitly asks for one. Persistence is encrypted `localStorage`;
  portability is CSV. A public host (GitHub Pages, Lovable) only serves the
  app; it cannot read anyone's applications.
- **Keep `src/lib` framework-free.** No React, no `window`, no `document` except
  inside `downloadCsv`. Tests import these modules from Node.
- **Every text value written to CSV must pass through `escapeFormula`.** A
  value starting with `=`, `+`, `-`, or `@` is otherwise evaluated by Excel /
  Sheets. Storage itself keeps the original string so the table stays readable.
- **Store dates as `YYYY-MM-DD` text, never `Date` objects.** Timezone
  coercion will shift them by a day.
- **Never edit `test/harness.ts` to make a test pass.** Fix `src/lib` instead.
- `npm test` is the gate. **Do not open a PR on red.**
- GitHub Pages publishes `docs/` from `main` (legacy Jekyll, `/docs` folder).
  After a UI change run `npm run build:pages` and commit `docs/`. CI fails if
  `docs/` does not match the production build.

## Commands

```bash
npm ci            # install (also the environment install step)
npm test          # Vitest suite — the gate
npm run dev       # Vite dev server (http://localhost:5173)
npm run build     # static output in dist/
```

## Cursor Cloud specific instructions

- Cloud agents can run the full suite (`npm ci && npm test`) with no external
  services. The optional `start` step in `.cursor/environment.json` runs Vite
  so a human (or computer-use) can click through the UI.
- Agents **can** verify the local Vite UI: create a passphrase, add a row,
  lock, unlock, toggle offer, export CSV, import CSV. They **cannot** verify a
  published GitHub Pages / Lovable URL unless that host is in this environment.
- Do not add Google credentials, clasp tokens, or a bound spreadsheet. The
  Google Sheet path is retired.
