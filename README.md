# Faranani Property Group — Management System

Operations and property-management platform for Faranani Property Group: student
accommodation applications, tenants, rooms, leases, finance and ledger, maintenance,
cleaning, office admin, HR, documents, reports, audit logs and a student portal.

The frontend is a React 19 + Vite + Tailwind single-page app. The backend is an
Express API that stores everything in a local SQLite file through Node's built-in
`node:sqlite` module, so there is no external database to provision.

## Requirements

| Tool | Version |
| --- | --- |
| Node.js | **22.13 or newer** — 24.x recommended (`node:sqlite` is built in from 22.13) |
| npm | 10 or newer |

## Quick start

```bash
npm install
cp cpanel-deploy/.env.example .env    # then set NODE_ENV=development
npm run dev                           # API on :3001, web on :5173
```

Open <http://localhost:5173>. On first start the server creates
`server/data/faranani.db` and seeds the base schema plus the configuration data.

The seeded administrator account is documented in
[`cpanel-deploy/README-DEPLOY.md`](cpanel-deploy/README-DEPLOY.md). **Change its
password after the first sign-in.**

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Runs the API (`node --watch`) and the Vite dev server together |
| `npm run dev:api` | API only, on port 3001 |
| `npm run dev:web` | Frontend only, proxying `/api` and `/uploads` to 3001 |
| `npm run build` | Type-checks with `tsc --noEmit`, then builds the SPA into `dist/` |
| `npm start` | Production mode: Express serves `dist/` **and** the API |
| `npm test` | End-to-end API test suite (`tests/run-tests.mjs`) |
| `npm run reset` | Re-seeds the database |
| `npm run clean:data` | Clears transactional data, keeping configuration |

## Structure

```
src/                  React app — pages, components, auth context, API client
server/               Express API
  index.js            HTTP server, route mounting, static hosting
  db.js               Schema, migrations and the SQLite connection
  auth.js             Session and permission handling
  routes/             Feature routers (core, edu, props, ops, finance, hr, …)
supabase/migrations/  Reference SQL schema (not used by the running app)
tests/                API test suite
cpanel-deploy/        Prebuilt bundle + cPanel deployment guide
```

## Environment

Configuration is read from `.env` in the project root (see
[`cpanel-deploy/.env.example`](cpanel-deploy/.env.example)). `.env` is git-ignored —
never commit real keys.

| Variable | Purpose |
| --- | --- |
| `NODE_ENV` | `production` on a live host (enables secure session cookies) |
| `PORT` | API port, defaults to `3001` (hosts like cPanel/Passenger set it) |
| `FG_DB_PATH` | Optional absolute path to keep the SQLite file outside the app folder |
| `CALVIN_AI_API_KEY`, `CALVIN_AI_BASE_URL`, `CALVIN_AI_MODEL` | Optional AI assistant; off when unset |

## Deployment

The app needs a **Node.js runtime** — it cannot be hosted as static files. GitHub
Pages, for example, only serves static content and provides no API, database or
session support, so the SPA would load but sign-in and every data request would fail.

Verified deployment target: cPanel with *Setup Node.js App* (Passenger), Node 22.13+
or 24.x. Upload the bundle, install production dependencies, make `server/data` and
`uploads` writable, and enable AutoSSL — HTTPS is mandatory because production
session cookies are `Secure`. Full step-by-step instructions, including
troubleshooting, are in [`cpanel-deploy/README-DEPLOY.md`](cpanel-deploy/README-DEPLOY.md).

## Data and backups

The live database is `server/data/faranani.db` (with `-wal`/`-shm` side files) and
uploaded documents live in `uploads/`. Both are git-ignored: they hold client data
and are never part of this repository. Back them up by copying those paths, or point
`FG_DB_PATH` at a folder outside the application so redeploys never touch live data.
