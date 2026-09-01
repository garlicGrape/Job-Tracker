# Job Tracker

A private [Google Apps Script](https://developers.google.com/apps-script) web app that
records job applications to a bound Google Sheet. Four fields — **Company**, **Title**,
**Date Applied**, **Received Offer** — a form, and a table of past entries.

Nothing to host, no API keys, no backend to keep alive. The app runs inside Google and
is already authorized on your sheet; the repo is the source of truth and `clasp push`
mirrors it into the editor.

## Stack

| Layer   | Choice                                   |
| ------- | ---------------------------------------- |
| UI      | Apps Script `HtmlService` + vanilla JS   |
| Server  | Apps Script (V8 runtime)                 |
| Storage | The bound Google Sheet                   |
| Auth    | Google account, "Only myself"            |
| Tests   | [Vitest](https://vitest.dev) on Node     |
| Deploy  | [`clasp`](https://github.com/google/clasp) |

## Layout

```
src/Code.gs         # Apps Script backend (validation, escaping, locking)
src/Index.html      # UI served by HtmlService
src/appsscript.json # Apps Script manifest
test/harness.js     # reads Code.gs as text, evals with fake Google globals
test/*.test.js      # offline Vitest suites
.cursor/environment.json  # Cloud Agent config ({ "install": "npm ci" })
AGENTS.md           # constraints for humans and agents
.clasp.json         # script ID (safe to commit)
```

## Why it's testable offline

Apps Script's V8 runtime shares one global scope across `.gs` files, so `Code.gs` is
plain JavaScript. The Node harness reads it as text, evaluates it with fake
`SpreadsheetApp` / `LockService` globals, and calls the functions directly. That turns an
otherwise-untestable project into one you (and cloud agents) can iterate on unattended.

The suite verifies: validation rules, formula-injection escaping, date handling, row
mapping, lock acquisition/release, and header creation. It **cannot** verify the deployed
web app renders or that Google authorization succeeded — deploy and click through that
part by hand.

## Develop

```bash
npm ci      # install dev dependencies
npm test    # run the Vitest suite (the gate)
```

## Deploy (manual)

1. Create a Google Sheet and rename the first tab to `Applications` (leave row 1 empty —
   the code writes its own header on first run).
2. **Extensions → Apps Script**, then copy the script ID from **Project Settings** into
   `.clasp.json` (replace `REPLACE_WITH_YOUR_SCRIPT_ID`).
3. Authorize clasp locally: `npx clasp login`.
4. Push and deploy:
   ```bash
   npx clasp push
   ```
   Then in the Apps Script editor: **Manage deployments → edit (pencil) →
   Version: New version**. Choosing "New deployment" instead gives a fresh URL and leaves
   the old one serving stale code.
5. Open the web app and check by hand: submit a row, watch the sheet, toggle the offer
   checkbox, reload.

> `clasp push` overwrites the online editor — the repo always wins. `.clasprc.json` holds
> your OAuth tokens and is gitignored; never commit it.
