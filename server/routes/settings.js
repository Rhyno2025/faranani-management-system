// ---------------------------------------------------------------------------
// Faranani Property Group — Administration & Settings API
//
//   /settings/overview          super-admin control centre statistics
//   /settings/security          lockout / session / password policy
//   /settings/voice             CALVIN voice + memory configuration
//   /settings/memory            long-term memory records
//   /settings/api-configs       AI / email / integration credentials (encrypted)
//   /settings/api-configs/test  connection test without saving
//   /settings/departments       department administration with usage counts
//   /settings/login-events      authentication activity for the security view
// ---------------------------------------------------------------------------
import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { db, newId, now, audit } from '../db.js';
import { requireAuth, requirePerm, securityPolicy } from '../auth.js';
import { getSetting, setSetting } from '../util.js';
import { encryptSecret, decryptSecret, secretHint } from '../crypto.js';
import { PROVIDERS, providerLabel, testProvider, normalizeConfig } from '../ai.js';

export const settingsRouter = Router();

settingsRouter.use(requireAuth);

const isAdmin = (req) => req.permissions?.includes('users.manage') || req.permissions?.includes('settings.manage');

// ------------------------------- overview ----------------------------------

settingsRouter.get('/settings/overview', requirePerm('users.manage', 'settings.manage', 'audit.view'), (req, res) => {
  const count = (sql, ...args) => db.prepare(sql).get(...args).c;
  const usersByStatus = db.prepare('SELECT status, COUNT(*) c FROM users GROUP BY status').all();
  const usersByRole = db.prepare('SELECT role, COUNT(*) c FROM users GROUP BY role ORDER BY c DESC').all();
  const usersByDepartment = db.prepare(`
    SELECT COALESCE(NULLIF(s.department, ''), NULLIF(u.department, ''), 'Unassigned') AS department,
      COUNT(*) c
    FROM users u LEFT JOIN staff s ON s.id = u.staff_id
    GROUP BY 1 ORDER BY c DESC
  `).all();
  const recentLogins = db.prepare(`
    SELECT l.id, l.email, l.success, l.reason, l.ip, l.created_at, u.full_name
    FROM login_events l LEFT JOIN users u ON u.id = l.user_id
    ORDER BY l.created_at DESC LIMIT 12
  `).all();
  const recentAccounts = db.prepare(`
    SELECT u.id, u.full_name, u.email, u.role, u.status, u.created_at,
      COALESCE(s.department, u.department) AS department
    FROM users u LEFT JOIN staff s ON s.id = u.staff_id
    ORDER BY u.created_at DESC LIMIT 6
  `).all();
  const failed24h = count(
    "SELECT COUNT(*) c FROM login_events WHERE success = 0 AND created_at >= ?",
    new Date(Date.now() - 24 * 3600 * 1000).toISOString()
  );
  const lockedAccounts = db.prepare(
    'SELECT id, email, full_name, locked_until FROM users WHERE locked_until IS NOT NULL AND locked_until > ?'
  ).all(new Date().toISOString());
  const suspicious = db.prepare(`
    SELECT email, COUNT(*) c FROM login_events
    WHERE success = 0 AND created_at >= ? GROUP BY email HAVING c >= 3 ORDER BY c DESC LIMIT 5
  `).all(new Date(Date.now() - 24 * 3600 * 1000).toISOString());
  const recentChanges = db.prepare(`
    SELECT action, summary, user_email, created_at FROM audit_logs
    WHERE action LIKE 'user.%' OR action LIKE 'role.%' OR action LIKE 'settings.%'
      OR action LIKE 'api_config.%' OR action LIKE 'department.%'
    ORDER BY created_at DESC LIMIT 10
  `).all();
  const statusMap = Object.fromEntries(usersByStatus.map((r) => [r.status, r.c]));

  res.json({
    users: {
      total: count('SELECT COUNT(*) c FROM users'),
      active: statusMap.active || 0,
      suspended: statusMap.suspended || 0,
      deactivated: statusMap.deactivated || 0,
    },
    departments: count('SELECT COUNT(*) c FROM departments'),
    failed_logins_24h: failed24h,
    locked_accounts: lockedAccounts,
    suspicious_emails: suspicious,
    recent_logins: recentLogins,
    recent_accounts: recentAccounts,
    recent_changes: recentChanges,
    users_by_role: usersByRole,
    users_by_department: usersByDepartment,
    generated_at: now(),
  });
});

