// ---------------------------------------------------------------------------
// Faranani Property Group — shared server utilities
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, newId, now } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export const TIMEZONE = 'Africa/Johannesburg';

/** Async express handler wrapper — forwards errors to the error middleware. */
export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Standard list endpoint params. */
export function listParams(req) {
  const q = String(req.query.q || '').trim();
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(200, Math.max(5, parseInt(req.query.pageSize, 10) || 25));
  const sort = String(req.query.sort || '').trim();
  const dir = String(req.query.dir || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  return { q, page, pageSize, offset: (page - 1) * pageSize, sort, dir };
}

export function paginated(rows, total, page, pageSize) {
  return {
    data: rows,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
  };
}

/** Escape a user search string for use in a LIKE clause. */
export function likeTerm(q) {
  return `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
}

export function isBlank(v) {
  return v === undefined || v === null || String(v).trim() === '';
}

export function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function todayISO() {
  // Africa/Johannesburg date (UTC+2, no DST)
  return new Date(Date.now() + 2 * 3600 * 1000).toISOString().slice(0, 10);
}

/** Month key in SAST, e.g. "2026-10" */
export function monthKey(iso) {
  return String(iso || '').slice(0, 7);
}

export const CATEGORIES = [
  'Plumbing', 'Electrical', 'Cleaning', 'Security', 'Noise',
  'Room Conditions', 'Internet Access', 'Facilities', 'Other',
];

export const COMPLAINT_STATUSES = [
  'open', 'acknowledged', 'assigned', 'in_progress',
  'awaiting_student', 'escalated', 'resolved', 'closed',
];

export const PRIORITY_RULES = {
  // Working-hours escalation targets (hours)
  urgent: 4,
  high: 12,
  normal: 48,
  low: 96,
};

/** Create an in-app notification row. */
export function notify({ userId, studentId, type, title, body, link }) {
  db.prepare(
    'INSERT INTO notifications (id, user_id, student_id, type, title, body, link, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(newId(), userId ?? null, studentId ?? null, type, title, body ?? null, link ?? null, now());
}

/** Notify every user holding one of the given roles. */
export function notifyRoles(roles, payload) {
  const placeholders = roles.map(() => '?').join(',');
  const users = db.prepare(`SELECT id FROM users WHERE status = 'active' AND role IN (${placeholders})`).all(...roles);
  for (const u of users) notify({ ...payload, userId: u.id });
}

export function setSetting(key, value, updatedBy) {
  db.prepare(
    `INSERT INTO system_settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`
  ).run(key, JSON.stringify(value), updatedBy ?? null, now());
}

export function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM system_settings WHERE key = ?').get(key);
  if (!row) return fallback;
  try { return JSON.parse(row.value); } catch { return fallback; }
}

/** Streaming CSV export with correct headers. */
export function sendCsv(res, filename, headers, rows) {
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(esc).join(',')];
  for (const r of rows) lines.push(headers.map((h) => esc(r[h])).join(','));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('﻿' + lines.join('\r\n'));
}

/** Allowed upload types & 15 MB limit. */
export const ALLOWED_MIME = new Set([
  'application/pdf', 'image/jpeg', 'image/png', 'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain', 'text/csv',
]);
export const MAX_UPLOAD_MB = 15;

export function storedFileName(original) {
  const safe = String(original).replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safe}`;
}

/** Guard: string field required. */
export function requireFields(body, fields) {
  const missing = fields.filter((f) => isBlank(body?.[f]));
  if (missing.length) {
    const err = new Error(`Missing required fields: ${missing.join(', ')}`);
    err.status = 400;
    throw err;
  }
}
