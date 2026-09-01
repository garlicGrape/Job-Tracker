# Job Tracker

A private, **static** web app that records job applications in your browser.
Five fields — **Company**, **Title**, **Date Applied**, **Received Offer**,
**Posting URL** — a form, a table, and a button to export (or import) the list
as CSV.

Nothing to host beyond a static site, no API keys, no Google Sheet, no backend
to keep alive. The list is encrypted in `localStorage` with **your passphrase**
on the machine and browser you use. The public website only serves the app;
it never sees your applications. CSV is how you take a copy with you.

## How it works

```
Browser
  ├── React UI (src/App.tsx)                  ← lock screen + form (Lovable)
  ├── Domain logic (src/lib/applications.ts)  ← validation, dates, ids
  ├── Store (src/lib/store.ts)                ← read/write once unlocked
  ├── Vault (src/lib/vault.ts)                ← passphrase encrypt / decrypt
  └── CSV (src/lib/csv.ts)                    ← export + import
```

1. **Passphrase** — first visit you choose a passphrase (min 8 characters).
   Later visits you unlock with it. It is kept in memory only, never written
   to `localStorage` or sent to a server.
2. **Add** — the form validates company, title, and a real `YYYY-MM-DD` date,
   then appends a record. The whole list is re-encrypted into
   `job-tracker.applications`. Posting URL is optional; if you paste a
   hostname without `https://`, the app adds it.
3. **List** — after unlock, the table is rendered from the decrypted list.
4. **Edit** — **Edit** on a row loads that application into the form. Save
   writes over the same record; Cancel discards the draft.
5. **Offer checkbox** — updates only that record’s `receivedOffer` flag.
6. **Lock** — clears the decrypted list from the page. Ciphertext stays.
7. **Export CSV** — downloads `job-applications-YYYY-MM-DD.csv`. Values that
   look like spreadsheet formulas (`=`, `+`, `-`, `@`) are prefixed with `'`
   so Excel / Sheets will not execute them.
8. **Import CSV** — appends rows from a CSV with the same headers (including
   a File → Download → CSV export of the old four-column Google Sheet).

There is no server-side database and no account. Clearing site data, switching
browsers, or opening the app on another device starts from an empty vault
unless you import a CSV. Forgetting the passphrase also means the list is
gone — reset the device vault and import a backup.

## Stack

| Layer     | Choice                                      |
| --------- | ------------------------------------------- |
| UI        | React 18 + Vite                             |
| Storage   | Encrypted `localStorage` (passphrase)       |
| Export    | CSV download                                |
| Tests     | [Vitest](https://vitest.dev) on Node        |
| Deploy    | Any static host (GitHub Pages, Lovable, …)  |

## Layout

```
src/App.tsx              # UI (the surface Lovable can restyle)
src/main.tsx             # React entry
src/index.css            # layout and colors
src/lib/applications.ts  # validation, dates, formula escaping
src/lib/store.ts         # unlocked-session persistence
src/lib/vault.ts         # passphrase encryption (AES-GCM)
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
that shape. **Lovable restyles the UI; this repo owns storage and privacy.**

1. Push to GitHub and **Import** the repo in Lovable (or open it with Lovable’s
   GitHub integration).
2. Ask Lovable to restyle `src/App.tsx` / `src/index.css` (including the lock
   screen classes `.lock-screen`, `.lock-form`, `.privacy-note`). Leave
   `src/lib/` alone — validation, the encrypted vault, and CSV live there so
   a UI rewrite cannot silently drop the rules the tests cover.
3. Publish from Lovable. Preview and production are still static pages. Each
   visitor gets their own encrypted `localStorage`; Lovable cannot see it.

Do not ask Lovable to “add Supabase” or a cloud database for this app. A hosted
database would put your applications on someone else’s servers. Encrypted
`localStorage` plus CSV export is the private path. Sync across devices is a
CSV export on one machine and import on the other.

## Moving off the old Google Sheet

1. In the sheet, **File → Download → Comma Separated Values (.csv)**.
2. Open this app and click **Import CSV**.
3. Click **Export CSV** anytime you want a backup.

## Why it's testable offline

`src/lib` is plain TypeScript with no React and no browser APIs except an
injected `{ getItem, setItem }` storage. Tests pass a memory map, so the suite
runs in Node with no window and no network.

The suite verifies: validation rules, formula-injection escaping on CSV export,
date handling, persistence, offer toggles, CSV round-trip, and that the vault
round-trips with a passphrase without storing plaintext. It cannot verify
that a particular host served `dist/` correctly — open the deployed URL and
click through that part by hand.
