# Deploying Faranani Property Group on cPanel

This folder is a **prebuilt production bundle**. `dist/` already contains the
compiled frontend; the Express server in `server/` serves both that frontend and
the `/api` backend from a single Node process, so you do not need PHP, Apache
rewrites, or a separate frontend host.

## 1. Host requirements

| Requirement | Value |
| --- | --- |
| cPanel feature | **Setup Node.js App** (Node.js Selector / Passenger) |
| Node.js version | **22.13 or newer** — 24.x recommended |
| Database | SQLite file, created automatically on first start |

The server imports the built-in `node:sqlite` module. It is unavailable on
Node 20 and needs the `--experimental-sqlite` flag on Node 22.5–22.12, so choose
**22.13+** or **24.x** in the Node.js Selector. On older versions the app will
fail to start with `No such built-in module: node:sqlite`.

No native modules are compiled during install, so `npm install` works on any
cPanel account without build tools.

## 2. Upload the files

1. In cPanel → **File Manager**, open the folder that will hold the application
   (for example `/home/YOURUSER/faranani` — *not* `public_html`).
2. Upload `faranani-cpanel.zip` and **Extract** it there, so that
   `package.json` and the `server/` folder sit directly inside that folder.

## 3. Create the Node.js application

cPanel → **Setup Node.js App** → **Create Application**:

- **Node.js version**: 24.x (or 22.13+)
- **Application mode**: Production
- **Application root**: `faranani` (the folder from step 2)
- **Application URL**: your domain or subdomain
- **Application startup file**: `server/index.js`
- **Environment variables**: add `NODE_ENV` = `production`

Click **Create**.

> **Use a domain or subdomain root, not a subfolder.** The prebuilt frontend
> references `/assets/...` with absolute paths, so the app must answer at
> `https://your-domain/` (or `https://faranani.your-domain/`). Deploying under
> `https://your-domain/faranani/` needs a rebuild with a Vite `base` setting.

## 4. Install dependencies

On the application row click **Run NPM Install** (this runs `npm install` in the
application root). If you prefer the terminal:

```bash
source /home/YOURUSER/nodevenv/faranani/24/bin/activate
cd ~/faranani
npm install --omit=dev
```

The app only needs the four runtime packages already listed in `package.json`
(`express`, `cookie-parser`, `dotenv`, `multer`); `--omit=dev` skips the build
tooling, which is not needed because the frontend is prebuilt.

## 5. Make the writable folders writable

Set permissions on these two folders to **755** (File Manager → right-click →
Change Permissions), owner = your cPanel user:

- `server/data` — SQLite database (`faranani.db`) is created here on first start
- `uploads` — uploaded documents

If these are not writable the app starts but throws `SQLITE_CANTOPEN` or
`EACCES` when saving.

## 6. Restart and open the site

Click **Restart** on the application, then visit **https://your-domain**.

Sign in with the seeded administrator account:

- Email: `admin@farananigroup.co.za`
- Password: `Faranani2026#`

**Change this password immediately** after the first login.

### HTTPS is mandatory

In production mode the session cookie is set with the `Secure` flag, so the
browser will discard it over plain `http://` and login will appear to do nothing.
Enable **SSL/TLS Status → Run AutoSSL** for the domain and always use
`https://`.

## 7. Data and backups

The SQLite database lives at `server/data/faranani.db` (plus `-wal` / `-shm`
side files while running). Back it up by downloading those files, or by adding an
external path in `.env`:

```
FG_DB_PATH=/home/YOURUSER/faranani-data/faranani.db
```

Keeping the database outside the application folder means redeploying code never
touches your live data. Create the folder first and make it writable.

## 8. Deploying updates

1. Upload the new bundle (new `dist/` and `server/` files).
2. **Do not** overwrite `server/data/` or `uploads/` — that is your live data.
3. Click **Restart** in Setup Node.js App.

## 9. Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| 503 “Application is not running” | Startup file must be `server/index.js`; run NPM Install; check the error log in Setup Node.js App |
| `No such built-in module: node:sqlite` | Node version too old — switch to 22.13+ / 24.x and restart |
| Login does not stick, no error shown | Site opened over http:// — use https:// (Secure cookie) |
| `SQLITE_CANTOPEN` / `EACCES` | `server/data` (or the `FG_DB_PATH` folder) is not writable |
| Blank page, assets 404 | `dist/` was not uploaded, or the app root is one folder too high/low |
| Blank page only at a subfolder URL | App deployed under a path instead of a domain root — move it to its own subdomain, or rebuild with a matching Vite `base` |
| 500 on every `/api` call | Check the Node.js App log; usually a missing `.env` value or an unwritable database |

Logs: cPanel → **Setup Node.js App** shows stderr, and `~/logs/` or
`stderr.log` in the application root holds Passenger output.