// ------------------------------- security ----------------------------------

const SECURITY_KEYS = [
  'max_failed_attempts', 'lockout_minutes', 'session_hours',
  'min_password_length', 'require_strong_password', 'mfa_available',
];

settingsRouter.get('/settings/security', requirePerm('settings.manage'), (req, res) => {
  res.json({
    policy: securityPolicy(),
    sessions_active: db.prepare('SELECT COUNT(*) c FROM sessions WHERE expires_at > ?').get(new Date().toISOString()).c,
    failed_24h: db.prepare('SELECT COUNT(*) c FROM login_events WHERE success = 0 AND created_at >= ?')
      .get(new Date(Date.now() - 24 * 3600 * 1000).toISOString()).c,
    locked: db.prepare('SELECT COUNT(*) c FROM users WHERE locked_until IS NOT NULL AND locked_until > ?')
      .get(new Date().toISOString()).c,
  });
});

settingsRouter.post('/settings/security', requirePerm('settings.manage'), (req, res) => {
  const body = req.body || {};
  const next = { ...securityPolicy() };
  for (const key of SECURITY_KEYS) {
    if (body[key] === undefined) continue;
    if (key === 'require_strong_password' || key === 'mfa_available') next[key] = Boolean(body[key]);
    else next[key] = Math.max(1, Math.min(100000, Number(body[key]) || next[key]));
  }
  if (next.max_failed_attempts < 1) return res.status(400).json({ error: 'Failed attempt limit must be at least 1.' });
  if (next.lockout_minutes < 1) return res.status(400).json({ error: 'Lockout period must be at least 1 minute.' });
  setSetting('security', next, req.user.id);
  audit({
    userId: req.user.id, userEmail: req.user.email, action: 'settings.security',
    summary: `Updated security policy (lockout ${next.max_failed_attempts} attempts / ${next.lockout_minutes} min)`, ip: req.ip,
  });
  res.json({ ok: true, policy: next });
});

// ---------------------------- CALVIN voice ---------------------------------

const VOICE_DEFAULTS = {
  input_enabled: true,
  output_enabled: true,
  recognition_language: 'en-ZA',
  voice_name: '',
  speech_rate: 1,
  speech_pitch: 0.92,
  wake_word_enabled: false,
  wake_word: 'calvin',
  text_to_speech_provider: 'browser',
  speech_to_text_provider: 'browser',
};

const MEMORY_DEFAULTS = {
  enabled: true,
  user_memory: true,
  department_memory: false,
  retention_days: 365,
  max_entries_per_user: 100,
};

settingsRouter.get('/settings/voice', requireAuth, (req, res) => {
  const voice = getSetting('calvin_voice') || {};
  const memory = getSetting('calvin_memory') || {};
  res.json({
    voice: { ...VOICE_DEFAULTS, ...voice },
    memory: { ...MEMORY_DEFAULTS, ...memory },
    memory_count: db.prepare('SELECT COUNT(*) c FROM calvin_memory').get().c,
  });
});

settingsRouter.post('/settings/voice', requirePerm('settings.manage'), (req, res) => {
  const body = req.body || {};
  if (body.voice !== undefined) {
    const voice = { ...VOICE_DEFAULTS, ...getSetting('calvin_voice'), ...body.voice };
    voice.speech_rate = Math.min(2, Math.max(0.5, Number(voice.speech_rate) || 1));
    voice.speech_pitch = Math.min(2, Math.max(0.5, Number(voice.speech_pitch) || 0.92));
    setSetting('calvin_voice', voice, req.user.id);
  }
  if (body.memory !== undefined) {
    const memory = { ...MEMORY_DEFAULTS, ...getSetting('calvin_memory'), ...body.memory };
    memory.retention_days = Math.max(1, Math.min(3650, Number(memory.retention_days) || 365));
    memory.max_entries_per_user = Math.max(1, Math.min(1000, Number(memory.max_entries_per_user) || 100));
    setSetting('calvin_memory', memory, req.user.id);
  }
  audit({
    userId: req.user.id, userEmail: req.user.email, action: 'settings.voice',
    summary: 'Updated CALVIN voice and memory configuration', ip: req.ip,
  });
  res.json({
    ok: true,
    voice: { ...VOICE_DEFAULTS, ...getSetting('calvin_voice') },
    memory: { ...MEMORY_DEFAULTS, ...getSetting('calvin_memory') },
  });
});

