# Job Tracker

A private, **static** web app that records job applications in your browser.
Four fields — **Company**, **Title**, **Date Applied**, **Received Offer** — a
form, a table, and a button to export (or import) the list as CSV.

Nothing to host beyond a static site, no API keys, no Google Sheet, no backend
to keep alive. Data lives in `localStorage` on the machine and browser you use;
CSV is how you take a copy with you.

## How it works

```
Browser
  ├── React UI (src/App.tsx)
  ├── Domain logic (src/lib/applications.ts)  ← validation, dates, ids
  ├── Store (src/lib/store.ts)                ← read/write localStorage
  └── CSV (src/lib/csv.ts)                    ← export + import
```

1. **Add** — the form validates company, title, and a real `YYYY-MM-DD` date,
   then appends a record to `localStorage` under `job-tracker.applications`.
2. **List** — on load, the table is rendered from that same key.
3. **Offer checkbox** — updates only that record’s `receivedOffer` flag.
4. **Export CSV** — downloads `job-applications-YYYY-MM-DD.csv`. Values that
   look like spreadsheet formulas (`=`, `+`, `-`, `@`) are prefixed with `'`
   so Excel / Sheets will not execute them.
5. **Import CSV** — appends rows from a CSV with the same four headers (including
   a File → Download → CSV export of the old Google Sheet).

There is no server-side database. Clearing site data, switching browsers, or
opening the app on another device starts from an empty list unless you import
a CSV.

## Stack

| Layer     | Choice                                      |
| --------- | ------------------------------------------- |
| UI        | React 18 + Vite                             |
| Storage   | `localStorage`                              |
| Export    | CSV download                                |
| Tests     | [Vitest](https://vitest.dev) on Node        |
| Deploy    | Any static host (GitHub Pages, Lovable, …)  |

## Layout

```
src/App.tsx              # UI (the surface Lovable can restyle)
src/main.tsx             # React entry
src/index.css            # layout and colors
src/lib/applications.ts  # validation, dates, formula escaping
src/lib/store.ts         # localStorage persistence
src/lib/csv.ts           # CSV export / import
src/lib/types.ts         # shared types
test/*.test.ts           # offline Vitest suites
vite.config.ts           # Vite + Vitest, base: './' for static hosts
```

## Develop

```bash
npm ci           # install
npm test         # Vitest suite (the gate)
npm run dev      # Vite at http://localhost:5173
npm run build    # static files in dist/
```

## Host it for free

The production build is a folder of static HTML/JS/CSS (`dist/`). Any of these
work; none need Google.

### GitHub Pages

Live site: **https://garlicgrape.github.io/Job-Tracker/**

This repo’s Pages source is **Deploy from a branch → `main` → `/docs`**
(Jekyll). `npm run build:pages` copies the Vite build into `docs/` (plus
`.nojekyll` so Jekyll does not wrap the SPA). After changing the UI, run
that script and commit `docs/` so Pages stays current.

### Netlify / Vercel / Cloudflare Pages

Connect the GitHub repo. Build command: `npm run build`. Publish directory:
`dist`.

### Lovable as the frontend

[Lovable](https://lovable.dev) edits React + Vite repos. This app is already
that shape:

1. Push to GitHub and **Import** the repo in Lovable (or open it with Lovable’s
   GitHub integration).
2. Ask Lovable to restyle `src/App.tsx` / `src/index.css`. Leave `src/lib/`
   alone — validation, storage, and CSV live there so a UI rewrite cannot
   silently drop the rules the tests cover.
3. Publish from Lovable. Preview and production are still static pages, so
   `localStorage` and CSV export keep working.

Lovable does not replace `localStorage` with a cloud database by itself. If you
later want the list to sync across devices, that is a separate backend (for
example Supabase); this repo stays frontend-only on purpose.

## Moving off the old Google Sheet

1. In the sheet, **File → Download → Comma Separated Values (.csv)**.
2. Open this app and click **Import CSV**.
3. Click **Export CSV** anytime you want a backup.

## Why it's testable offline

`src/lib` is plain TypeScript with no React and no browser APIs except an
injected `{ getItem, setItem }` storage. Tests pass a memory map, so the suite
runs in Node with no window and no network.

The suite verifies: validation rules, formula-injection escaping on CSV export,
date handling, persistence, offer toggles, and CSV round-trip. It cannot verify
that a particular host served `dist/` correctly — open the deployed URL and
click through that part by hand.
