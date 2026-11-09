// ---------------------------------------------------------------------------
// Core routes: authentication, user & role administration, staff, staff-task
// assignments, notifications, documents (private storage + permission-checked
// download), audit logs, system settings and global search.
// ---------------------------------------------------------------------------
import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { db, newId, nextRef, now, hashPassword, audit, tx } from '../db.js';
import {
  requireAuth, requirePerm, can, login, logout, resolveSession,
  setSessionCookie, clearSessionCookie, parseCookies,
  validatePassword, revokeSessions, changePassword,
} from '../auth.js';
import {
  permissionsForRole, resolveUserPermissions as resolvePerms, ROLES, PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS, ALL_PERMISSION_KEYS,
} from '../rbac.js';
import {
  ah, listParams, paginated, likeTerm, isBlank, num, todayISO,
  UPLOAD_DIR, ALLOWED_MIME, MAX_UPLOAD_MB, storedFileName, getSetting, setSetting,
} from '../util.js';

export const coreRouter = Router();

// ------------------------------ auth ---------------------------------------

coreRouter.post('/auth/login', ah(async (req, res) => {
  const { email, password } = req.body || {};
  if (isBlank(email) || isBlank(password)) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }
  const result = login(email, password, req);
  if (result.error) return res.status(401).json({ error: result.error });
  setSessionCookie(res, result.token);
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(result.user.id);
  res.json({
    user: result.user,
    permissions: resolvePerms(db, row),
  });
}));

coreRouter.post('/auth/logout', ah(async (req, res) => {
  logout(parseCookies(req).fg_session, req);
  clearSessionCookie(res);
  res.json({ ok: true });
}));

coreRouter.get('/auth/me', ah(async (req, res) => {
  const token = parseCookies(req).fg_session;
  const session = resolveSession(token);
  if (!session) return res.status(401).json({ error: 'Not signed in.' });
  res.json(session);
}));

// Change your own password (also clears the forced-change flag).
coreRouter.post('/auth/change-password', requireAuth, ah(async (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (isBlank(current_password) || isBlank(new_password)) {
    return res.status(400).json({ error: 'Current and new password are required.' });
  }
  const result = changePassword(req.user.id, current_password, new_password);
  if (result.error) return res.status(400).json({ error: result.error });
  revokeSessions(req.user.id, req.sessionToken);
  audit({
    userId: req.user.id, userEmail: req.user.email, action: 'auth.password_change',
    entityType: 'user', entityId: req.user.id, summary: `${req.user.full_name} changed their password`, ip: req.ip,
  });
  res.json({ ok: true });
}));

// Everything below requires an authenticated session; requirePerm then
// enforces the per-route permission grants.
coreRouter.use(requireAuth);

// ------------------------------ staff --------------------------------------

coreRouter.get('/staff', requirePerm('staff.view'), ah(async (req, res) => {
  const { q, page, pageSize, offset } = listParams(req);
  const where = ['1=1']; const args = [];
  if (q) {
    where.push("(s.full_name LIKE ? ESCAPE '\\' OR s.employee_ref LIKE ? ESCAPE '\\' OR s.job_title LIKE ? ESCAPE '\\' OR s.department LIKE ? ESCAPE '\\')");
    const t = likeTerm(q); args.push(t, t, t, t);
  }
  const dept = String(req.query.department || '').trim();
  if (dept) { where.push('s.department = ?'); args.push(dept); }
  const status = String(req.query.status || '').trim();
  if (status) { where.push('s.employment_status = ?'); args.push(status); }
  const total = db.prepare(`SELECT COUNT(*) AS c FROM staff s WHERE ${where.join(' AND ')}`).get(...args).c;
  const rows = db.prepare(`
    SELECT s.*, p.name AS property_name,
      (SELECT COUNT(*) FROM tasks t WHERE t.assigned_to = s.id AND t.status NOT IN ('done','verified')) AS open_tasks,
      (SELECT COUNT(*) FROM maintenance_jobs m WHERE m.assigned_to = s.id AND m.status NOT IN ('verified','cancelled')) AS open_jobs
    FROM staff s LEFT JOIN properties p ON p.id = s.property_id
    WHERE ${where.join(' AND ')} ORDER BY s.full_name LIMIT ? OFFSET ?
  `).all(...args, pageSize, offset);
  res.json(paginated(rows, total, page, pageSize));
}));

