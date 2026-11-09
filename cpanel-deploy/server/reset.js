// ---------------------------------------------------------------------------
// FACTORY RESET — removes every operational record and restores configuration.
// Usage:  npm run reset
//
// Preserved:
//   * database schema and relationships
//   * roles, permissions and role grants
//   * departments and landing routes
//   * system settings (company, security policy, CALVIN, API credentials)
//   * chart of accounts, accounting periods, leave types, payroll configuration
//   * the genuine Super Administrator account and its existing password
//
// Removed:
//   * students, applications, properties, buildings, rooms, beds, allocations
//   * staff, HR records, payroll runs, attendance and leave
//   * invoices, payments, expenses, suppliers, journals, budgets, assets
//   * complaints, maintenance, cleaning, tasks, documents, announcements
//   * notifications, CALVIN memory, login history, audit history, uploaded files
//   * every test or demonstration account
//
// No demo data is ever created. After the reset the system is empty and LIVE.
// ---------------------------------------------------------------------------
import { db } from './db.js';
import { seedBase, ADMIN_EMAIL } from './seed-base.js';
import { seedConfig } from './seed-config.js';
import { cleanOperationalData } from './clean-data.js';

const report = cleanOperationalData({ keepAdminSessions: false, clearAudit: true });

// Ensure configuration exists even if it was previously missing. Both seeds are
// idempotent and contain configuration only — never people or transactions.
seedBase();
seedConfig();
db.prepare("UPDATE system_settings SET value = '\"live\"' WHERE key = 'data_mode'").run();

console.log('FACTORY RESET complete.');
console.log('  - All operational and demonstration records deleted');
console.log('  - Roles, permissions, departments and settings preserved');
console.log('  - Chart of accounts, accounting periods, leave and payroll configuration preserved');
console.log(`  - Administrator account preserved (password unchanged): ${ADMIN_EMAIL}`);
console.log('  - System mode: LIVE (empty database, no demo fixtures, no seeded records)');
if (Object.keys(report.removed).length) {
  console.log('  - Removed record groups:', Object.keys(report.removed).sort().join(', '));
}