// ---------------------------- CALVIN memory --------------------------------

settingsRouter.get('/settings/memory', requireAuth, (req, res) => {
  const targetUser = isAdmin(req) && req.query.user_id ? String(req.query.user_id) : req.user.id;
  const rows = db.prepare(`
    SELECT m.*, u.full_name, u.email FROM calvin_memory m
    LEFT JOIN users u ON u.id = m.user_id
    WHERE m.user_id = ? OR (m.scope = 'department' AND ? = 1)
    ORDER BY m.updated_at DESC LIMIT 200
  `).all(targetUser, isAdmin(req) ? 1 : 0);
  res.json({ data: rows });
});

settingsRouter.delete('/settings/memory/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM calvin_memory WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Memory entry not found.' });
  if (row.user_id !== req.user.id && !isAdmin(req)) {
    return res.status(403).json({ error: 'You can only delete your own memory entries.' });
  }
  db.prepare('DELETE FROM calvin_memory WHERE id = ?').run(row.id);
  audit({
    userId: req.user.id, userEmail: req.user.email, action: 'calvin.memory.delete',
    entityType: 'calvin_memory', entityId: row.id, summary: `Deleted CALVIN memory "${row.memory_key}"`, ip: req.ip,
  });
  res.json({ ok: true });
});

// --------------------------- API configurations ----------------------------