coreRouter.post('/staff', requirePerm('staff.manage'), ah(async (req, res) => {
  const b = req.body || {};
  if (isBlank(b.full_name)) return res.status(400).json({ error: 'Full name is required.' });
  const id = newId();
  const ref = nextRef(db, 'FAR-EMP');
  const t = now();
  db.prepare(`
    INSERT INTO staff (id, employee_ref, full_name, job_title, department, email, phone, property_id, role,
      employment_status, hired_at, shift_notes, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, ref, b.full_name.trim(), b.job_title || null, b.department || null, b.email || null,
    b.phone || null, b.property_id || null, b.role || null, b.employment_status || 'active',
    b.hired_at || todayISO(), b.shift_notes || null, b.notes || null, t, t);
  audit({ userId: req.user.id, userEmail: req.user.email, action: 'staff.create',
    entityType: 'staff', entityId: id, summary: `Added staff ${ref} — ${b.full_name}`, ip: req.ip });
  res.status(201).json(db.prepare('SELECT * FROM staff WHERE id = ?').get(id));
}));

coreRouter.patch('/staff/:id', requirePerm('staff.manage'), ah(async (req, res) => {
  const existing = db.prepare('SELECT * FROM staff WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Staff member not found.' });
  const b = req.body || {};
  const fields = ['full_name', 'job_title', 'department', 'email', 'phone', 'property_id', 'role',
    'employment_status', 'hired_at', 'shift_notes', 'notes'];
  const sets = []; const args = [];
  for (const f of fields) {
    if (b[f] !== undefined) { sets.push(`${f} = ?`); args.push(b[f] === '' ? null : b[f]); }
  }
  if (!sets.length) return res.json(existing);
  sets.push('updated_at = ?'); args.push(now(), req.params.id);
  db.prepare(`UPDATE staff SET ${sets.join(', ')} WHERE id = ?`).run(...args);
  audit({ userId: req.user.id, userEmail: req.user.email, action: 'staff.update',
    entityType: 'staff', entityId: req.params.id, summary: `Updated staff ${existing.employee_ref}`, ip: req.ip });
  res.json(db.prepare('SELECT * FROM staff WHERE id = ?').get(req.params.id));
}));

// ------------------------------- users -------------------------------------

const USER_SELECT = `
  SELECT u.id, u.email, u.username, u.full_name, u.role, u.status, u.last_login_at, u.created_at,
    u.must_change_password, u.locked_until, u.failed_attempts, u.phone,
    u.department AS account_department, u.job_title AS account_job_title,
    s.id AS staff_id, s.employee_ref, s.job_title, s.department, s.phone AS staff_phone
  FROM users u LEFT JOIN staff s ON s.id = u.staff_id
`;

function decorateUser(row) {
  const revoked = db.prepare('SELECT permission_key FROM user_permission_overrides WHERE user_id = ? AND granted = 0')
    .all(row.id).map((r) => r.permission_key);
  return {
    ...row,
    department: row.department || row.account_department || null,
    job_title: row.job_title || row.account_job_title || null,
    phone: row.phone || row.staff_phone || null,
    permissions: resolvePerms(db, row),
    revoked_permissions: revoked,
  };
}

coreRouter.get('/users', requirePerm('users.manage'), ah(async (req, res) => {
  const rows = db.prepare(`${USER_SELECT} ORDER BY u.full_name`).all().map(decorateUser);
  res.json({ data: rows });
}));

coreRouter.post('/users', requirePerm('users.manage'), ah(async (req, res) => {
  const b = req.body || {};
  if (isBlank(b.email) || isBlank(b.password) || isBlank(b.full_name)) {
    return res.status(400).json({ error: 'Full name, email and password are required.' });
  }
  const strength = validatePassword(b.password);
  if (!strength.ok) return res.status(400).json({ error: strength.error });
  const role = ROLES.some((r) => r.name === b.role) ? b.role : null;
  if (!role) return res.status(400).json({ error: 'Choose a valid role for this employee.' });
  if (role === 'super_admin' && req.user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Only a Super Administrator can create another Super Administrator.' });
  }
  const email = String(b.email).trim().toLowerCase();
  if (db.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').get(email)) {
    return res.status(409).json({ error: 'A user with this email already exists.' });
  }
  if (b.username && db.prepare('SELECT id FROM users WHERE lower(coalesce(username, \'\')) = lower(?)').get(String(b.username).trim())) {
    return res.status(409).json({ error: 'That username is already taken.' });
  }

  const id = newId();
  const t = now();

  // Link or create the employee record so department/role routing works.
  let staffId = b.staff_id || null;
  if (staffId) {
    const staff = db.prepare('SELECT id FROM staff WHERE id = ?').get(staffId);
    if (!staff) staffId = null;
  }
  if (!staffId) {
    const byEmail = b.email ? db.prepare('SELECT id FROM staff WHERE lower(coalesce(email, \'\')) = lower(?)').get(email) : null;
    if (byEmail) staffId = byEmail.id;
  }
  if (!staffId && (b.department || b.job_title || b.employee_ref || b.phone)) {
    staffId = newId();
    const ref = isBlank(b.employee_ref) ? nextRef(db, 'FAR-EMP') : String(b.employee_ref).trim();
    db.prepare(`
      INSERT INTO staff (id, employee_ref, full_name, job_title, department, email, phone, role,
        employment_status, hired_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
    `).run(staffId, ref, String(b.full_name).trim(), b.job_title || null, b.department || null,
      email, b.phone || null, role, todayISO(), t, t);
  }

  db.prepare(`
    INSERT INTO users (id, email, username, password_hash, full_name, role, staff_id, status,
      must_change_password, phone, department, job_title, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)
  `).run(id, email, b.username ? String(b.username).trim() : null, hashPassword(b.password),
    String(b.full_name).trim(), role, staffId, b.must_change_password === false ? 0 : 1,
    b.phone || null, b.department || null, b.job_title || null, t, t);

  // Optional personal grants on top of the role.
  if (Array.isArray(b.permissions)) {
    const base = new Set(permissionsForRole(db, role));
    for (const key of b.permissions) {
      if (!ALL_PERMISSION_KEYS.includes(key) || base.has(key)) continue;
      db.prepare('INSERT OR REPLACE INTO user_permission_overrides (user_id, permission_key, granted) VALUES (?, ?, 1)')
        .run(id, key);
    }
  }

  audit({ userId: req.user.id, userEmail: req.user.email, action: 'user.create',
    entityType: 'user', entityId: id,
    summary: `Created employee account ${email} (${role}${b.department ? `, ${b.department}` : ''})`, ip: req.ip });
  const row = db.prepare(`${USER_SELECT} WHERE u.id = ?`).get(id);
  res.status(201).json({ id, email, username: b.username || null, user: decorateUser(row) });
}));

coreRouter.patch('/users/:id', requirePerm('users.manage'), ah(async (req, res) => {
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'User not found.' });
  const b = req.body || {};
  if (existing.id === req.user.id && b.status && b.status !== 'active') {
    return res.status(400).json({ error: 'You cannot deactivate your own account.' });
  }
  if (existing.id === req.user.id && b.role && b.role !== existing.role) {
    return res.status(400).json({ error: 'You cannot change your own role.' });
  }
  const sets = []; const args = [];
  if (b.full_name !== undefined) { sets.push('full_name = ?'); args.push(String(b.full_name).trim()); }
  if (b.email !== undefined) {
    const email = String(b.email).trim().toLowerCase();
    const dup = db.prepare('SELECT id FROM users WHERE lower(email) = lower(?) AND id != ?').get(email, existing.id);
    if (dup) return res.status(409).json({ error: 'Another account already uses that email.' });
    sets.push('email = ?'); args.push(email);
  }
  if (b.username !== undefined) {
    const username = b.username ? String(b.username).trim() : null;
    if (username) {
      const dup = db.prepare('SELECT id FROM users WHERE lower(coalesce(username, \'\')) = lower(?) AND id != ?').get(username, existing.id);
      if (dup) return res.status(409).json({ error: 'That username is already taken.' });
    }
    sets.push('username = ?'); args.push(username);
  }
  if (b.role !== undefined) {
    if (!ROLES.some((r) => r.name === b.role)) return res.status(400).json({ error: 'Invalid role.' });
    if (b.role === 'super_admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({ error: 'Only a Super Administrator can grant Super Administrator.' });
    }
    if (existing.role === 'super_admin' && b.role !== 'super_admin') {
      const remaining = db.prepare("SELECT COUNT(*) c FROM users WHERE role = 'super_admin' AND status = 'active' AND id != ?")
        .get(existing.id).c;
      if (remaining === 0) return res.status(400).json({ error: 'There must always be at least one active Super Administrator.' });
    }
    sets.push('role = ?'); args.push(b.role);
  }
  if (b.status !== undefined) {
    if (!['active', 'suspended', 'deactivated'].includes(b.status)) {
      return res.status(400).json({ error: 'Status must be active, suspended or deactivated.' });
    }
    if (existing.role === 'super_admin' && b.status !== 'active') {
      const remaining = db.prepare("SELECT COUNT(*) c FROM users WHERE role = 'super_admin' AND status = 'active' AND id != ?")
        .get(existing.id).c;
      if (remaining === 0) return res.status(400).json({ error: 'There must always be at least one active Super Administrator.' });
    }
    sets.push('status = ?'); args.push(b.status);
    if (b.status !== 'active') { sets.push('failed_attempts = 0'); sets.push('locked_until = NULL'); }
    revokeSessions(existing.id);
  }
  if (b.staff_id !== undefined) { sets.push('staff_id = ?'); args.push(b.staff_id || null); }
  if (b.phone !== undefined) { sets.push('phone = ?'); args.push(b.phone || null); }
  if (b.department !== undefined) { sets.push('department = ?'); args.push(b.department || null); }
  if (b.job_title !== undefined) { sets.push('job_title = ?'); args.push(b.job_title || null); }
  if (b.mfa_enabled !== undefined) { sets.push('mfa_enabled = ?'); args.push(b.mfa_enabled ? 1 : 0); }
  if (b.unlock) { sets.push('failed_attempts = 0'); sets.push('locked_until = NULL'); }
  if (b.password) {
    const strength = validatePassword(b.password);
    if (!strength.ok) return res.status(400).json({ error: strength.error });
    sets.push('password_hash = ?'); args.push(hashPassword(b.password));
    sets.push('must_change_password = 1');
    sets.push('last_password_change = ?'); args.push(now());
    revokeSessions(existing.id);
  }
  if (!sets.length) return res.json({ ok: true });
  sets.push('updated_at = ?'); args.push(now(), req.params.id);
  db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...args);

  // Mirror employee fields onto the linked staff record.
  if (existing.staff_id && (b.department !== undefined || b.job_title !== undefined || b.phone !== undefined || b.full_name !== undefined)) {
    const staffSets = []; const staffArgs = [];
    if (b.department !== undefined) { staffSets.push('department = ?'); staffArgs.push(b.department || null); }
    if (b.job_title !== undefined) { staffSets.push('job_title = ?'); staffArgs.push(b.job_title || null); }
    if (b.phone !== undefined) { staffSets.push('phone = ?'); staffArgs.push(b.phone || null); }
    if (b.full_name !== undefined) { staffSets.push('full_name = ?'); staffArgs.push(String(b.full_name).trim()); }
    if (staffSets.length) {
      staffSets.push('updated_at = ?'); staffArgs.push(now(), existing.staff_id);
      db.prepare(`UPDATE staff SET ${staffSets.join(', ')} WHERE id = ?`).run(...staffArgs);
    }
  }

  audit({ userId: req.user.id, userEmail: req.user.email, action: 'user.update',
    entityType: 'user', entityId: req.params.id,
    summary: `Updated user ${existing.email}${b.status ? ` → ${b.status}` : ''}${b.role ? ` (role ${b.role})` : ''}${b.department ? ` (department ${b.department})` : ''}`,
    details: b.password ? { password_reset: true } : undefined, ip: req.ip });
  res.json({ ok: true });
}));

coreRouter.delete('/users/:id', requirePerm('users.manage'), ah(async (req, res) => {
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'User not found.' });
  if (existing.id === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account.' });
  if (existing.role === 'super_admin') {
    const remaining = db.prepare("SELECT COUNT(*) c FROM users WHERE role = 'super_admin' AND status = 'active' AND id != ?")
      .get(existing.id).c;
    if (remaining === 0) return res.status(400).json({ error: 'There must always be at least one active Super Administrator.' });
  }
  revokeSessions(existing.id);
  db.prepare("UPDATE users SET status = 'deactivated', updated_at = ? WHERE id = ?").run(now(), existing.id);
  audit({ userId: req.user.id, userEmail: req.user.email, action: 'user.delete',
    entityType: 'user', entityId: existing.id, summary: `Deactivated account ${existing.email}`, ip: req.ip });
  res.json({ ok: true });
}));

coreRouter.post('/users/:id/reset-password', requirePerm('users.manage'), ah(async (req, res) => {
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'User not found.' });
  if (existing.id === req.user.id) return res.status(400).json({ error: 'Use Account settings to change your own password.' });
  if (existing.role === 'super_admin' && req.user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Only a Super Administrator can reset another Super Administrator.' });
  }
  const temp = req.body?.password || `Fg-${Math.random().toString(36).slice(2, 10)}!9`;
  const strength = validatePassword(temp);
  if (!strength.ok) return res.status(400).json({ error: strength.error });
  db.prepare(`UPDATE users SET password_hash = ?, must_change_password = 1, failed_attempts = 0,
    locked_until = NULL, last_password_change = ?, updated_at = ? WHERE id = ?`)
    .run(hashPassword(temp), now(), now(), existing.id);
  revokeSessions(existing.id);
  audit({ userId: req.user.id, userEmail: req.user.email, action: 'user.password_reset',
    entityType: 'user', entityId: existing.id, summary: `Reset password for ${existing.email}`, ip: req.ip });
  res.json({
    ok: true,
    temporary_password: temp,
    message: 'Share this temporary password with the employee. They must change it at first sign-in.',
  });
}));

coreRouter.get('/users/:id/permissions', requirePerm('users.manage'), ah(async (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  const roleBase = permissionsForRole(db, user.role);
  const overrides = db.prepare('SELECT permission_key, granted FROM user_permission_overrides WHERE user_id = ?').all(user.id);
  res.json({
    user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role },
    role_permissions: roleBase,
    overrides,
    effective: resolvePerms(db, user),
  });
}));

coreRouter.put('/users/:id/permissions', requirePerm('users.manage'), ah(async (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  if (user.role === 'super_admin') {
    return res.status(400).json({ error: 'A Super Administrator always has unrestricted access.' });
  }
  const desired = Array.isArray(req.body?.permissions) ? req.body.permissions : null;
  if (!desired) return res.status(400).json({ error: 'A permissions array is required.' });
  const invalid = desired.filter((k) => !ALL_PERMISSION_KEYS.includes(k));
  if (invalid.length) return res.status(400).json({ error: `Unknown permissions: ${invalid.join(', ')}` });

  const base = new Set(permissionsForRole(db, user.role));
  const target = new Set(desired);
  db.prepare('DELETE FROM user_permission_overrides WHERE user_id = ?').run(user.id);
  let granted = 0; let revoked = 0;
  for (const key of ALL_PERMISSION_KEYS) {
    const shouldHave = target.has(key);
    const baseHas = base.has(key);
    if (shouldHave === baseHas) continue;
    db.prepare('INSERT INTO user_permission_overrides (user_id, permission_key, granted) VALUES (?, ?, ?)')
      .run(user.id, key, shouldHave ? 1 : 0);
    if (shouldHave) granted += 1; else revoked += 1;
  }
  audit({ userId: req.user.id, userEmail: req.user.email, action: 'user.permissions',
    entityType: 'user', entityId: user.id,
    summary: `Updated permissions for ${user.email} (+${granted} granted, -${revoked} revoked)`, ip: req.ip });
  res.json({ ok: true, effective: resolvePerms(db, user), granted, revoked });
}));

coreRouter.get('/roles', requirePerm('users.manage'), ah(async (req, res) => {
  res.json({
    roles: ROLES,
    permissions: PERMISSIONS,
    defaults: DEFAULT_ROLE_PERMISSIONS,
    current: Object.fromEntries(ROLES.map((r) => [r.name, permissionsForRole(db, r.name)])),
  });
}));

coreRouter.get('/roles/:name/permissions', requireAuth, ah(async (req, res) => {
  res.json({ permissions: permissionsForRole(db, req.params.name) });
}));

coreRouter.put('/roles/:name/permissions', requirePerm('users.manage'), ah(async (req, res) => {
  const role = String(req.params.name || '');
  if (!ROLES.some((r) => r.name === role)) return res.status(404).json({ error: 'Role not found.' });
  if (role === 'super_admin') {
    return res.status(400).json({ error: 'The Super Administrator role always has unrestricted access.' });
  }
  const desired = Array.isArray(req.body?.permissions) ? req.body.permissions : null;
  if (!desired) return res.status(400).json({ error: 'A permissions array is required.' });
  const invalid = desired.filter((k) => !ALL_PERMISSION_KEYS.includes(k));
  if (invalid.length) return res.status(400).json({ error: `Unknown permissions: ${invalid.join(', ')}` });
  db.prepare('DELETE FROM role_permissions WHERE role = ?').run(role);
  for (const key of new Set(desired)) {
    db.prepare('INSERT OR IGNORE INTO role_permissions (role, permission_key) VALUES (?, ?)').run(role, key);
  }
  audit({ userId: req.user.id, userEmail: req.user.email, action: 'role.permissions',
    entityType: 'role', entityId: role, summary: `Updated default permissions for role ${role} (${desired.length} granted)`, ip: req.ip });
  res.json({ ok: true, permissions: permissionsForRole(db, role) });
}));

// ------------------------- personal workspace -------------------------------
// Lightweight, permission-scoped summary for the departmental dashboard.
coreRouter.get('/workspace', requireAuth, ah(async (req, res) => {
  const stats = {};
  const staffId = req.user.staff_id;
  if (staffId) {
    stats.my_open_tasks = db.prepare("SELECT COUNT(*) c FROM tasks WHERE assigned_to = ? AND status NOT IN ('done','verified')").get(staffId).c;
    stats.my_open_jobs = db.prepare("SELECT COUNT(*) c FROM maintenance_jobs WHERE assigned_to = ? AND status NOT IN ('verified','cancelled')").get(staffId).c;
    stats.my_cleaning_today = db.prepare("SELECT COUNT(*) c FROM cleaning_tasks WHERE cleaner_id = ? AND task_date = ? AND status != 'completed'").get(staffId, todayISO()).c;
    stats.my_pending_leave = db.prepare("SELECT COUNT(*) c FROM leave_requests WHERE staff_id = ? AND status IN ('pending','hr_pending')").get(staffId).c;
  }
  stats.unread_notifications = db.prepare(
    'SELECT COUNT(*) c FROM notifications WHERE (user_id = ? OR user_id IS NULL) AND read_at IS NULL'
  ).get(req.user.id).c;
  if (can(req, 'complaints.view')) {
    stats.open_complaints = db.prepare("SELECT COUNT(*) c FROM complaints WHERE status NOT IN ('resolved','closed')").get().c;
  }
  if (can(req, 'students.view')) {
    stats.active_students = db.prepare("SELECT COUNT(*) c FROM students WHERE status IN ('active','registered')").get().c;
  }
  if (can(req, 'hr.leave.approve')) {
    stats.leave_awaiting_approval = db.prepare("SELECT COUNT(*) c FROM leave_requests WHERE status IN ('pending','hr_pending')").get().c;
  }
  if (can(req, 'finance.view')) {
    const ar = db.prepare(`
      SELECT COALESCE(SUM(CASE WHEN status != 'void' THEN total END),0) invoiced,
        COALESCE((SELECT SUM(pa.amount) FROM payment_allocations pa),0) paid FROM invoices`).get();
    stats.outstanding_receivables = Math.round((ar.invoiced - ar.paid) * 100) / 100;
  }
  res.json({ user: req.user, permissions: req.permissions, stats });
}));

// ---------------------------- notifications --------------------------------

coreRouter.get('/notifications', requireAuth, ah(async (req, res) => {
  const rows = db.prepare(`
    SELECT * FROM notifications
    WHERE user_id = ? OR user_id IS NULL
    ORDER BY created_at DESC LIMIT 50
  `).all(req.user.id);
  const unread = db.prepare(
    "SELECT COUNT(*) AS c FROM notifications WHERE (user_id = ? OR user_id IS NULL) AND read_at IS NULL"
  ).get(req.user.id).c;
  res.json({ data: rows, unread });
}));

coreRouter.post('/notifications/read-all', requireAuth, ah(async (req, res) => {
  db.prepare('UPDATE notifications SET read_at = ? WHERE (user_id = ? OR user_id IS NULL) AND read_at IS NULL')
    .run(now(), req.user.id);
  res.json({ ok: true });
}));

coreRouter.post('/notifications/:id/read', requireAuth, ah(async (req, res) => {
  db.prepare('UPDATE notifications SET read_at = ? WHERE id = ? AND (user_id = ? OR user_id IS NULL)')
    .run(now(), req.params.id, req.user.id);
  res.json({ ok: true });
}));

// ------------------------------ documents ----------------------------------

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, storedFileName(file.originalname)),
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      const err = new Error(`File type ${file.mimetype} is not allowed. Allowed: PDF, images, Word, Excel, text/CSV.`);
      err.status = 400;
      return cb(err);
    }
    cb(null, true);
  },
});
export { upload };

coreRouter.get('/documents', requirePerm('documents.view'), ah(async (req, res) => {
  const { q, page, pageSize, offset } = listParams(req);
  const where = ['1=1']; const args = [];
  if (q) { where.push("(d.file_name LIKE ? ESCAPE '\\' OR d.doc_type LIKE ? ESCAPE '\\' OR d.entity_type LIKE ? ESCAPE '\\')"); const t = likeTerm(q); args.push(t, t, t); }
  const entityType = String(req.query.entity_type || '').trim();
  if (entityType) { where.push('d.entity_type = ?'); args.push(entityType); }
  const entityId = String(req.query.entity_id || '').trim();
  if (entityId) { where.push('d.entity_id = ?'); args.push(entityId); }
  const total = db.prepare(`SELECT COUNT(*) AS c FROM documents d WHERE ${where.join(' AND ')}`).get(...args).c;
  const rows = db.prepare(`
    SELECT d.*, u.full_name AS uploader_name FROM documents d LEFT JOIN users u ON u.id = d.uploaded_by
    WHERE ${where.join(' AND ')} ORDER BY d.created_at DESC LIMIT ? OFFSET ?
  `).all(...args, pageSize, offset);
  res.json(paginated(rows, total, page, pageSize));
}));

coreRouter.post('/documents', requirePerm('documents.manage'), upload.single('file'), ah(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file supplied.' });
  const id = newId();
  const ref = nextRef(db, 'FAR-DOC');
  db.prepare(`
    INSERT INTO documents (id, doc_ref, doc_type, entity_type, entity_id, file_name, stored_path, mime, size, uploaded_by, visibility, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, ref, req.body.doc_type || 'General', req.body.entity_type || 'general',
    req.body.entity_id || null, req.file.originalname, req.file.filename, req.file.mimetype,
    req.file.size, req.user.id, req.body.visibility || 'internal', now());
  audit({ userId: req.user.id, userEmail: req.user.email, action: 'document.upload',
    entityType: 'document', entityId: id, summary: `Uploaded ${req.file.originalname} (${req.body.doc_type || 'General'})`, ip: req.ip });
  res.status(201).json({ id, doc_ref: ref });
}));

/**
 * Permission-checked download. Access follows the entity the document is
 * attached to — sensitive student files require students/documents rights.
 */
coreRouter.get('/documents/:id/download', requirePerm('documents.view'), ah(async (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found.' });
  const denied = () => res.status(403).json({ error: 'You do not have permission to download this document.' });
  if (doc.entity_type === 'student' && !can(req, 'documents.manage') && !can(req, 'students.view')) return denied();
  if (doc.visibility === 'sensitive' && !can(req, 'documents.manage')) return denied();
  const abs = path.join(UPLOAD_DIR, path.basename(doc.stored_path));
  if (!fs.existsSync(abs)) return res.status(404).json({ error: 'File no longer exists on storage.' });
  audit({ userId: req.user.id, userEmail: req.user.email, action: 'document.download',
    entityType: 'document', entityId: doc.id, summary: `Downloaded ${doc.file_name}`, ip: req.ip });
  res.download(abs, doc.file_name);
}));

coreRouter.delete('/documents/:id', requirePerm('documents.manage'), ah(async (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found.' });
  db.prepare('DELETE FROM documents WHERE id = ?').run(req.params.id);
  const abs = path.join(UPLOAD_DIR, path.basename(doc.stored_path));
  try { if (fs.existsSync(abs)) fs.unlinkSync(abs); } catch { /* keep DB truth */ }
  audit({ userId: req.user.id, userEmail: req.user.email, action: 'document.delete',
    entityType: 'document', entityId: doc.id, summary: `Deleted ${doc.file_name}`, ip: req.ip });
  res.json({ ok: true });
}));

/** Serve stored file bytes only after permission verification. */
coreRouter.get('/files/:storedName', requirePerm('documents.view'), ah(async (req, res) => {
  const name = path.basename(req.params.storedName);
  const doc = db.prepare('SELECT * FROM documents WHERE stored_path = ?').get(name)
    || db.prepare('SELECT * FROM application_documents WHERE stored_path = ?').get(name)
    || db.prepare('SELECT * FROM maintenance_photos WHERE stored_path = ?').get(name);
  if (!doc) return res.status(404).json({ error: 'Not found.' });
  if (doc.stored_path !== name) return res.status(400).json({ error: 'Invalid path.' });
  const abs = path.join(UPLOAD_DIR, name);
  if (!fs.existsSync(abs)) return res.status(404).json({ error: 'File missing.' });
  res.sendFile(abs);
}));

// ------------------------------ audit logs ---------------------------------

coreRouter.get('/audit', requirePerm('audit.view'), ah(async (req, res) => {
  const { q, page, pageSize, offset, sort, dir } = listParams(req);
  const where = ['1=1']; const args = [];
  if (q) {
    where.push("(a.summary LIKE ? ESCAPE '\\' OR a.action LIKE ? ESCAPE '\\' OR a.user_email LIKE ? ESCAPE '\\')");
    const t = likeTerm(q); args.push(t, t, t);
  }
  const action = String(req.query.action || '').trim();
  if (action) { where.push('a.action LIKE ?'); args.push(`${action}%`); }
  const entity = String(req.query.entity_type || '').trim();
  if (entity) { where.push('a.entity_type = ?'); args.push(entity); }
  const from = String(req.query.from || '').trim();
  if (from) { where.push('date(a.created_at) >= date(?)'); args.push(from); }
  const to = String(req.query.to || '').trim();
  if (to) { where.push('date(a.created_at) <= date(?)'); args.push(to); }
  const total = db.prepare(`SELECT COUNT(*) AS c FROM audit_logs a WHERE ${where.join(' AND ')}`).get(...args).c;
  const rows = db.prepare(`
    SELECT a.*, u.full_name AS user_name FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
    WHERE ${where.join(' AND ')} ORDER BY a.created_at DESC LIMIT ? OFFSET ?
  `).all(...args, pageSize, offset);
  res.json(paginated(rows, total, page, pageSize));
}));

// ------------------------------- settings ----------------------------------

coreRouter.get('/settings', requireAuth, ah(async (req, res) => {
  const rows = db.prepare('SELECT * FROM system_settings').all();
  const out = {};
  for (const r of rows) {
    try { out[r.key] = JSON.parse(r.value); } catch { out[r.key] = r.value; }
  }
  res.json({
    settings: out,
    demo_mode: out.data_mode === 'demo',
    counts: {
      students: db.prepare("SELECT COUNT(*) AS c FROM students WHERE status != 'archived'").get().c,
      properties: db.prepare('SELECT COUNT(*) AS c FROM properties').get().c,
      complaints: db.prepare('SELECT COUNT(*) AS c FROM complaints').get().c,
      invoices: db.prepare('SELECT COUNT(*) AS c FROM invoices').get().c,
      users: db.prepare('SELECT COUNT(*) AS c FROM users').get().c,
    },
  });
}));

coreRouter.post('/settings', requirePerm('settings.manage'), ah(async (req, res) => {
  const b = req.body || {};
  const allowed = ['company', 'branding', 'notifications', 'escalation', 'retention', 'data_mode', 'portal'];
  const changed = [];
  for (const key of allowed) {
    if (b[key] !== undefined) { setSetting(key, b[key], req.user.id); changed.push(key); }
  }
  if (!changed.length) return res.status(400).json({ error: 'No valid settings supplied.' });
  audit({ userId: req.user.id, userEmail: req.user.email, action: 'settings.update',
    entityType: 'settings', entityId: changed.join(','), summary: `Updated settings: ${changed.join(', ')}`, ip: req.ip });
  res.json({ ok: true, changed });
}));

coreRouter.post('/settings/logo', requirePerm('settings.manage'), upload.single('logo'), ah(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file supplied.' });
  setSetting('logo', { file: req.file.filename, name: req.file.originalname }, req.user.id);
  audit({ userId: req.user.id, userEmail: req.user.email, action: 'settings.logo',
    summary: 'Uploaded company logo', ip: req.ip });
  res.json({ ok: true });
}));

// --------------------------- departments -----------------------------------

coreRouter.get('/departments', requireAuth, ah(async (req, res) => {
  res.json({ data: db.prepare('SELECT * FROM departments ORDER BY name').all() });
}));

coreRouter.post('/departments', requirePerm('settings.manage'), ah(async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Department name is required.' });
  const id = newId();
  db.prepare('INSERT INTO departments (id, name, description, created_at) VALUES (?, ?, ?, ?)')
    .run(id, name, req.body?.description || null, now());
  audit({ userId: req.user.id, userEmail: req.user.email, action: 'department.create',
    entityType: 'department', entityId: id, summary: `Created department ${name}`, ip: req.ip });
  res.status(201).json({ id, name });
}));

