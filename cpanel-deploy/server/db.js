// ---------------------------------------------------------------------------
// Faranani Property Group — Database layer
// Real relational database (SQLite via node:sqlite) with a PostgreSQL-compatible
// schema design. The same schema is provided as Supabase/PostgreSQL migrations
// under supabase/ for deployment to a hosted Supabase project.
// ---------------------------------------------------------------------------
import { DatabaseSync } from 'node:sqlite';
import { randomUUID, scryptSync, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = process.env.FG_DB_PATH || path.join(DATA_DIR, 'faranani.db');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA busy_timeout = 5000;');

// ------------------------------ helpers -----------------------------------

export function newId() {
  return randomUUID();
}

/** Human readable reference numbers, e.g. FAR-ST-0001 */
export function nextRef(db, prefix) {
  const row = db.prepare('SELECT value FROM counters WHERE name = ?').get(prefix);
  let next = 1;
  if (row) next = row.value + 1;
  else db.prepare('INSERT INTO counters (name, value) VALUES (?, 1)').run(prefix);
  if (row) db.prepare('UPDATE counters SET value = ? WHERE name = ?').run(next, prefix);
  return `${prefix}-${String(next).padStart(4, '0')}`;
}

export function now() {
  return new Date().toISOString();
}

/** Run a function inside an atomic transaction (BEGIN IMMEDIATE). */
export function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn(db);
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  }
}

/** Password hashing with scrypt (no external dependencies). */
export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  const [, salt, hash] = stored.split('$');
  const derived = scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(derived, 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && a.equals(b);
}

// ------------------------------ schema -------------------------------------

const SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS counters (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  label TEXT NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS permissions (
  id TEXT PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  label TEXT NOT NULL,
  category TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role TEXT NOT NULL,
  permission_key TEXT NOT NULL,
  PRIMARY KEY (role, permission_key),
  FOREIGN KEY (role) REFERENCES roles(name) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS departments (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS staff (
  id TEXT PRIMARY KEY,
  employee_ref TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  job_title TEXT,
  department TEXT,
  email TEXT,
  phone TEXT,
  property_id TEXT,
  role TEXT,
  employment_status TEXT NOT NULL DEFAULT 'active',
  hired_at TEXT,
  shift_notes TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL,
  staff_id TEXT REFERENCES staff(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active',
  last_login_at TEXT,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS properties (
  id TEXT PRIMARY KEY,
  property_ref TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  address TEXT,
  city TEXT,
  province TEXT,
  manager_staff_id TEXT REFERENCES staff(id) ON DELETE SET NULL,
  contact_email TEXT,
  contact_phone TEXT,
  description TEXT,
  facilities TEXT DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS buildings (
  id TEXT PRIMARY KEY,
  building_ref TEXT UNIQUE NOT NULL,
  property_id TEXT NOT NULL,
  name TEXT NOT NULL,
  floors INTEGER DEFAULT 1,
  description TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  room_ref TEXT UNIQUE NOT NULL,
  building_id TEXT NOT NULL,
  room_number TEXT NOT NULL,
  room_type TEXT NOT NULL DEFAULT 'Single',
  capacity INTEGER NOT NULL DEFAULT 1,
  rate REAL NOT NULL DEFAULT 0,
  furnishing TEXT,
  facilities TEXT DEFAULT '[]',
  inspection_status TEXT DEFAULT 'Not inspected',
  status TEXT NOT NULL DEFAULT 'available',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (building_id) REFERENCES buildings(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS beds (
  id TEXT PRIMARY KEY,
  bed_ref TEXT UNIQUE NOT NULL,
  room_id TEXT NOT NULL,
  label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available',
  created_at TEXT NOT NULL,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS students (
  id TEXT PRIMARY KEY,
  student_ref TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  id_number TEXT,
  institution TEXT,
  course TEXT,
  emergency_contact_name TEXT,
  emergency_contact_phone TEXT,
  status TEXT NOT NULL DEFAULT 'registered',
  property_id TEXT REFERENCES properties(id) ON DELETE SET NULL,
  room_id TEXT REFERENCES rooms(id) ON DELETE SET NULL,
  bed_id TEXT REFERENCES beds(id) ON DELETE SET NULL,
  check_in_date TEXT,
  expected_check_out_date TEXT,
  notes TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS applications (
  id TEXT PRIMARY KEY,
  app_ref TEXT UNIQUE NOT NULL,
  student_id TEXT NOT NULL,
  property_id TEXT REFERENCES properties(id) ON DELETE SET NULL,
  room_type_pref TEXT,
  move_in_date TEXT,
  duration_months INTEGER,
  status TEXT NOT NULL DEFAULT 'draft',
  reviewer_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  internal_notes TEXT,
  decision_notes TEXT,
  decision_at TEXT,
  decision_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  submitted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS application_documents (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL,
  doc_type TEXT NOT NULL,
  file_name TEXT NOT NULL,
  stored_path TEXT NOT NULL,
  mime TEXT,
  size INTEGER,
  uploaded_at TEXT NOT NULL,
  FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS application_notes (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL,
  author_id TEXT,
  author_name TEXT,
  body TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'internal',
  created_at TEXT NOT NULL,
  FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS accommodation_agreements (
  id TEXT PRIMARY KEY,
  agreement_ref TEXT UNIQUE NOT NULL,
  student_id TEXT NOT NULL,
  application_id TEXT,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  rate REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  signed_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS bed_allocations (
  id TEXT PRIMARY KEY,
  allocation_ref TEXT UNIQUE NOT NULL,
  student_id TEXT NOT NULL,
  bed_id TEXT NOT NULL,
  application_id TEXT,
  check_in_date TEXT NOT NULL,
  check_out_date TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  FOREIGN KEY (bed_id) REFERENCES beds(id) ON DELETE CASCADE
);

-- Prevents two active/reserved allocations of the same bed entirely.
CREATE UNIQUE INDEX IF NOT EXISTS idx_bed_active_unique
  ON bed_allocations(bed_id)
  WHERE status IN ('active','reserved');

CREATE INDEX IF NOT EXISTS idx_alloc_student ON bed_allocations(student_id);
CREATE INDEX IF NOT EXISTS idx_alloc_dates ON bed_allocations(check_in_date, check_out_date);

CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  supplier_ref TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  contact_person TEXT,
  email TEXT,
  phone TEXT,
  category TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  invoice_ref TEXT UNIQUE NOT NULL,
  student_id TEXT NOT NULL,
  issue_date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  subtotal REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'issued',
  notes TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS invoice_items (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT,
  quantity REAL NOT NULL DEFAULT 1,
  unit_price REAL NOT NULL DEFAULT 0,
  amount REAL NOT NULL DEFAULT 0,
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  payment_ref TEXT UNIQUE NOT NULL,
  student_id TEXT NOT NULL,
  amount REAL NOT NULL,
  method TEXT NOT NULL DEFAULT 'eft',
  reference TEXT,
  paid_at TEXT NOT NULL,
  recorded_by TEXT,
  status TEXT NOT NULL DEFAULT 'recorded',
  notes TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS payment_allocations (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  amount REAL NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE CASCADE,
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  expense_ref TEXT UNIQUE NOT NULL,
  property_id TEXT REFERENCES properties(id) ON DELETE SET NULL,
  supplier_id TEXT REFERENCES suppliers(id) ON DELETE SET NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  amount REAL NOT NULL,
  incurred_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  approved_by TEXT,
  approved_at TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS complaints (
  id TEXT PRIMARY KEY,
  ticket_ref TEXT UNIQUE NOT NULL,
  student_id TEXT REFERENCES students(id) ON DELETE SET NULL,
  property_id TEXT REFERENCES properties(id) ON DELETE SET NULL,
  building_id TEXT REFERENCES buildings(id) ON DELETE SET NULL,
  room_id TEXT REFERENCES rooms(id) ON DELETE SET NULL,
  category TEXT NOT NULL,
  subject TEXT NOT NULL,
  description TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'open',
  assigned_dept TEXT,
  assigned_to TEXT REFERENCES staff(id) ON DELETE SET NULL,
  submitted_via TEXT NOT NULL DEFAULT 'portal',
  submitted_at TEXT NOT NULL,
  due_at TEXT,
  resolved_at TEXT,
  closed_at TEXT,
  resolution_notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS complaint_comments (
  id TEXT PRIMARY KEY,
  complaint_id TEXT NOT NULL,
  author_id TEXT,
  author_name TEXT,
  body TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'internal',
  created_at TEXT NOT NULL,
  FOREIGN KEY (complaint_id) REFERENCES complaints(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS complaint_status_history (
  id TEXT PRIMARY KEY,
  complaint_id TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  changed_by TEXT,
  changed_by_name TEXT,
  note TEXT,
  changed_at TEXT NOT NULL,
  FOREIGN KEY (complaint_id) REFERENCES complaints(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS maintenance_jobs (
  id TEXT PRIMARY KEY,
  job_ref TEXT UNIQUE NOT NULL,
  complaint_id TEXT REFERENCES complaints(id) ON DELETE SET NULL,
  property_id TEXT REFERENCES properties(id) ON DELETE SET NULL,
  building_id TEXT REFERENCES buildings(id) ON DELETE SET NULL,
  room_id TEXT REFERENCES rooms(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'pending',
  assigned_to TEXT REFERENCES staff(id) ON DELETE SET NULL,
  due_date TEXT,
  estimated_cost REAL DEFAULT 0,
  actual_cost REAL DEFAULT 0,
  materials TEXT DEFAULT '[]',
  work_notes TEXT,
  completed_at TEXT,
  verified_by TEXT,
  verified_at TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS maintenance_photos (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  file_name TEXT NOT NULL,
  stored_path TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES maintenance_jobs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS cleaning_schedules (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL,
  building_id TEXT,
  room_id TEXT,
  area_name TEXT NOT NULL,
  frequency TEXT NOT NULL DEFAULT 'daily',
  due_time TEXT DEFAULT '09:00',
  assigned_to TEXT REFERENCES staff(id) ON DELETE SET NULL,
  supervisor_id TEXT REFERENCES staff(id) ON DELETE SET NULL,
  checklist TEXT DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cleaning_tasks (
  id TEXT PRIMARY KEY,
  schedule_id TEXT REFERENCES cleaning_schedules(id) ON DELETE SET NULL,
  property_id TEXT,
  building_id TEXT,
  room_id TEXT,
  area_name TEXT NOT NULL,
  task_date TEXT NOT NULL,
  due_time TEXT,
  cleaner_id TEXT REFERENCES staff(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  completed_at TEXT,
  completed_by TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cleaning_inspections (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  inspector_id TEXT,
  result TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES cleaning_tasks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  task_ref TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  assigned_to TEXT REFERENCES staff(id) ON DELETE SET NULL,
  department TEXT,
  property_id TEXT REFERENCES properties(id) ON DELETE SET NULL,
  link_type TEXT,
  link_id TEXT,
  due_date TEXT,
  priority TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'todo',
  recurring TEXT,
  created_by TEXT,
  completed_at TEXT,
  verified_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task_comments (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  author_name TEXT,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS calendar_events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'other',
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  all_day INTEGER NOT NULL DEFAULT 0,
  property_id TEXT,
  link_type TEXT,
  link_id TEXT,
  description TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS announcements (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  audience TEXT NOT NULL DEFAULT 'all',
  priority TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'draft',
  published_at TEXT,
  expires_at TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  student_id TEXT,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  user_email TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  summary TEXT,
  details TEXT,
  ip TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  doc_ref TEXT UNIQUE NOT NULL,
  doc_type TEXT,
  entity_type TEXT,
  entity_id TEXT,
  file_name TEXT NOT NULL,
  stored_path TEXT NOT NULL,
  mime TEXT,
  size INTEGER,
  uploaded_by TEXT,
  visibility TEXT NOT NULL DEFAULT 'internal',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_by TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_students_ref ON students(student_ref);
CREATE INDEX IF NOT EXISTS idx_students_status ON students(status);
CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);
CREATE INDEX IF NOT EXISTS idx_complaints_status ON complaints(status);
CREATE INDEX IF NOT EXISTS idx_complaints_property ON complaints(property_id);
CREATE INDEX IF NOT EXISTS idx_payments_student ON payments(student_id);
CREATE INDEX IF NOT EXISTS idx_invoices_student ON invoices(student_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read_at);
`;

// ---------------------------------------------------------------------------
// Schema v2 — Human Resources (HRMS) and Accounting (double-entry ledger)
// Added by the enterprise upgrade. All statements are idempotent so an existing
// database is migrated in place without touching business records.
// ---------------------------------------------------------------------------
const SCHEMA_V2 = `
-- =============== employee record extensions ===============
ALTER TABLE staff ADD COLUMN date_of_birth TEXT;
ALTER TABLE staff ADD COLUMN gender TEXT;
ALTER TABLE staff ADD COLUMN id_number TEXT;
ALTER TABLE staff ADD COLUMN address_line TEXT;
ALTER TABLE staff ADD COLUMN address_city TEXT;
ALTER TABLE staff ADD COLUMN postal_address TEXT;
ALTER TABLE staff ADD COLUMN emergency_contact_name TEXT;
ALTER TABLE staff ADD COLUMN emergency_contact_phone TEXT;
ALTER TABLE staff ADD COLUMN emergency_contact_relationship TEXT;
ALTER TABLE staff ADD COLUMN next_of_kin TEXT;
ALTER TABLE staff ADD COLUMN employment_type TEXT NOT NULL DEFAULT 'permanent';
ALTER TABLE staff ADD COLUMN contract_start TEXT;
ALTER TABLE staff ADD COLUMN contract_end TEXT;
ALTER TABLE staff ADD COLUMN probation_end TEXT;
ALTER TABLE staff ADD COLUMN base_salary REAL DEFAULT 0;
ALTER TABLE staff ADD COLUMN salary_frequency TEXT DEFAULT 'monthly';
ALTER TABLE staff ADD COLUMN branch TEXT;
ALTER TABLE staff ADD COLUMN manager_id TEXT REFERENCES staff(id) ON DELETE SET NULL;
ALTER TABLE staff ADD COLUMN bank_name TEXT;
ALTER TABLE staff ADD COLUMN bank_account TEXT;
ALTER TABLE staff ADD COLUMN tax_number TEXT;
ALTER TABLE staff ADD COLUMN uif_number TEXT;
ALTER TABLE staff ADD COLUMN qualifications TEXT;
ALTER TABLE staff ADD COLUMN skills TEXT;
ALTER TABLE staff ADD COLUMN archived_at TEXT;
ALTER TABLE staff ADD COLUMN exit_type TEXT;
ALTER TABLE staff ADD COLUMN exit_date TEXT;
ALTER TABLE staff ADD COLUMN exit_reason TEXT;

-- =============== HR: leave ===============
CREATE TABLE IF NOT EXISTS leave_types (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  code TEXT UNIQUE NOT NULL,
  paid INTEGER NOT NULL DEFAULT 1,
  days_per_year REAL NOT NULL DEFAULT 0,
  requires_document INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS leave_requests (
  id TEXT PRIMARY KEY,
  leave_ref TEXT UNIQUE NOT NULL,
  staff_id TEXT NOT NULL,
  leave_type_id TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  days REAL NOT NULL DEFAULT 0,
  reason TEXT,
  document_path TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  manager_decision TEXT,
  manager_decided_by TEXT,
  manager_decided_at TEXT,
  hr_decision TEXT,
  hr_decided_by TEXT,
  hr_decided_at TEXT,
  cancellation_reason TEXT,
  submitted_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE,
  FOREIGN KEY (leave_type_id) REFERENCES leave_types(id)
);
CREATE INDEX IF NOT EXISTS idx_leave_staff ON leave_requests(staff_id, status);

-- =============== HR: attendance ===============
CREATE TABLE IF NOT EXISTS attendance_records (
  id TEXT PRIMARY KEY,
  staff_id TEXT NOT NULL,
  work_date TEXT NOT NULL,
  clock_in TEXT,
  clock_out TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  status TEXT NOT NULL DEFAULT 'present',
  late_minutes INTEGER NOT NULL DEFAULT 0,
  worked_minutes INTEGER NOT NULL DEFAULT 0,
  overtime_minutes INTEGER NOT NULL DEFAULT 0,
  shift_start TEXT,
  shift_end TEXT,
  note TEXT,
  correction_note TEXT,
  corrected_by TEXT,
  corrected_at TEXT,
  recorded_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (staff_id, work_date),
  FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance_records(work_date);

CREATE TABLE IF NOT EXISTS shift_schedules (
  id TEXT PRIMARY KEY,
  staff_id TEXT NOT NULL,
  shift_date TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT 'Standard',
  start_time TEXT NOT NULL DEFAULT '08:00',
  end_time TEXT NOT NULL DEFAULT '17:00',
  note TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public_holidays (
  id TEXT PRIMARY KEY,
  holiday_date TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT 'ZA',
  created_at TEXT NOT NULL
);

-- =============== HR: payroll ===============
CREATE TABLE IF NOT EXISTS payroll_periods (
  id TEXT PRIMARY KEY,
  period_key TEXT UNIQUE NOT NULL,
  label TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  gross_total REAL NOT NULL DEFAULT 0,
  deduction_total REAL NOT NULL DEFAULT 0,
  net_total REAL NOT NULL DEFAULT 0,
  employee_count INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  approved_by TEXT,
  approved_at TEXT,
  paid_by TEXT,
  paid_at TEXT,
  journal_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payroll_entries (
  id TEXT PRIMARY KEY,
  period_id TEXT NOT NULL,
  staff_id TEXT NOT NULL,
  basic REAL NOT NULL DEFAULT 0,
  allowances REAL NOT NULL DEFAULT 0,
  overtime REAL NOT NULL DEFAULT 0,
  bonus REAL NOT NULL DEFAULT 0,
  gross REAL NOT NULL DEFAULT 0,
  paye REAL NOT NULL DEFAULT 0,
  uif REAL NOT NULL DEFAULT 0,
  sdl REAL NOT NULL DEFAULT 0,
  pension REAL NOT NULL DEFAULT 0,
  other_deductions REAL NOT NULL DEFAULT 0,
  deductions REAL NOT NULL DEFAULT 0,
  net REAL NOT NULL DEFAULT 0,
  lines TEXT DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'calculated',
  UNIQUE (period_id, staff_id),
  FOREIGN KEY (period_id) REFERENCES payroll_periods(id) ON DELETE CASCADE,
  FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS payroll_deductions_config (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'statutory',
  rate REAL NOT NULL DEFAULT 0,
  threshold REAL DEFAULT 0,
  ceiling REAL,
  employer_rate REAL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  jurisdiction TEXT NOT NULL DEFAULT 'ZA',
  effective_from TEXT,
  source TEXT,
  notes TEXT
);

-- =============== HR: recruitment ===============
CREATE TABLE IF NOT EXISTS job_requisitions (
  id TEXT PRIMARY KEY,
  req_ref TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  department TEXT,
  branch TEXT,
  vacancies INTEGER NOT NULL DEFAULT 1,
  employment_type TEXT DEFAULT 'permanent',
  salary_min REAL,
  salary_max REAL,
  description TEXT,
  requirements TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  posted_at TEXT,
  closed_at TEXT,
  created_by TEXT,
  approved_by TEXT,
  approved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS job_applicants (
  id TEXT PRIMARY KEY,
  applicant_ref TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  source TEXT,
  cv_path TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS job_applications (
  id TEXT PRIMARY KEY,
  application_ref TEXT UNIQUE NOT NULL,
  applicant_id TEXT NOT NULL,
  requisition_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'screening',
  stage TEXT,
  rating REAL,
  notes TEXT,
  reference_check TEXT,
  background_check TEXT,
  offer_status TEXT,
  offer_salary REAL,
  offer_date TEXT,
  hired_staff_id TEXT,
  rejected_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (applicant_id) REFERENCES job_applicants(id) ON DELETE CASCADE,
  FOREIGN KEY (requisition_id) REFERENCES job_requisitions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS interviews (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL,
  round INTEGER NOT NULL DEFAULT 1,
  scheduled_at TEXT NOT NULL,
  interviewer TEXT,
  mode TEXT DEFAULT 'in_person',
  rating REAL,
  outcome TEXT DEFAULT 'scheduled',
  notes TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (application_id) REFERENCES job_applications(id) ON DELETE CASCADE
);

-- =============== HR: onboarding / offboarding ===============
CREATE TABLE IF NOT EXISTS onboarding_tasks (
  id TEXT PRIMARY KEY,
  staff_id TEXT NOT NULL,
  title TEXT NOT NULL,
  category TEXT,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  completed_at TEXT,
  completed_by TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS employee_exits (
  id TEXT PRIMARY KEY,
  staff_id TEXT NOT NULL,
  exit_type TEXT NOT NULL DEFAULT 'resignation',
  resignation_date TEXT,
  last_working_day TEXT,
  notice_period_days INTEGER DEFAULT 30,
  exit_interview TEXT,
  assets_returned INTEGER DEFAULT 0,
  final_pay_processed INTEGER DEFAULT 0,
  access_revoked INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open',
  initiated_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE
);

-- =============== HR: performance & training ===============
CREATE TABLE IF NOT EXISTS performance_reviews (
  id TEXT PRIMARY KEY,
  review_ref TEXT UNIQUE NOT NULL,
  staff_id TEXT NOT NULL,
  cycle TEXT NOT NULL,
  period_start TEXT,
  period_end TEXT,
  goals TEXT DEFAULT '[]',
  employee_comment TEXT,
  manager_comment TEXT,
  self_rating REAL,
  manager_rating REAL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_by TEXT,
  decided_by TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS training_programs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  provider TEXT,
  category TEXT,
  start_date TEXT,
  end_date TEXT,
  cost REAL DEFAULT 0,
  max_seats INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'planned',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS training_enrollments (
  id TEXT PRIMARY KEY,
  program_id TEXT NOT NULL,
  staff_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'enrolled',
  completed_at TEXT,
  score REAL,
  created_at TEXT NOT NULL,
  UNIQUE (program_id, staff_id),
  FOREIGN KEY (program_id) REFERENCES training_programs(id) ON DELETE CASCADE,
  FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE
);

-- =============== HR: employee relations ===============
CREATE TABLE IF NOT EXISTS hr_cases (
  id TEXT PRIMARY KEY,
  case_ref TEXT UNIQUE NOT NULL,
  staff_id TEXT,
  type TEXT NOT NULL DEFAULT 'grievance',
  title TEXT NOT NULL,
  description TEXT,
  severity TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'open',
  confidential INTEGER NOT NULL DEFAULT 0,
  outcome TEXT,
  corrective_action TEXT,
  due_date TEXT,
  opened_by TEXT,
  assigned_to TEXT,
  closed_by TEXT,
  closed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hr_case_notes (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  author_id TEXT,
  author_name TEXT,
  body TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'internal',
  created_at TEXT NOT NULL,
  FOREIGN KEY (case_id) REFERENCES hr_cases(id) ON DELETE CASCADE
);

-- =============== Finance: chart of accounts & periods ===============
CREATE TABLE IF NOT EXISTS chart_of_accounts (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('asset','liability','equity','income','expense')),
  subtype TEXT,
  parent_id TEXT,
  system INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  description TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_coa_type ON chart_of_accounts(type, active);

CREATE TABLE IF NOT EXISTS accounting_periods (
  id TEXT PRIMARY KEY,
  period_key TEXT UNIQUE NOT NULL,
  label TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  closed_by TEXT,
  closed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS journal_entries (
  id TEXT PRIMARY KEY,
  journal_ref TEXT UNIQUE NOT NULL,
  period_id TEXT,
  entry_date TEXT NOT NULL,
  description TEXT NOT NULL,
  source_type TEXT,
  source_id TEXT,
  total_debit REAL NOT NULL DEFAULT 0,
  total_credit REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  reversal_of TEXT,
  reversed_by TEXT,
  created_by TEXT,
  posted_by TEXT,
  posted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (period_id) REFERENCES accounting_periods(id)
);
CREATE INDEX IF NOT EXISTS idx_journal_status ON journal_entries(status, entry_date);

CREATE TABLE IF NOT EXISTS journal_lines (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  debit REAL NOT NULL DEFAULT 0,
  credit REAL NOT NULL DEFAULT 0,
  memo TEXT,
  party_type TEXT,
  party_id TEXT,
  property_id TEXT,
  FOREIGN KEY (entry_id) REFERENCES journal_entries(id) ON DELETE CASCADE,
  FOREIGN KEY (account_id) REFERENCES chart_of_accounts(id)
);
CREATE INDEX IF NOT EXISTS idx_jlines_account ON journal_lines(account_id);
CREATE INDEX IF NOT EXISTS idx_jlines_entry ON journal_lines(entry_id);

-- =============== Finance: banking ===============
CREATE TABLE IF NOT EXISTS bank_accounts (
  id TEXT PRIMARY KEY,
  account_ref TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  bank_name TEXT,
  account_number TEXT,
  account_type TEXT NOT NULL DEFAULT 'bank',
  currency TEXT NOT NULL DEFAULT 'ZAR',
  gl_account_id TEXT,
  opening_balance REAL NOT NULL DEFAULT 0,
  opening_date TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bank_statements (
  id TEXT PRIMARY KEY,
  bank_account_id TEXT NOT NULL,
  file_name TEXT,
  uploaded_by TEXT,
  statement_from TEXT,
  statement_to TEXT,
  opening_balance REAL DEFAULT 0,
  closing_balance REAL DEFAULT 0,
  txn_count INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS bank_transactions (
  id TEXT PRIMARY KEY,
  bank_account_id TEXT NOT NULL,
  statement_id TEXT,
  txn_date TEXT NOT NULL,
  description TEXT NOT NULL,
  reference TEXT,
  amount REAL NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  status TEXT NOT NULL DEFAULT 'unmatched',
  reconciled_at TEXT,
  reconciled_by TEXT,
  matched_entry_id TEXT,
  duplicate_key TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_banktxn_recon ON bank_transactions(bank_account_id, status);

-- =============== Finance: accounts payable ===============
CREATE TABLE IF NOT EXISTS supplier_invoices (
  id TEXT PRIMARY KEY,
  ap_ref TEXT UNIQUE NOT NULL,
  supplier_id TEXT NOT NULL,
  invoice_number TEXT NOT NULL,
  invoice_date TEXT NOT NULL,
  due_date TEXT,
  description TEXT,
  property_id TEXT,
  subtotal REAL NOT NULL DEFAULT 0,
  tax REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  amount_paid REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending_approval',
  duplicate_of TEXT,
  created_by TEXT,
  approved_by TEXT,
  approved_at TEXT,
  journal_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ap_duplicate
  ON supplier_invoices(supplier_id, invoice_number) WHERE status != 'void';

CREATE TABLE IF NOT EXISTS ap_payments (
  id TEXT PRIMARY KEY,
  payment_ref TEXT UNIQUE NOT NULL,
  supplier_id TEXT NOT NULL,
  bank_account_id TEXT,
  amount REAL NOT NULL,
  paid_at TEXT NOT NULL,
  reference TEXT,
  status TEXT NOT NULL DEFAULT 'pending_approval',
  created_by TEXT,
  approved_by TEXT,
  approved_at TEXT,
  journal_id TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ap_payment_allocations (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  amount REAL NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (payment_id) REFERENCES ap_payments(id) ON DELETE CASCADE,
  FOREIGN KEY (invoice_id) REFERENCES supplier_invoices(id) ON DELETE CASCADE
);

-- =============== Finance: budgets ===============
CREATE TABLE IF NOT EXISTS budgets (
  id TEXT PRIMARY KEY,
  budget_ref TEXT UNIQUE NOT NULL,
  label TEXT NOT NULL,
  fiscal_year INTEGER NOT NULL,
  scope_type TEXT NOT NULL DEFAULT 'company',
  scope_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  version INTEGER NOT NULL DEFAULT 1,
  parent_id TEXT,
  notes TEXT,
  created_by TEXT,
  approved_by TEXT,
  approved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS budget_lines (
  id TEXT PRIMARY KEY,
  budget_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  month INTEGER NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  FOREIGN KEY (budget_id) REFERENCES budgets(id) ON DELETE CASCADE,
  FOREIGN KEY (account_id) REFERENCES chart_of_accounts(id)
);

-- =============== Finance: fixed assets ===============
CREATE TABLE IF NOT EXISTS fixed_assets (
  id TEXT PRIMARY KEY,
  asset_ref TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  category TEXT,
  purchase_date TEXT NOT NULL,
  cost REAL NOT NULL DEFAULT 0,
  residual_value REAL NOT NULL DEFAULT 0,
  useful_life_years REAL NOT NULL DEFAULT 5,
  depreciation_method TEXT NOT NULL DEFAULT 'straight_line',
  accumulated_depreciation REAL NOT NULL DEFAULT 0,
  book_value REAL NOT NULL DEFAULT 0,
  location TEXT,
  custodian_staff_id TEXT,
  property_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  disposal_date TEXT,
  disposal_amount REAL,
  disposal_journal_id TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS asset_depreciation (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  period_key TEXT NOT NULL,
  amount REAL NOT NULL,
  journal_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (asset_id, period_key),
  FOREIGN KEY (asset_id) REFERENCES fixed_assets(id) ON DELETE CASCADE
);

-- =============== Finance: approvals & exchange rates ===============
CREATE TABLE IF NOT EXISTS approval_requests (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  amount REAL,
  requested_by TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  decided_by TEXT,
  decided_at TEXT,
  decision_note TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS exchange_rates (
  id TEXT PRIMARY KEY,
  base_currency TEXT NOT NULL DEFAULT 'ZAR',
  quote_currency TEXT NOT NULL,
  rate REAL NOT NULL,
  source TEXT NOT NULL,
  rate_date TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL
);
`;

// ---------------------------------------------------------------------------
// Schema v3 — Enterprise access management, API credentials, CALVIN memory.
// Idempotent, applied in place.
// ---------------------------------------------------------------------------
const SCHEMA_V3 = `
-- =============== account security ===============
ALTER TABLE users ADD COLUMN username TEXT;
ALTER TABLE users ADD COLUMN phone TEXT;
ALTER TABLE users ADD COLUMN department TEXT;
ALTER TABLE users ADD COLUMN job_title TEXT;
ALTER TABLE users ADD COLUMN failed_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN locked_until TEXT;
ALTER TABLE users ADD COLUMN last_password_change TEXT;
ALTER TABLE users ADD COLUMN mfa_enabled INTEGER NOT NULL DEFAULT 0;

ALTER TABLE departments ADD COLUMN code TEXT;
ALTER TABLE departments ADD COLUMN dashboard_route TEXT;

CREATE TABLE IF NOT EXISTS login_events (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  email TEXT NOT NULL,
  success INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  ip TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_events_created ON login_events(created_at);

CREATE TABLE IF NOT EXISTS user_permission_overrides (
  user_id TEXT NOT NULL,
  permission_key TEXT NOT NULL,
  granted INTEGER NOT NULL,
  PRIMARY KEY (user_id, permission_key),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS api_configs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'ai',
  provider TEXT NOT NULL,
  name TEXT NOT NULL,
  base_url TEXT,
  api_key_enc TEXT,
  model TEXT,
  api_version TEXT,
  org_id TEXT,
  extra_headers TEXT,
  max_tokens INTEGER,
  temperature REAL,
  timeout_ms INTEGER NOT NULL DEFAULT 45000,
  enabled INTEGER NOT NULL DEFAULT 1,
  is_primary INTEGER NOT NULL DEFAULT 0,
  is_backup INTEGER NOT NULL DEFAULT 0,
  last_test_at TEXT,
  last_test_status TEXT,
  last_test_message TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_api_configs_kind ON api_configs(kind, enabled);

CREATE TABLE IF NOT EXISTS calvin_memory (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  scope TEXT NOT NULL DEFAULT 'user',
  memory_key TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, scope, memory_key)
);
CREATE INDEX IF NOT EXISTS idx_calvin_memory_user ON calvin_memory(user_id, scope);

-- Office Administration Tables
CREATE TABLE IF NOT EXISTS office_property_docs (
  id TEXT PRIMARY KEY,
  ref TEXT UNIQUE NOT NULL,
  property_id TEXT,
  building_id TEXT,
  category TEXT,
  title TEXT,
  document_type TEXT,
  file_path TEXT,
  file_name TEXT,
  file_mime TEXT,
  expiry_date TEXT,
  status TEXT DEFAULT 'pending',
  uploaded_by TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS office_student_files (
  id TEXT PRIMARY KEY,
  ref TEXT UNIQUE,
  student_id TEXT,
  status TEXT DEFAULT 'pending',
  documents TEXT DEFAULT '[]',
  missing_docs TEXT DEFAULT '[]',
  verified_by TEXT,
  verified_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS office_tenant_applications (
  id TEXT PRIMARY KEY,
  ref TEXT UNIQUE,
  applicant_name TEXT,
  email TEXT,
  phone TEXT,
  property_id TEXT,
  status TEXT DEFAULT 'pending',
  documents TEXT DEFAULT '[]',
  notes TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS office_leases (
  id TEXT PRIMARY KEY,
  ref TEXT UNIQUE NOT NULL,
  property_id TEXT,
  building_id TEXT,
  room_id TEXT,
  student_id TEXT,
  tenant_id TEXT,
  lease_type TEXT DEFAULT 'student',
  commencement_date TEXT,
  expiry_date TEXT,
  renewal_date TEXT,
  status TEXT DEFAULT 'draft',
  signed_date TEXT,
  agreement_path TEXT,
  notes TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS office_documents (
  id TEXT PRIMARY KEY,
  ref TEXT UNIQUE NOT NULL,
  category TEXT NOT NULL,
  subcategory TEXT,
  title TEXT,
  file_path TEXT,
  file_name TEXT,
  file_mime TEXT,
  property_id TEXT,
  related_to TEXT,
  expiry_date TEXT,
  permissions TEXT DEFAULT 'restricted',
  version INTEGER DEFAULT 1,
  status TEXT DEFAULT 'active',
  uploaded_by TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS office_inspections (
  id TEXT PRIMARY KEY,
  ref TEXT UNIQUE NOT NULL,
  property_id TEXT,
  building_id TEXT,
  room_id TEXT,
  inspection_type TEXT DEFAULT 'general',
  scheduled_date TEXT,
  assigned_to TEXT,
  inspector_id TEXT,
  checklist TEXT DEFAULT '[]',
  findings TEXT,
  corrective_actions TEXT,
  status TEXT DEFAULT 'scheduled',
  completion_date TEXT,
  photos TEXT DEFAULT '[]',
  notes TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS office_correspondence (
  id TEXT PRIMARY KEY,
  ref TEXT UNIQUE NOT NULL,
  direction TEXT NOT NULL,
  sender TEXT,
  recipient TEXT,
  subject TEXT,
  category TEXT DEFAULT 'general',
  correspondence_date TEXT,
  property_id TEXT,
  student_id TEXT,
  tenant_id TEXT,
  responsible_employee TEXT,
  status TEXT DEFAULT 'received',
  follow_up_date TEXT,
  attachments TEXT DEFAULT '[]',
  notes TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS office_purchase_requests (
  id TEXT PRIMARY KEY,
  ref TEXT UNIQUE NOT NULL,
  requester_id TEXT,
  category TEXT DEFAULT 'general',
  item_description TEXT,
  quantity INTEGER DEFAULT 1,
  estimated_cost REAL,
  supplier_id TEXT,
  property_id TEXT,
  justification TEXT,
  status TEXT DEFAULT 'pending',
  approved_by TEXT,
  approved_at TEXT,
  po_number TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS office_suppliers (
  id TEXT PRIMARY KEY,
  ref TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  company_reg_no TEXT,
  contact_person TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  services_offered TEXT,
  contract_details TEXT,
  contract_commencement TEXT,
  contract_expiry TEXT,
  renewal_date TEXT,
  status TEXT DEFAULT 'active',
  performance_notes TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS office_assets (
  id TEXT PRIMARY KEY,
  ref TEXT UNIQUE NOT NULL,
  asset_number TEXT,
  asset_name TEXT,
  category TEXT,
  property_id TEXT,
  building_id TEXT,
  room_id TEXT,
  brand TEXT,
  model TEXT,
  serial_number TEXT,
  purchase_date TEXT,
  supplier_id TEXT,
  purchase_value REAL,
  condition TEXT DEFAULT 'good',
  status TEXT DEFAULT 'active',
  warranty_details TEXT,
  maintenance_history TEXT DEFAULT '[]',
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS office_tasks (
  id TEXT PRIMARY KEY,
  ref TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  assigned_to TEXT,
  assigned_by TEXT,
  related_department TEXT,
  related_property_id TEXT,
  related_student_id TEXT,
  related_tenant_id TEXT,
  priority TEXT DEFAULT 'medium',
  start_date TEXT,
  due_date TEXT,
  status TEXT DEFAULT 'pending',
  completion_date TEXT,
  attachments TEXT DEFAULT '[]',
  comments TEXT DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS office_meetings (
  id TEXT PRIMARY KEY,
  ref TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  meeting_type TEXT DEFAULT 'meeting',
  meeting_date TEXT,
  start_time TEXT,
  end_time TEXT,
  location TEXT,
  participants TEXT DEFAULT '[]',
  agenda TEXT,
  minutes TEXT,
  follow_up_actions TEXT DEFAULT '[]',
  status TEXT DEFAULT 'scheduled',
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS office_complaints (
  id TEXT PRIMARY KEY,
  ref TEXT UNIQUE NOT NULL,
  complainant TEXT,
  complainant_type TEXT DEFAULT 'student',
  property_id TEXT,
  building_id TEXT,
  room_id TEXT,
  category TEXT DEFAULT 'general',
  description TEXT,
  priority TEXT DEFAULT 'medium',
  assigned_to TEXT,
  status TEXT DEFAULT 'open',
  actions_taken TEXT,
  resolution_details TEXT,
  closure_date TEXT,
  supporting_docs TEXT DEFAULT '[]',
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS office_compliance (
  id TEXT PRIMARY KEY,
  ref TEXT UNIQUE NOT NULL,
  property_id TEXT,
  compliance_type TEXT,
  document_name TEXT,
  certificate_no TEXT,
  issue_date TEXT,
  expiry_date TEXT,
  status TEXT DEFAULT 'valid',
  responsible_employee TEXT,
  file_path TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS office_requests (
  id TEXT PRIMARY KEY,
  ref TEXT UNIQUE NOT NULL,
  request_type TEXT,
  requested_by TEXT,
  property_id TEXT,
  description TEXT,
  status TEXT DEFAULT 'open',
  assigned_to TEXT,
  priority TEXT DEFAULT 'medium',
  due_date TEXT,
  resolution TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

/** Run idempotent DDL, ignoring "duplicate column" errors from ALTER TABLE. */
function applyDdl(sql) {
  for (const raw of sql.split(';').map((s) => s.trim()).filter(Boolean)) {
    // skip chunks that contain only `--` comment lines
    const stmt = raw.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').trim();
    if (!stmt) continue;
    try {
      db.exec(stmt + ';');
    } catch (err) {
      const msg = String(err?.message || err);
      if (/duplicate column|already exists/i.test(msg)) continue;
      throw err;
    }
  }
}

export function ensureSchema() {
  db.exec(SCHEMA);
  applyDdl(SCHEMA_V2);
  applyDdl(SCHEMA_V3);
  db.prepare(
    "INSERT OR IGNORE INTO schema_meta (key, value) VALUES ('version', '3')"
  ).run();
  db.prepare("UPDATE schema_meta SET value = '3' WHERE key = 'version'").run();
}

/** Audit trail helper — every significant action goes through here. */
export function audit({ userId, userEmail, action, entityType, entityId, summary, details, ip }) {
  db.prepare(
    `INSERT INTO audit_logs (id, user_id, user_email, action, entity_type, entity_id, summary, details, ip, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    newId(), userId ?? null, userEmail ?? null, action, entityType ?? null,
    entityId ?? null, summary ?? null,
    details ? JSON.stringify(details) : null, ip ?? null, now()
  );
}

ensureSchema();