function serializeConfig(row) {
  return {
    id: row.id,
    kind: row.kind,
    provider: row.provider,
    provider_label: providerLabel(row.provider),
    name: row.name,
    base_url: row.base_url || '',
    model: row.model || '',
    api_version: row.api_version || '',
    org_id: row.org_id || '',
    extra_headers: row.extra_headers || '',
    max_tokens: row.max_tokens,
    temperature: row.temperature,
    timeout_ms: row.timeout_ms,
    enabled: Boolean(row.enabled),
    is_primary: Boolean(row.is_primary),
    is_backup: Boolean(row.is_backup),
    has_key: Boolean(row.api_key_enc),
    key_hint: secretHint(row.api_key_enc),
    last_test_at: row.last_test_at,
    last_test_status: row.last_test_status,
    last_test_message: row.last_test_message,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

settingsRouter.get('/settings/api-configs', requirePerm('settings.manage'), (req, res) => {
  const kind = String(req.query.kind || '').trim();
  const rows = kind
    ? db.prepare('SELECT * FROM api_configs WHERE kind = ? ORDER BY is_primary DESC, name').all(kind)
    : db.prepare('SELECT * FROM api_configs ORDER BY kind, is_primary DESC, name').all();
  res.json({ data: rows.map(serializeConfig), providers: PROVIDERS });
});

function validateConfigBody(b, res) {
  if (!b.name || !String(b.name).trim()) { res.status(400).json({ error: 'Configuration name is required.' }); return false; }
  if (!b.provider || !String(b.provider).trim()) { res.status(400).json({ error: 'Provider is required.' }); return false; }
  if (!b.base_url || !/^https?:\/\//i.test(String(b.base_url))) {
    res.status(400).json({ error: 'A valid base URL starting with http:// or https:// is required.' }); return false;
  }
  return true;
}

settingsRouter.post('/settings/api-configs', requirePerm('settings.manage'), (req, res) => {
  const b = req.body || {};
  if (!validateConfigBody(b, res)) return;

  const id = newId();
  const t = now();
  const kind = String(b.kind || 'ai');
  if (kind === 'ai' && b.is_primary) {
    db.prepare("UPDATE api_configs SET is_primary = 0 WHERE kind = 'ai'").run();
  }
  db.prepare(`
    INSERT INTO api_configs (id, kind, provider, name, base_url, api_key_enc, model, api_version,
      org_id, extra_headers, max_tokens, temperature, timeout_ms, enabled, is_primary, is_backup,
      created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, kind, String(b.provider).trim(), String(b.name).trim(), String(b.base_url).trim(),
    encryptSecret(b.api_key), b.model || null, b.api_version || null, b.org_id || null,
    b.extra_headers ? (typeof b.extra_headers === 'string' ? b.extra_headers : JSON.stringify(b.extra_headers)) : null,
    b.max_tokens ? Number(b.max_tokens) : null,
    b.temperature === '' || b.temperature === undefined || b.temperature === null ? null : Number(b.temperature),
    Number(b.timeout_ms) || 45000, b.enabled === false ? 0 : 1,
    b.is_primary ? 1 : 0, b.is_backup ? 1 : 0, req.user.id, t, t
  );
  audit({
    userId: req.user.id, userEmail: req.user.email, action: 'api_config.create',
    entityType: 'api_config', entityId: id,
    summary: `Added ${kind} configuration "${b.name}" (${b.provider})`, ip: req.ip,
  });
  res.status(201).json(serializeConfig(db.prepare('SELECT * FROM api_configs WHERE id = ?').get(id)));
});

settingsRouter.patch('/settings/api-configs/:id', requirePerm('settings.manage'), (req, res) => {
  const existing = db.prepare('SELECT * FROM api_configs WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Configuration not found.' });
  const b = req.body || {};
  const sets = []; const args = [];
  const textFields = ['provider', 'name', 'base_url', 'model', 'api_version', 'org_id'];
  for (const f of textFields) {
    if (b[f] !== undefined) { sets.push(`${f} = ?`); args.push(b[f] === '' ? null : String(b[f]).trim()); }
  }
  if (b.extra_headers !== undefined) {
    sets.push('extra_headers = ?');
    args.push(b.extra_headers ? (typeof b.extra_headers === 'string' ? b.extra_headers : JSON.stringify(b.extra_headers)) : null);
  }
  if (b.api_key !== undefined && b.api_key !== '') {
    sets.push('api_key_enc = ?'); args.push(encryptSecret(b.api_key));
    sets.push('last_test_at = NULL'); sets.push('last_test_status = NULL'); sets.push('last_test_message = NULL');
  }
  if (b.clear_key) { sets.push('api_key_enc = NULL'); }
  if (b.max_tokens !== undefined) { sets.push('max_tokens = ?'); args.push(b.max_tokens === '' ? null : Number(b.max_tokens)); }
  if (b.temperature !== undefined) { sets.push('temperature = ?'); args.push(b.temperature === '' ? null : Number(b.temperature)); }
  if (b.timeout_ms !== undefined) { sets.push('timeout_ms = ?'); args.push(Number(b.timeout_ms) || 45000); }
  if (b.enabled !== undefined) { sets.push('enabled = ?'); args.push(b.enabled ? 1 : 0); }
  if (b.is_backup !== undefined) { sets.push('is_backup = ?'); args.push(b.is_backup ? 1 : 0); }
  if (b.is_primary !== undefined) {
    if (b.is_primary && existing.kind === 'ai') {
      db.prepare("UPDATE api_configs SET is_primary = 0 WHERE kind = 'ai' AND id != ?").run(existing.id);
    }
    sets.push('is_primary = ?'); args.push(b.is_primary ? 1 : 0);
  }
  if (!sets.length) return res.json(serializeConfig(existing));
  sets.push('updated_at = ?'); args.push(now(), existing.id);
  db.prepare(`UPDATE api_configs SET ${sets.join(', ')} WHERE id = ?`).run(...args);
  audit({
    userId: req.user.id, userEmail: req.user.email, action: 'api_config.update',
    entityType: 'api_config', entityId: existing.id,
    summary: `Updated ${existing.kind} configuration "${existing.name}"${b.api_key ? ' (key rotated)' : ''}`, ip: req.ip,
  });
  res.json(serializeConfig(db.prepare('SELECT * FROM api_configs WHERE id = ?').get(existing.id)));
});

settingsRouter.delete('/settings/api-configs/:id', requirePerm('settings.manage'), (req, res) => {
  const existing = db.prepare('SELECT * FROM api_configs WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Configuration not found.' });
  db.prepare('DELETE FROM api_configs WHERE id = ?').run(existing.id);
  audit({
    userId: req.user.id, userEmail: req.user.email, action: 'api_config.delete',
    entityType: 'api_config', entityId: existing.id,
    summary: `Removed ${existing.kind} configuration "${existing.name}"`, ip: req.ip,
  });
  res.json({ ok: true });
});

/** Generic credential/endpoint probe for non-AI integrations. */
async function testHttpEndpoint(config) {
  const started = Date.now();
  const cfg = normalizeConfig(config);
  if (!cfg.baseUrl) return { ok: false, status: 'invalid_url', message: 'A base URL is required.' };
  if (!cfg.apiKey) return { ok: false, status: 'missing_key', message: 'No API key is stored for this configuration.' };
  let url = cfg.baseUrl;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${cfg.apiKey}`, ...cfg.extraHeaders },
      signal: AbortSignal.timeout(cfg.timeoutMs),
    });
    const elapsed = Date.now() - started;
    if (res.status === 401 || res.status === 403) {
      return { ok: false, status: 'invalid_key', message: `Endpoint reachable but the key was rejected (HTTP ${res.status}).`, elapsed_ms: elapsed };
    }
    if (res.status === 404) {
      return { ok: false, status: 'invalid_url', message: 'Endpoint not found (HTTP 404). Check the base URL.', elapsed_ms: elapsed };
    }
    if (res.status === 429) {
      return { ok: false, status: 'rate_limited', message: 'Rate limit exceeded (HTTP 429).', elapsed_ms: elapsed };
    }
    if (res.status >= 500) {
      return { ok: false, status: 'provider_error', message: `Provider error (HTTP ${res.status}).`, elapsed_ms: elapsed };
    }
    return { ok: true, status: 'connected', message: `Endpoint reachable (HTTP ${res.status}).`, elapsed_ms: elapsed };
  } catch (e) {
    const status = e.name === 'TimeoutError' || e.name === 'AbortError' ? 'timeout' : 'network';
    return { ok: false, status, message: `Could not reach the endpoint: ${e.message}`, elapsed_ms: Date.now() - started };
  }
}

