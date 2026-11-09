// ---------------------------------------------------------------------------
// Faranani Property Group — Authentication & session handling
// Server-side sessions with httpOnly cookies. Passwords hashed with scrypt.
//
// Security controls implemented here:
//   * account lockout after repeated failed attempts (configurable)
//   * login event recording (success and failure) for the security dashboard
//   * per-user permission resolution (role grants + personal overrides)
//   * password change / reset with strength validation
//   * session revocation on password change and account deactivation
// ---------------------------------------------------------------------------
import { db, newId, now, verifyPassword, hashPassword, audit } from './db.js';
import { resolveUserPermissions } from './rbac.js';
import { getSetting } from './util.js';

const COOKIE_NAME = 'fg_session';

const DEFAULT_SECURITY = {
  max_failed_attempts: 5,
  lockout_minutes: 15,
  session_hours: 720,
  min_password_length: 8,
  require_strong_password: true,
  mfa_available: false,
};

export function securityPolicy() {
  const stored = getSetting('security') || {};
  return { ...DEFAULT_SECURITY, ...stored };
}

function sessionMs() {
  return Math.max(1, Number(securityPolicy().session_hours) || 720) * 3600 * 1000;
}

export function validatePassword(password) {
  const policy = securityPolicy();
  const value = String(password || '');
  if (value.length < policy.min_password_length) {
    return { ok: false, error: `Password must be at least ${policy.min_password_length} characters.` };
  }
  if (policy.require_strong_password) {
    const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(value)).length;
    if (classes < 3) {
      return { ok: false, error: 'Password must include at least three of: lowercase, uppercase, numbers, symbols.' };
    }
  }
  return { ok: true };
}

