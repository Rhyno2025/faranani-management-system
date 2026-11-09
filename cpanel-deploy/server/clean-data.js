// ---------------------------------------------------------------------------
// OPERATIONAL DATA CLEANUP
//
// Removes every business/operational record (students, properties, rooms, beds,
// staff, finance, HR, maintenance, complaints, documents, notifications, audit
// history, test accounts) while preserving:
//   * the database schema and all relationships
//   * roles, permissions and role grants
//   * departments and landing routes
//   * system settings (company, security policy, CALVIN config)
//   * chart of accounts, accounting periods, leave types, payroll configuration
//   * API credential configurations
//   * the genuine Super Administrator account and its password
//
// It never creates people, transactions or sample records.
//
// Usage:  npm run clean:data
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { db, now, audit } from './db.js';
import { seedBase, ADMIN_EMAIL } from './seed-base.js';
import { seedConfig } from './seed-config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const BACKUP_DIR = path.join(__dirname, 'data', 'backups');

/**
 * Tables that hold configuration, not business data. Everything else is
 * emptied. Keeping this list explicit means a newly added operational table is
 * cleaned automatically, while configuration can never be wiped by accident.
 */
const CONFIG_TABLES = new Set([
  'schema_meta',
  'roles',
  'permissions',
  'role_permissions',
  'departments',
  'system_settings',
  'chart_of_accounts',
  'accounting_periods',
  'leave_types',
  'payroll_deductions_config',
  'api_configs',
]);

/** Handled separately because the administrator account must survive. */
const SPECIAL_TABLES = new Set(['users', 'sessions', 'user_permission_overrides', 'counters']);

function listTables() {
  return db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  ).all().map((r) => r.name);
}

function countRows(table) {
  try { return db.prepare(`SELECT COUNT(*) AS c FROM "${table}"`).get().c; }
  catch { return 0; }
}

function removeUploads() {
  let removed = 0;
  try {
    for (const name of fs.readdirSync(UPLOAD_DIR)) {
      if (name === '.gitkeep') continue;
      const full = path.join(UPLOAD_DIR, name);
      try {
        if (fs.statSync(full).isFile()) { fs.unlinkSync(full); removed += 1; }
      } catch { /* keep going */ }
    }
  } catch { /* uploads directory may not exist */ }
  return removed;
}

function removeOldBackups() {
  let removed = 0;
  try {
    for (const name of fs.readdirSync(BACKUP_DIR)) {
      try { fs.unlinkSync(path.join(BACKUP_DIR, name)); removed += 1; } catch { /* ignore */ }
    }
  } catch { /* no backup directory */ }
  return removed;
}

/**
 * Purge operational data. Returns a report of what was removed and kept.
 * Safe to run repeatedly; it creates no records.
 */
export function cleanOperationalData({ keepAdminSessions = true, clearAudit = true } = {}) {
  const admin = db.prepare('SELECT id, email FROM users WHERE lower(email) = lower(?)').get(ADMIN_EMAIL);
  if (!admin) {
    throw new Error(`Refusing to clean: administrator account ${ADMIN_EMAIL} was not found.`);
  }

  const tables = listTables();
  const removed = {};
  const preserved = {};

  const before = {};
  for (const t of tables) before[t] = countRows(t);

  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const table of tables) {
      if (CONFIG_TABLES.has(table) || SPECIAL_TABLES.has(table)) continue;
      const n = before[table] || 0;
      if (n > 0) db.prepare(`DELETE FROM "${table}"`).run();
      if (n > 0) removed[table] = n;
    }

    // Test and demo accounts: everything except the real administrator.
    const removedUsers = db.prepare('SELECT COUNT(*) c FROM users WHERE id != ?').get(admin.id).c;
    if (removedUsers > 0) {
      db.prepare('DELETE FROM users WHERE id != ?').run(admin.id);
      removed.users = removedUsers;
    }
    db.prepare('DELETE FROM user_permission_overrides WHERE user_id != ?').run(admin.id);

    // Sessions: keep the administrator signed in locally unless asked not to.
    const removedSessions = keepAdminSessions
      ? db.prepare('DELETE FROM sessions WHERE user_id != ? OR expires_at < ?').run(admin.id, new Date().toISOString()).changes
      : db.prepare('DELETE FROM sessions').run().changes;
    if (removedSessions > 0) removed.sessions = Number(removedSessions);

    // Sequences restart so the first real record is number 0001.
    const counters = before.counters || 0;
    db.prepare('DELETE FROM counters').run();
    if (counters > 0) removed.counters = counters;

    // Detach the administrator from any deleted employee record.
    db.prepare('UPDATE users SET staff_id = NULL WHERE id = ? AND staff_id IS NOT NULL').run(admin.id);

    if (clearAudit) {
      const auditRows = before.audit_logs || 0;
      db.prepare('DELETE FROM audit_logs').run();
      if (auditRows > 0) removed.audit_logs = auditRows;
    }

    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* already rolled back */ }
    db.exec('PRAGMA foreign_keys = ON');
    throw err;
  }
  db.exec('PRAGMA foreign_keys = ON');

  const violations = db.prepare('PRAGMA foreign_key_check').all();
  if (violations.length) {
    throw new Error(`Cleanup left ${violations.length} foreign-key violation(s); investigate before use.`);
  }

  for (const t of tables) {
    if (CONFIG_TABLES.has(t) || SPECIAL_TABLES.has(t)) preserved[t] = countRows(t);
  }
  preserved.users = countRows('users');
  preserved.sessions = countRows('sessions');

  const uploadsRemoved = removeUploads();
  const backupsRemoved = removeOldBackups();

  // One truthful audit entry documenting the maintenance action.
  audit({
    userId: admin.id,
    userEmail: admin.email,
    action: 'system.data_cleanup',
    entityType: 'system',
    summary: 'Removed all operational and demonstration records; schema, configuration and administrator preserved',
    details: { removed },
    ip: 'local',
  });

  return {
    admin: admin.email,
    removed,
    preserved,
    uploads_removed: uploadsRemoved,
    backups_removed: backupsRemoved,
    completed_at: now(),
  };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------
const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
  if (!process.argv.includes('--yes')) {
    console.error('This removes every operational record. Re-run with: npm run clean:data');
    process.exit(1);
  }
  try {
    const report = cleanOperationalData();
    seedBase();
    seedConfig();
    db.prepare("UPDATE system_settings SET value = '\"live\"' WHERE key = 'data_mode'").run();

    console.log('\nDATA CLEANUP COMPLETE');
    console.log(`  Administrator preserved: ${report.admin}`);
    const removedTables = Object.entries(report.removed).sort((a, b) => b[1] - a[1]);
    if (removedTables.length) {
      console.log('  Removed records:');
      for (const [t, n] of removedTables) console.log(`    ${t.padEnd(26)} ${n}`);
    } else {
      console.log('  No operational records were present.');
    }
    console.log('  Preserved configuration:');
    for (const [t, n] of Object.entries(report.preserved)) {
      if (t === 'users' || t === 'sessions') continue;
      console.log(`    ${t.padEnd(26)} ${n}`);
    }
    console.log(`  Uploaded files removed: ${report.uploads_removed}`);
    console.log(`  Temporary backups removed: ${report.backups_removed}`);
    console.log('  System mode: LIVE — all modules start empty until real data is entered.\n');
  } catch (err) {
    console.error('Cleanup failed:', err.message);
    process.exit(1);
  }
}