async function runTest(config) {
  if ((config.kind || 'ai') === 'ai') return testProvider(config);
  return testHttpEndpoint(config);
}

settingsRouter.post('/settings/api-configs/test', requirePerm('settings.manage'), async (req, res) => {
  const b = req.body || {};
  if (!b.base_url) return res.status(400).json({ error: 'A base URL is required to run a connection test.' });
  const result = await runTest({
    provider: b.provider, base_url: b.base_url, api_key: b.api_key,
    model: b.model, api_version: b.api_version, org_id: b.org_id,
    extra_headers: b.extra_headers, max_tokens: b.max_tokens,
    temperature: b.temperature, timeout_ms: b.timeout_ms, kind: b.kind,
  });
  audit({
    userId: req.user.id, userEmail: req.user.email, action: 'api_config.test',
    entityType: 'api_config', entityId: b.provider || 'unknown',
    summary: `Connection test (${b.provider || 'unknown'}) → ${result.status}`, ip: req.ip,
  });
  res.json(result);
});

settingsRouter.post('/settings/api-configs/:id/test', requirePerm('settings.manage'), async (req, res) => {
  const row = db.prepare('SELECT * FROM api_configs WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Configuration not found.' });
  const apiKey = decryptSecret(row.api_key_enc);
  const result = await runTest({ ...row, api_key: apiKey });
  db.prepare('UPDATE api_configs SET last_test_at = ?, last_test_status = ?, last_test_message = ?, updated_at = ? WHERE id = ?')
    .run(now(), result.status, result.message, now(), row.id);
  audit({
    userId: req.user.id, userEmail: req.user.email, action: 'api_config.test',
    entityType: 'api_config', entityId: row.id,
    summary: `Tested "${row.name}" → ${result.status}`, details: { message: result.message }, ip: req.ip,
  });
  res.json(result);
});

// ------------------------------ departments --------------------------------

settingsRouter.get('/settings/departments', requirePerm('settings.manage', 'users.manage'), (req, res) => {
  const rows = db.prepare(`
    SELECT d.*,
      (SELECT COUNT(*) FROM staff s WHERE s.department = d.name AND s.archived_at IS NULL) AS staff_count,
      (SELECT COUNT(*) FROM users u LEFT JOIN staff s ON s.id = u.staff_id
        WHERE COALESCE(s.department, u.department) = d.name) AS user_count
    FROM departments d ORDER BY d.name
  `).all();
  res.json({ data: rows });
});

