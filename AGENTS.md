# AGENTS.md

Job Tracker is a **Google Apps Script** web app that records job applications to a
bound Google Sheet. It is not a Node service. Read this before changing code.

## What this project is

- `src/Code.gs` — the Apps Script (V8) backend. Plain JavaScript, one shared global scope.
- `src/Index.html` — the UI, served by `HtmlService`. Vanilla JS, no framework.
- `src/appsscript.json` — the Apps Script manifest.
- `test/harness.js` — reads `Code.gs` as text and evaluates it with fake Google globals.
- `test/*.test.js` — Vitest suites that run entirely offline.

## Hard constraints

- **This is Apps Script, not Node.** No npm packages, no `import`/`require`, no build
  step, and no `fetch` inside `src/Code.gs`. Use only Apps Script services
  (`SpreadsheetApp`, `LockService`, `HtmlService`, `UrlFetchApp`, …) and standard JS.
- **The client talks to the server only through `google.script.run`.** There is no REST API.
- **Never edit `test/harness.js` to make a test pass.** Fix `src/Code.gs` instead.
- **Every text value written to the sheet must pass through the formula-injection
  escape** (`escapeFormula_`). A value starting with `=`, `+`, `-`, or `@` is otherwise
  evaluated by Sheets. This is the single most common thing to forget — keep the test.
- **Store dates as `YYYY-MM-DD` text, never `Date` objects.** Apps Script timezone
  coercion will shift them by a day.
- **Guard sheet writes with `LockService`.** A double-click can otherwise append twice
  or read a stale last row.
- `npm test` is the gate. **Do not open a PR on red.**

## Commands

```bash
npm ci      # install (also the environment install step)
npm test    # run the Vitest suite — the gate
```

## Deploy (manual, local, not for agents)

Deployment needs a Google account and `clasp` OAuth tokens on a real machine, so it
happens locally and is out of scope for cloud agents:

```bash
npx clasp push   # push src/ to the bound Apps Script project
```

Then in the Apps Script editor: **Manage deployments → edit → Version: New version**.
`.clasp.json` (script ID only) is committed; `.clasprc.json` (OAuth tokens) is gitignored
and must never be committed.

## Cursor Cloud specific instructions

- Cloud agents can run the full suite (`npm ci && npm test`) with no external services —
  that is the whole point of the text-eval harness. There is no server to start, so
  `.cursor/environment.json` has an `install` step and no `start`.
- Agents **cannot** verify the deployed web app: whether it renders, whether Google
  authorization succeeded, or whether the real `SpreadsheetApp` behaves as the fakes in
  `test/harness.js` assume. Do not claim UI/deploy verification from a cloud run — leave
  the click-through to a human after `clasp push`.
- Reaching the real sheet would require personal Google credentials in Cursor's secret
  store; do not add them for this project.