// --------------------------- global search ---------------------------------

coreRouter.get('/search', requireAuth, ah(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ results: [] });
  const t = likeTerm(q);
  const results = [];
  if (can(req, 'students.view')) {
    for (const r of db.prepare(`SELECT id, student_ref, full_name FROM students WHERE (student_ref LIKE ? ESCAPE '\\' OR full_name LIKE ? ESCAPE '\\') AND status != 'archived' LIMIT 5`).all(t, t)) {
      results.push({ type: 'Student', label: `${r.full_name}`, sub: r.student_ref, link: `/students?id=${r.id}` });
    }
  }
  if (can(req, 'applications.view')) {
    for (const r of db.prepare(`SELECT id, app_ref, status FROM applications WHERE app_ref LIKE ? ESCAPE '\\' LIMIT 5`).all(t)) {
      results.push({ type: 'Application', label: r.app_ref, sub: r.status, link: `/applications?id=${r.id}` });
    }
  }
  if (can(req, 'properties.view')) {
    for (const r of db.prepare(`SELECT id, name, property_ref FROM properties WHERE (name LIKE ? ESCAPE '\\' OR property_ref LIKE ? ESCAPE '\\') LIMIT 5`).all(t)) {
      results.push({ type: 'Property', label: r.name, sub: r.property_ref, link: `/properties?id=${r.id}` });
    }
  }
  if (can(req, 'complaints.view')) {
    for (const r of db.prepare(`SELECT id, ticket_ref, subject FROM complaints WHERE (ticket_ref LIKE ? ESCAPE '\\' OR subject LIKE ? ESCAPE '\\') LIMIT 5`).all(t)) {
      results.push({ type: 'Complaint', label: r.subject, sub: r.ticket_ref, link: `/complaints?ref=${r.ticket_ref}` });
    }
  }
  if (can(req, 'maintenance.view')) {
    for (const r of db.prepare(`SELECT id, job_ref, title FROM maintenance_jobs WHERE (job_ref LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\') LIMIT 5`).all(t)) {
      results.push({ type: 'Maintenance', label: r.title, sub: r.job_ref, link: `/maintenance?id=${r.id}` });
    }
  }
  res.json({ results });
}));
