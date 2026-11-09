// ---------------------------------------------------------------------------
// Idempotent base seed — runs at every server start.
// Creates roles/permissions, departments, default settings and the initial
// administrator account. Safe to run repeatedly.
//
// This seed deliberately contains NO business records: no employees, tenants,
// suppliers, invoices, payments, properties or transactions. The system starts
// empty and only real company data entered through the application appears.
// ---------------------------------------------------------------------------
import { db, newId, now, hashPassword } from './db.js';
import { ROLES, PERMISSIONS, DEFAULT_ROLE_PERMISSIONS, DEPARTMENT_SEED } from './rbac.js';

export const ADMIN_EMAIL = 'admin@farananigroup.co.za';
export const ADMIN_PASSWORD = 'Faranani2026#';

export function seedBase() {
  // roles
  for (const r of ROLES) {
    db.prepare('INSERT OR IGNORE INTO roles (id, name, label, description) VALUES (?, ?, ?, ?)')
      .run(newId(), r.name, r.label, null);
  }
  // permissions catalogue
  for (const p of PERMISSIONS) {
    db.prepare('INSERT OR IGNORE INTO permissions (id, key, label, category) VALUES (?, ?, ?, ?)')
      .run(newId(), p.key, p.label, p.category);
  }
  // default role grants
  for (const [role, perms] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
    for (const p of perms) {
      db.prepare('INSERT OR IGNORE INTO role_permissions (role, permission_key) VALUES (?, ?)').run(role, p);
    }
  }
  // departments — codes and landing dashboards make routing deterministic
  const seedDepartments = [...DEPARTMENT_SEED, { name: 'Management', code: 'MGMT', route: '/' }];
  for (const d of seedDepartments) {
    const existing = db.prepare('SELECT id FROM departments WHERE name = ?').get(d.name);
    if (existing) {
      db.prepare('UPDATE departments SET code = COALESCE(code, ?), dashboard_route = COALESCE(dashboard_route, ?) WHERE id = ?')
        .run(d.code, d.route, existing.id);
    } else {
      db.prepare('INSERT INTO departments (id, name, code, description, dashboard_route, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(newId(), d.name, d.code, null, d.route, now());
    }
  }
  // default settings
  const defaults = {
    company: {
      name: 'FARANANI PROPERTY GROUP',
      tagline: 'Student Accommodation & Property Operations',
      email: 'info@farananigroup.co.za',
      phone: '+27 00 000 0000',
      address: 'South Africa',
      timezone: 'Africa/Johannesburg',
      currency: 'ZAR',
    },
    branding: { primary: '#C9A227', sidebar: '#0B0B0D', logo_enabled: false },
    notifications: {
      new_application: true, new_complaint: true, urgent_complaint: true,
      payment_recorded: true, overdue_tasks: true, cleaning_overdue: true,
      email_enabled: false,
    },
    escalation: {
      urgent_hours: 4, high_hours: 12, normal_hours: 48, low_hours: 96,
      auto_escalate_categories: ['Security', 'Electrical', 'Plumbing'],
      routing: {
        Electrical: 'Maintenance', Plumbing: 'Maintenance', Facilities: 'Maintenance',
        Cleaning: 'Housekeeping', Security: 'Security', Noise: 'Security',
        'Internet Access': 'Facilities', 'Room Conditions': 'Housekeeping', Other: 'Admissions',
      },
    },
    retention: { archive_students_after_months: 84, audit_keep_years: 5 },
    data_mode: 'live',
    portal: { application_enabled: true, complaint_enabled: true },
    security: {
      max_failed_attempts: 5,
      lockout_minutes: 15,
      session_hours: 720,
      min_password_length: 8,
      require_strong_password: true,
      mfa_available: false,
    },
    calvin_voice: {
      input_enabled: true, output_enabled: true, recognition_language: 'en-ZA',
      voice_name: '', speech_rate: 1, speech_pitch: 0.92,
      wake_word_enabled: false, wake_word: 'calvin',
      text_to_speech_provider: 'browser', speech_to_text_provider: 'browser',
    },
    calvin_memory: {
      enabled: true, user_memory: true, department_memory: false,
      retention_days: 365, max_entries_per_user: 100,
    },
  };
  for (const [key, value] of Object.entries(defaults)) {
    const existing = db.prepare('SELECT key FROM system_settings WHERE key = ?').get(key);
    if (!existing) {
      db.prepare('INSERT INTO system_settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?)')
        .run(key, JSON.stringify(value), null, now());
    }
  }
  // administrator account
  const admin = db.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').get(ADMIN_EMAIL);
  if (!admin) {
    db.prepare(`
      INSERT INTO users (id, email, password_hash, full_name, role, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'super_admin', 'active', ?, ?)
    `).run(newId(), ADMIN_EMAIL, hashPassword(ADMIN_PASSWORD), 'System Administrator', now(), now());
    console.log(`[seed] Created administrator account: ${ADMIN_EMAIL}`);
  }
}
