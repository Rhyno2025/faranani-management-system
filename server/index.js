// ---------------------------------------------------------------------------
// Faranani Property Group — application server
// ---------------------------------------------------------------------------
import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ensureSchema, db } from './db.js';
import { seedBase } from './seed-base.js';
import { seedConfig } from './seed-config.js';
import { requireAuth, attachSession } from './auth.js';
import { coreRouter } from './routes/core.js';
import { eduRouter } from './routes/edu.js';
import { propsRouter } from './routes/props.js';
import { opsRouter } from './routes/ops.js';
import { financeRouter } from './routes/finance.js';
import { hrRouter } from './routes/hr.js';
import { accountingRouter } from './routes/accounting.js';
import { officeRouter } from './routes/office.js';
import { calvinRouter } from './routes/calvin.js';
import { settingsRouter } from './routes/settings.js';
import { reportsRouter } from './routes/reports.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3001;

ensureSchema();
seedBase();
seedConfig();

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

// Request logging (excluding static assets)
app.use((req, res, next) => {
  if (req.path.startsWith('/api') && process.env.NODE_ENV !== 'test') {
    const start = Date.now();
    res.on('finish', () => {
      if (res.statusCode >= 400) {
        console.log(`${req.method} ${req.path} → ${res.statusCode} (${Date.now() - start}ms)`);
      }
    });
  }
  next();
});

// Health check (first — unauthenticated probes must succeed)
app.get('/api/health', (req, res) => {
  const students = db.prepare("SELECT COUNT(*) AS c FROM students WHERE status != 'archived'").get().c;
  res.json({ ok: true, service: 'faranani-api', time: new Date().toISOString(), students });
});

// opsRouter attaches a session when present (protected routes still enforce
// requirePerm) but allows anonymous public complaint submission.
app.use('/api', attachSession, opsRouter);
app.use('/api', coreRouter);

app.use('/api', requireAuth, eduRouter);
app.use('/api', requireAuth, propsRouter);
app.use('/api', requireAuth, financeRouter);
app.use('/api', requireAuth, officeRouter);
app.use('/api', requireAuth, hrRouter);
app.use('/api', requireAuth, accountingRouter);
app.use('/api', requireAuth, calvinRouter);
app.use('/api', requireAuth, settingsRouter);
app.use('/api', requireAuth, reportsRouter);

// Unknown API routes
app.use('/api', (req, res) => res.status(404).json({ error: `Unknown endpoint: ${req.method} ${req.path}` }));

// Production: serve the built frontend
const dist = path.join(__dirname, '..', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/.*/, (req, res, next) => {
    if (req.method !== 'GET') return next();
    res.sendFile(path.join(dist, 'index.html'));
  });
}

// Central error handler — never leaks internals to the client
app.use((err, req, res, next) => {
  const status = err.status || (err.name === 'MulterError' ? 400 : 500);
  if (status >= 500) console.error('[error]', err);
  res.status(status).json({ error: err.message || 'Something went wrong. Please try again.' });
});

app.listen(PORT, () => {
  console.log(`Faranani API listening on http://localhost:${PORT}`);
  console.log(`Database: ${process.env.FG_DB_PATH || 'server/data/faranani.db'}`);
});