settingsRouter.post('/settings/departments', requirePerm('settings.manage'), (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Department name is required.' });
  if (db.prepare('SELECT id FROM departments WHERE lower(name) = lower(?)').get(name)) {
    return res.status(409).json({ error: 'That department already exists.' });
  }
  const id = newId();
  db.prepare('INSERT INTO departments (id, name, code, description, dashboard_route, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, name, req.body?.code || null, req.body?.description || null, req.body?.dashboard_route || '/dashboard', now());
  audit({
    userId: req.user.id, userEmail: req.user.email, action: 'department.create',
    entityType: 'department', entityId: id, summary: `Created department ${name}`, ip: req.ip,
  });
  res.status(201).json(db.prepare('SELECT * FROM departments WHERE id = ?').get(id));
});

settingsRouter.patch('/settings/departments/:id', requirePerm('settings.manage'), (req, res) => {
  const existing = db.prepare('SELECT * FROM departments WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Department not found.' });
  const b = req.body || {};
  const sets = []; const args = [];
  for (const f of ['name', 'code', 'description', 'dashboard_route']) {
    if (b[f] !== undefined) { sets.push(`${f} = ?`); args.push(b[f] === '' ? null : String(b[f]).trim()); }
  }
  if (!sets.length) return res.json(existing);
  args.push(existing.id);
  db.prepare(`UPDATE departments SET ${sets.join(', ')} WHERE id = ?`).run(...args);
  if (b.name && b.name !== existing.name) {
    db.prepare('UPDATE staff SET department = ? WHERE department = ?').run(String(b.name).trim(), existing.name);
    db.prepare('UPDATE users SET department = ? WHERE department = ?').run(String(b.name).trim(), existing.name);
  }
  audit({
    userId: req.user.id, userEmail: req.user.email, action: 'department.update',
    entityType: 'department', entityId: existing.id, summary: `Updated department ${existing.name}`, ip: req.ip,
  });
  res.json(db.prepare('SELECT * FROM departments WHERE id = ?').get(existing.id));
});

settingsRouter.delete('/settings/departments/:id', requirePerm('settings.manage'), (req, res) => {
  const existing = db.prepare('SELECT * FROM departments WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Department not found.' });
  const staff = db.prepare('SELECT COUNT(*) c FROM staff WHERE department = ?').get(existing.name).c;
  if (staff > 0) {
    return res.status(400).json({ error: `${staff} employee record(s) still belong to ${existing.name}. Transfer them before deleting.` });
  }
  db.prepare('DELETE FROM departments WHERE id = ?').run(existing.id);
  audit({
    userId: req.user.id, userEmail: req.user.email, action: 'department.delete',
    entityType: 'department', entityId: existing.id, summary: `Deleted department ${existing.name}`, ip: req.ip,
  });
  res.json({ ok: true });
});

// ------------------------------ login events -------------------------------

// --------------------------- database backup -------------------------------

settingsRouter.get('/settings/backup', requirePerm('settings.manage'), (req, res, next) => {
  try {
    const dir = path.join(process.cwd(), 'server', 'data', 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const name = `faranani-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.db`;
    const file = path.join(dir, name);
    // VACUUM INTO produces a consistent snapshot, including WAL contents.
    db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    audit({
      userId: req.user.id, userEmail: req.user.email, action: 'settings.backup',
      entityType: 'database', entityId: name, summary: `Downloaded database backup ${name}`, ip: req.ip,
    });
    res.download(file, name, () => {
      try { fs.unlinkSync(file); } catch { /* already removed */ }
    });
  } catch (e) {
    next(e);
  }
});

settingsRouter.get('/settings/login-events', requirePerm('users.manage', 'audit.view'), (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const success = req.query.success === undefined || req.query.success === '' ? null : String(req.query.success) === '1';
  const where = ['1=1']; const args = [];
  if (success !== null) { where.push('l.success = ?'); args.push(success ? 1 : 0); }
  if (req.query.user_id) { where.push('l.user_id = ?'); args.push(String(req.query.user_id)); }
  const rows = db.prepare(`
    SELECT l.*, u.full_name FROM login_events l LEFT JOIN users u ON u.id = l.user_id
    WHERE ${where.join(' AND ')} ORDER BY l.created_at DESC LIMIT ?
  `).all(...args, limit);
  res.json({ data: rows });
});