export function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export function setSessionCookie(res, token) {
  const maxAge = Math.floor(sessionMs() / 1000);
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`
  );
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

export function recordLoginEvent({ userId, email, success, reason, req }) {
  try {
    db.prepare(
      'INSERT INTO login_events (id, user_id, email, success, reason, ip, user_agent, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      newId(), userId ?? null, String(email || '').slice(0, 200), success ? 1 : 0,
      reason ?? null, req?.ip ?? null, String(req?.headers?.['user-agent'] || '').slice(0, 300), now()
    );
  } catch (e) {
    console.error('[auth] could not record login event:', e.message);
  }
}

export function login(email, password, req) {
  const policy = securityPolicy();
  const address = String(email || '').trim();
  const user = db.prepare('SELECT * FROM users WHERE lower(email) = lower(?) OR lower(coalesce(username, \'\')) = lower(?)')
    .get(address, address);

  if (!user) {
    recordLoginEvent({ email: address, success: false, reason: 'unknown_account', req });
    audit({ userEmail: address, action: 'auth.login_failed', summary: `Failed login attempt for ${address}`, ip: req?.ip });
    return { error: 'Invalid email or password.' };
  }

  if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
    const mins = Math.max(1, Math.ceil((new Date(user.locked_until).getTime() - Date.now()) / 60000));
    recordLoginEvent({ userId: user.id, email: user.email, success: false, reason: 'locked', req });
    return { error: `This account is temporarily locked after repeated failed attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.` };
  }

  if (user.status !== 'active') {
    recordLoginEvent({ userId: user.id, email: user.email, success: false, reason: `status:${user.status}`, req });
    return { error: 'This account has been deactivated. Contact the administrator.' };
  }

  if (!verifyPassword(password || '', user.password_hash)) {
    const attempts = Number(user.failed_attempts || 0) + 1;
    const lockUntil = attempts >= policy.max_failed_attempts
      ? new Date(Date.now() + policy.lockout_minutes * 60000).toISOString()
      : null;
    db.prepare('UPDATE users SET failed_attempts = ?, locked_until = ?, updated_at = ? WHERE id = ?')
      .run(attempts, lockUntil, now(), user.id);
    recordLoginEvent({ userId: user.id, email: user.email, success: false, reason: 'bad_password', req });
    audit({
      userId: user.id, userEmail: user.email, action: 'auth.login_failed',
      summary: `Failed login attempt ${attempts}/${policy.max_failed_attempts} for ${user.email}`,
      ip: req?.ip,
    });
    if (lockUntil) {
      audit({
        userId: user.id, userEmail: user.email, action: 'auth.account_locked',
        summary: `Account ${user.email} locked for ${policy.lockout_minutes} minutes`,
        ip: req?.ip,
      });
      return { error: `Too many failed attempts. This account is locked for ${policy.lockout_minutes} minutes.` };
    }
    return { error: 'Invalid email or password.' };
  }

  const token = newId();
  const expires = new Date(Date.now() + sessionMs()).toISOString();
  db.prepare(
    'INSERT INTO sessions (id, user_id, created_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(token, user.id, now(), expires, req?.ip || null, (req?.headers['user-agent'] || '').slice(0, 300));
  db.prepare('UPDATE users SET last_login_at = ?, failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?')
    .run(now(), now(), user.id);

  recordLoginEvent({ userId: user.id, email: user.email, success: true, reason: 'password', req });
  audit({
    userId: user.id, userEmail: user.email, action: 'auth.login',
    summary: `${user.full_name} signed in`, ip: req?.ip,
  });
  return { token, user: publicUser(user) };
}

export function logout(token, req) {
  if (!token) return;
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(token);
  if (row) {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id);
    audit({
      userId: row.user_id, userEmail: user?.email, action: 'auth.logout',
      summary: `${user?.full_name || 'User'} signed out`, ip: req?.ip,
    });
    db.prepare('DELETE FROM sessions WHERE id = ?').run(token);
  }
}

/** Resolves a session token to a user + permission set, or null. */
export function resolveSession(token) {
  if (!token) return null;
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(token);
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(token);
    return null;
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id);
  if (!user || user.status !== 'active') return null;
  return {
    user: publicUser(user),
    permissions: resolveUserPermissions(db, user),
    session: { id: row.id, created_at: row.created_at, expires_at: row.expires_at },
  };
}

export function publicUser(user) {
  if (!user) return null;
  const staff = user.staff_id
    ? db.prepare('SELECT id, employee_ref, job_title, department, property_id FROM staff WHERE id = ?').get(user.staff_id)
    : null;
  return {
    id: user.id,
    email: user.email,
    username: user.username || null,
    full_name: user.full_name,
    role: user.role,
    staff_id: user.staff_id,
    status: user.status,
    phone: user.phone || null,
    last_login_at: user.last_login_at,
    must_change_password: Boolean(user.must_change_password),
    department: staff?.department || user.department || null,
    job_title: staff?.job_title || user.job_title || null,
    employee_ref: staff?.employee_ref || null,
    property_id: staff?.property_id || null,
  };
}

/** Express middleware: require a valid session. */
export function requireAuth(req, res, next) {
  const token = parseCookies(req)[COOKIE_NAME];
  const session = resolveSession(token);
  if (!session) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  req.user = session.user;
  req.permissions = session.permissions;
  req.sessionToken = token;
  next();
}

/** Attaches the session when a valid cookie is present, but never rejects. */
export function attachSession(req, res, next) {
  try {
    const token = parseCookies(req)[COOKIE_NAME];
    const session = resolveSession(token);
    if (session) {
      req.user = session.user;
      req.permissions = session.permissions;
      req.sessionToken = token;
    }
  } catch { /* leave unauthenticated */ }
  next();
}

/** Express middleware: require one of the listed permissions. */
export function requirePerm(...keys) {
  return (req, res, next) => {
    if (!req.permissions) return res.status(401).json({ error: 'Authentication required.' });
    const ok = keys.some((k) => req.permissions.includes(k));
    if (!ok) {
      return res.status(403).json({ error: 'You do not have permission to perform this action.' });
    }
    next();
  };
}

export function can(req, key) {
  return Boolean(req.permissions && req.permissions.includes(key));
}

/** Revoke every session for a user, optionally keeping the current one alive. */
export function revokeSessions(userId, exceptToken = null) {
  if (exceptToken) {
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(userId, exceptToken);
  } else {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }
}

/** Change the signed-in user's own password (verifies the current one). */
export function changePassword(userId, currentPassword, newPassword) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return { error: 'Account not found.' };
  if (!verifyPassword(currentPassword || '', user.password_hash)) {
    return { error: 'Your current password is incorrect.' };
  }
  if (verifyPassword(newPassword || '', user.password_hash)) {
    return { error: 'The new password must be different from the current password.' };
  }
  const strength = validatePassword(newPassword);
  if (!strength.ok) return { error: strength.error };
  db.prepare(
    'UPDATE users SET password_hash = ?, must_change_password = 0, last_password_change = ?, updated_at = ? WHERE id = ?'
  ).run(hashPassword(newPassword), now(), now(), user.id);
  return { ok: true };
}
