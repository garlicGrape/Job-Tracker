# Job Tracker

A small full-stack app for tracking job applications from **Wishlist** all the way
to **Offer**. Built as a monorepo with an Express + SQLite API and a React + Vite UI.

![Stack](https://img.shields.io/badge/stack-React%20%2B%20Express%20%2B%20SQLite-4f46e5)

## Features

- Create, edit, and delete job applications
- Track status (Wishlist → Applied → Interviewing → Offer / Rejected)
- Filter by status and see live stats per stage
- Persistent storage with SQLite (no external database required)

## Project structure

```
.
├── client/           # React + Vite + TypeScript + Tailwind CSS frontend
├── server/           # Express + TypeScript + better-sqlite3 API
├── package.json      # npm workspaces + dev scripts
└── .cursor/          # Cloud Agent environment configuration
```

## Requirements

- Node.js >= 20 (developed on Node 22)
- npm >= 10

## Getting started

```bash
# Install all workspace dependencies
npm install

# Run the API (http://localhost:3001) and the web app (http://localhost:5173)
npm run dev
```

The Vite dev server proxies `/api` requests to the API, so open
<http://localhost:5173> and start adding applications. On first run the API seeds
a few example rows so the UI isn't empty.

## Useful commands

| Command             | Description                                        |
| ------------------- | -------------------------------------------------- |
| `npm run dev`       | Run the API and web app together (via concurrently)|
| `npm run dev:server`| Run only the API in watch mode                     |
| `npm run dev:client`| Run only the web app                               |
| `npm run build`     | Type-check and build both packages                 |
| `npm test`          | Run the API integration tests                      |
| `npm run typecheck` | Type-check both packages                           |
| `npm run lint`      | Type-check both packages (lint gate)               |

## API

Base URL: `/api`

| Method   | Path            | Description                         |
| -------- | --------------- | ----------------------------------- |
| `GET`    | `/health`       | Health check                        |
| `GET`    | `/statuses`     | List of valid statuses              |
| `GET`    | `/stats`        | Totals grouped by status            |
| `GET`    | `/jobs`         | List jobs (optional `?status=`)     |
| `GET`    | `/jobs/:id`     | Get a single job                    |
| `POST`   | `/jobs`         | Create a job                        |
| `PUT`    | `/jobs/:id`     | Update a job                        |
| `DELETE` | `/jobs/:id`     | Delete a job                        |

The SQLite database is stored at `server/data/jobs.db` (git-ignored). Override the
location with the `DATABASE_FILE` environment variable.
