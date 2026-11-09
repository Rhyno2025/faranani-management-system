// ---------------------------------------------------------------------------
// Human Resources routes — employee records, recruitment, attendance & shifts,
// leave, payroll, performance, training and employee relations.
//
// Every figure returned here is derived from stored records. Where no records
// exist the API returns zeros / empty arrays and the UI shows an empty state.
// Sensitive fields (salary, banking, tax, disciplinary cases) are stripped
// server-side unless the caller holds the matching permission.
// ---------------------------------------------------------------------------
import { Router } from 'express';
import { db, newId, nextRef, now, tx, audit } from '../db.js';
import { requirePerm, can } from '../auth.js';
import {
  ah, listParams, paginated, likeTerm, isBlank, num, todayISO,
  notify, notifyRoles, getSetting, setSetting,
} from '../util.js';

export const hrRouter = Router();

const SENSITIVE_FIELDS = ['base_salary', 'bank_name', 'bank_account', 'tax_number', 'uif_number'];

const EMPLOYEE_FIELDS = [
  'full_name', 'job_title', 'department', 'branch', 'email', 'phone', 'property_id', 'role',
  'employment_status', 'employment_type', 'hired_at', 'contract_start', 'contract_end',
  'probation_end', 'date_of_birth', 'gender', 'id_number', 'address_line', 'address_city',
  'postal_address', 'emergency_contact_name', 'emergency_contact_phone',
  'emergency_contact_relationship', 'next_of_kin', 'base_salary', 'salary_frequency',
  'bank_name', 'bank_account', 'tax_number', 'uif_number', 'qualifications', 'skills',
  'manager_id', 'shift_notes', 'notes',
];

/** Strip salary / banking / tax fields unless the caller may see them. */
function sanitizeEmployee(row, req) {
  if (!row) return row;
  if (can(req, 'hr.salary')) return row;
  const out = { ...row };
  for (const f of SENSITIVE_FIELDS) out[f] = null;
  out.restricted_fields = SENSITIVE_FIELDS;
  return out;
}

function workingDaysBetween(from, to) {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 0;
  const holidays = new Set(
    db.prepare('SELECT holiday_date FROM public_holidays').all().map((h) => h.holiday_date)
  );
  let count = 0;
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    if (holidays.has(iso)) continue;
    count++;
  }
  return count;
}

function ensurePeriodOpen(req, entryDate) {
  const key = String(entryDate).slice(0, 7);
  const period = db.prepare('SELECT * FROM accounting_periods WHERE period_key = ?').get(key);
  if (period && period.status !== 'open') {
    const err = new Error(`Accounting period ${key} is ${period.status}. Postings are not allowed.`);
    err.status = 409;
    throw err;
  }
  return period || null;
}

// ===========================================================================
// Dashboard
// ===========================================================================

hrRouter.get('/hr/dashboard', requirePerm('hr.dashboard', 'staff.view'), ah(async (req, res) => {
  const today = todayISO();
  const monthStart = `${today.slice(0, 7)}-01`;
  const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const since12 = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);

  const one = (sql, ...args) => db.prepare(sql).get(...args)?.c ?? 0;

  const counts = {
    total: one("SELECT COUNT(*) c FROM staff WHERE archived_at IS NULL"),
    active: one("SELECT COUNT(*) c FROM staff WHERE employment_status = 'active' AND archived_at IS NULL"),
    on_leave: one("SELECT COUNT(*) c FROM staff WHERE employment_status = 'on_leave' AND archived_at IS NULL"),
    inactive: one("SELECT COUNT(*) c FROM staff WHERE employment_status = 'inactive' AND archived_at IS NULL"),
    terminated: one("SELECT COUNT(*) c FROM staff WHERE employment_status = 'terminated'"),
    pending_leave: one("SELECT COUNT(*) c FROM leave_requests WHERE status = 'pending'"),
    open_requisitions: one("SELECT COUNT(*) c FROM job_requisitions WHERE status = 'open'"),
    applicants: one('SELECT COUNT(*) c FROM job_applicants'),
    pending_reviews: one("SELECT COUNT(*) c FROM performance_reviews WHERE status IN ('draft','submitted')"),
    open_cases: one("SELECT COUNT(*) c FROM hr_cases WHERE status NOT IN ('closed','resolved')"),
    contracts_expiring: db.prepare(
      "SELECT COUNT(*) c FROM staff WHERE archived_at IS NULL AND contract_end IS NOT NULL AND contract_end >= ? AND contract_end <= ?"
    ).get(today, in30).c,
    probation_ending: db.prepare(
      "SELECT COUNT(*) c FROM staff WHERE archived_at IS NULL AND probation_end IS NOT NULL AND probation_end >= ? AND probation_end <= ?"
    ).get(today, in30).c,
    exits_12m: one('SELECT COUNT(*) c FROM employee_exits WHERE created_at >= ?', since12),
    trainings: one('SELECT COUNT(*) c FROM training_programs'),
    overdue_tasks: one("SELECT COUNT(*) c FROM onboarding_tasks WHERE status != 'completed' AND due_date IS NOT NULL AND due_date < ?", today),
  };

  // attendance for the current month
  const att = db.prepare(`
    SELECT
      COUNT(*) AS records,
      SUM(CASE WHEN clock_in IS NOT NULL THEN 1 ELSE 0 END) AS present,
      SUM(CASE WHEN late_minutes > 0 THEN 1 ELSE 0 END) AS late,
      COALESCE(SUM(worked_minutes), 0) AS worked,
      COALESCE(SUM(overtime_minutes), 0) AS overtime
    FROM attendance_records WHERE work_date >= ?
  `).get(monthStart) || {};
  const attendanceToday = db.prepare(`
    SELECT COUNT(*) c FROM attendance_records WHERE work_date = ? AND clock_in IS NOT NULL
  `).get(today).c;

  // who is on approved leave today
  const onLeaveNow = db.prepare(`
    SELECT s.full_name, s.employee_ref, lt.name AS leave_type
    FROM leave_requests lr
    JOIN staff s ON s.id = lr.staff_id
    JOIN leave_types lt ON lt.id = lr.leave_type_id
    WHERE lr.status = 'approved' AND date(?) BETWEEN date(lr.start_date) AND date(lr.end_date)
    ORDER BY s.full_name
  `).all(today);

  // upcoming birthdays and work anniversaries (real DOB / appointment dates)
  const birthdays = db.prepare(`
    SELECT id, full_name, employee_ref, date_of_birth FROM staff
    WHERE archived_at IS NULL AND date_of_birth IS NOT NULL
      AND strftime('%m-%d', date_of_birth) BETWEEN strftime('%m-%d', ?) AND strftime('%m-%d', ?)
    ORDER BY strftime('%m-%d', date_of_birth)
  `).all(today, in30).map((r) => ({
    ...r,
    next_on: `${new Date().getFullYear()}-${r.date_of_birth.slice(5, 10)}`,
  }));
  const anniversaries = db.prepare(`
    SELECT id, full_name, employee_ref, hired_at FROM staff
    WHERE archived_at IS NULL AND hired_at IS NOT NULL
      AND strftime('%m-%d', hired_at) BETWEEN strftime('%m-%d', ?) AND strftime('%m-%d', ?)
    ORDER BY strftime('%m-%d', hired_at)
  `).all(today, in30);

  const contractAlerts = db.prepare(`
    SELECT id, full_name, employee_ref, job_title, contract_end FROM staff
    WHERE archived_at IS NULL AND contract_end IS NOT NULL AND contract_end >= ? AND contract_end <= ?
    ORDER BY contract_end
  `).all(today, in30);

  // workforce trend: hires vs exits per month for the last 12 months
  const trend = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i, 1);
    const key = d.toISOString().slice(0, 7);
    const hires = db.prepare("SELECT COUNT(*) c FROM staff WHERE substr(hired_at,1,7) = ?").get(key).c;
    const exits = db.prepare("SELECT COUNT(*) c FROM employee_exits WHERE substr(COALESCE(last_working_day, created_at),1,7) = ?").get(key).c;
    trend.push({ month: key, hires, exits });
  }

  const latestPayroll = db.prepare(
    'SELECT period_key, label, status, net_total, employee_count FROM payroll_periods ORDER BY period_key DESC LIMIT 1'
  ).get() || null;

  const trainingProgress = db.prepare(`
    SELECT COUNT(*) total,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) completed
    FROM training_enrollments
  `).get();

  res.json({
    generated_at: now(),
    counts,
    attendance: {
      month_records: att.records || 0,
      month_present: att.present || 0,
      month_late: att.late || 0,
      month_worked_minutes: att.worked || 0,
      month_overtime_minutes: att.overtime || 0,
      today_present: attendanceToday,
      on_leave_today: onLeaveNow.length,
    },
    on_leave_now: onLeaveNow,
    birthdays,
    anniversaries,
    contract_alerts: contractAlerts,
    trend,
    latest_payroll: latestPayroll,
    training: { total: trainingProgress.total || 0, completed: trainingProgress.completed || 0 },
  });
}));

// ===========================================================================
// Employees
// ===========================================================================

hrRouter.get('/hr/employees', requirePerm('staff.view'), ah(async (req, res) => {
  const { q, page, pageSize, offset, sort, dir } = listParams(req);
  const where = ['1=1'];
  const args = [];
  if (q) {
    where.push("(s.full_name LIKE ? ESCAPE '\\' OR s.employee_ref LIKE ? ESCAPE '\\' OR s.email LIKE ? ESCAPE '\\' OR s.job_title LIKE ? ESCAPE '\\')");
    const t = likeTerm(q); args.push(t, t, t, t);
  }
  if (req.query.status) { where.push('s.employment_status = ?'); args.push(String(req.query.status)); }
  if (req.query.department) { where.push('s.department = ?'); args.push(String(req.query.department)); }
  if (req.query.archived === '1') where.push('s.archived_at IS NOT NULL');
  else where.push('s.archived_at IS NULL');
  const sortable = new Set(['full_name', 'employee_ref', 'job_title', 'department', 'employment_status', 'hired_at']);
  const col = sortable.has(sort) ? `s.${sort}` : 's.full_name';
  const total = db.prepare(`SELECT COUNT(*) c FROM staff s WHERE ${where.join(' AND ')}`).get(...args).c;
  const rows = db.prepare(`
    SELECT s.*, p.name AS property_name, m.full_name AS manager_name,
      (SELECT COUNT(*) FROM onboarding_tasks ot WHERE ot.staff_id = s.id AND ot.status != 'completed') AS open_onboarding
    FROM staff s
    LEFT JOIN properties p ON p.id = s.property_id
    LEFT JOIN staff m ON m.id = s.manager_id
    WHERE ${where.join(' AND ')}
    ORDER BY ${col} ${dir} LIMIT ? OFFSET ?
  `).all(...args, pageSize, offset);
  res.json(paginated(rows.map((r) => sanitizeEmployee(r, req)), total, page, pageSize));
}));

hrRouter.get('/hr/employees/:id', requirePerm('staff.view'), ah(async (req, res) => {
  const row = db.prepare(`
    SELECT s.*, p.name AS property_name, m.full_name AS manager_name
    FROM staff s LEFT JOIN properties p ON p.id = s.property_id
    LEFT JOIN staff m ON m.id = s.manager_id WHERE s.id = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Employee not found.' });

  const leave = db.prepare(`
    SELECT lr.*, lt.name AS leave_type FROM leave_requests lr
    JOIN leave_types lt ON lt.id = lr.leave_type_id
    WHERE lr.staff_id = ? ORDER BY lr.created_at DESC LIMIT 25
  `).all(row.id);
  const attendance = db.prepare(
    'SELECT * FROM attendance_records WHERE staff_id = ? ORDER BY work_date DESC LIMIT 31'
  ).all(row.id);
  const onboarding = db.prepare(
    'SELECT * FROM onboarding_tasks WHERE staff_id = ? ORDER BY status, due_date'
  ).all(row.id);
  const reviews = db.prepare(
    'SELECT * FROM performance_reviews WHERE staff_id = ? ORDER BY created_at DESC'
  ).all(row.id);
  const cases = can(req, 'hr.cases')
    ? db.prepare('SELECT id, case_ref, type, title, status, severity, created_at FROM hr_cases WHERE staff_id = ? ORDER BY created_at DESC').all(row.id)
    : [];

  // leave balances from approved leave taken in the current cycle
  const yearStart = `${new Date().getFullYear()}-01-01`;
  const usedByType = db.prepare(`
    SELECT leave_type_id, SUM(days) used FROM leave_requests
    WHERE staff_id = ? AND status = 'approved' AND start_date >= ?
    GROUP BY leave_type_id
  `).all(row.id, yearStart);
  const types = db.prepare('SELECT * FROM leave_types WHERE active = 1 ORDER BY sort_order').all();
  const balances = types.map((t) => {
    const used = usedByType.find((u) => u.leave_type_id === t.id)?.used || 0;
    return { leave_type_id: t.id, name: t.name, entitlement: t.days_per_year, used, remaining: Math.max(0, t.days_per_year - used) };
  });

  res.json({
    ...sanitizeEmployee(row, req),
    leave_requests: leave,
    attendance,
    onboarding,
    reviews,
    cases,
    balances,
  });
}));

hrRouter.post('/hr/employees', requirePerm('staff.manage'), ah(async (req, res) => {
  const b = req.body || {};
  if (isBlank(b.full_name)) return res.status(400).json({ error: 'Full name is required.' });
  if (!can(req, 'hr.salary')) delete b.base_salary;

  const id = newId();
  const ref = nextRef(db, 'FAR-EMP');
  const t = now();
  const sets = { id, employee_ref: ref, employment_status: 'active', employment_type: 'permanent', created_at: t, updated_at: t };
  const columns = [];
  const values = [];
  for (const f of EMPLOYEE_FIELDS) {
    if (b[f] !== undefined) { columns.push(f); values.push(b[f] === '' ? null : b[f]); }
  }
  db.prepare(`
    INSERT INTO staff (id, employee_ref, employment_status, employment_type, created_at, updated_at, ${columns.join(', ')})
    VALUES (?, ?, ?, ?, ?, ?, ${columns.map(() => '?').join(', ')})
  `).run(id, ref, sets.employment_status, sets.employment_type, t, t, ...values);

  // standard onboarding checklist for a new employee (workflow, not demo data)
  const checklist = [
    ['Employment contract prepared and signed', 'Contract'],
    ['Certified ID and qualification documents verified', 'Documents'],
    ['Policy & handbook acknowledgement signed', 'Compliance'],
    ['Banking and payroll details captured', 'Payroll'],
    ['Equipment, keys and system access issued', 'Assets'],
    ['Department and reporting line confirmed', 'Organisation'],
    ['Orientation and induction completed', 'Training'],
    ['Probation review scheduled', 'Compliance'],
  ];
  const ins = db.prepare(
    'INSERT INTO onboarding_tasks (id, staff_id, title, category, due_date, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const due = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  for (const [title, category] of checklist) ins.run(newId(), id, title, category, due, 'pending', t);

  audit({
    userId: req.user.id, userEmail: req.user.email, action: 'employee.create',
    entityType: 'employee', entityId: id, summary: `Created employee ${ref} — ${b.full_name}`, ip: req.ip,
  });
  notifyRoles(['super_admin', 'hr_manager', 'hr_officer'], {
    type: 'hr', title: 'New employee onboarding', body: `${ref} — ${b.full_name}`, link: '/hr',
  });
  res.status(201).json(db.prepare('SELECT * FROM staff WHERE id = ?').get(id));
}));

hrRouter.patch('/hr/employees/:id', requirePerm('staff.manage'), ah(async (req, res) => {
  const existing = db.prepare('SELECT * FROM staff WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Employee not found.' });
  const b = req.body || {};
  const sets = []; const args = [];
  for (const f of EMPLOYEE_FIELDS) {
    if (b[f] !== undefined) {
      if (SENSITIVE_FIELDS.includes(f) && !can(req, 'hr.salary')) continue;
      sets.push(`${f} = ?`); args.push(b[f] === '' ? null : b[f]);
    }
  }
  if (b.archived === true) { sets.push('archived_at = ?'); args.push(now()); }
  if (b.archived === false) { sets.push('archived_at = NULL'); }
  if (!sets.length) return res.json(existing);
  sets.push('updated_at = ?'); args.push(now());
  args.push(req.params.id);
  db.prepare(`UPDATE staff SET ${sets.join(', ')} WHERE id = ?`).run(...args);
  audit({
    userId: req.user.id, userEmail: req.user.email, action: 'employee.update',
    entityType: 'employee', entityId: req.params.id,
    summary: `Updated employee ${existing.employee_ref} — ${Object.keys(b).join(', ')}`, details: { fields: Object.keys(b) }, ip: req.ip,
  });
  res.json(db.prepare('SELECT * FROM staff WHERE id = ?').get(req.params.id));
}));

/** Exit / termination workflow. */
hrRouter.post('/hr/employees/:id/exit', requirePerm('staff.manage'), ah(async (req, res) => {
  const staff = db.prepare('SELECT * FROM staff WHERE id = ?').get(req.params.id);
  if (!staff) return res.status(404).json({ error: 'Employee not found.' });
  const b = req.body || {};
  if (isBlank(b.last_working_day)) return res.status(400).json({ error: 'Last working day is required.' });
  const t = now();
  const id = newId();
  tx(() => {
    db.prepare(`
      INSERT INTO employee_exits (id, staff_id, exit_type, resignation_date, last_working_day,
        notice_period_days, exit_interview, status, initiated_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)
    `).run(id, staff.id, b.exit_type || 'resignation', b.resignation_date || t.slice(0, 10),
      b.last_working_day, num(b.notice_period_days, 30), b.exit_interview || null, req.user.id, t, t);
    db.prepare(
      "UPDATE staff SET employment_status = 'terminated', exit_type = ?, exit_date = ?, exit_reason = ?, updated_at = ? WHERE id = ?"
    ).run(b.exit_type || 'resignation', b.last_working_day, b.reason || null, t, staff.id);
  });
  audit({
    userId: req.user.id, userEmail: req.user.email, action: 'employee.exit',
    entityType: 'employee', entityId: staff.id,
    summary: `Recorded ${b.exit_type || 'resignation'} for ${staff.employee_ref} — last day ${b.last_working_day}`, ip: req.ip,
  });
  res.status(201).json(db.prepare('SELECT * FROM employee_exits WHERE id = ?').get(id));
}));

// ===========================================================================
// Attendance & shifts
// ===========================================================================

hrRouter.get('/hr/attendance', requirePerm('staff.view'), ah(async (req, res) => {
  const { page, pageSize, offset } = listParams(req);
  const from = String(req.query.from || todayISO().slice(0, 7) + '-01');
  const to = String(req.query.to || todayISO());
  const where = ['date(a.work_date) BETWEEN date(?) AND date(?)'];
  const args = [from, to];
  if (req.query.staff_id) { where.push('a.staff_id = ?'); args.push(String(req.query.staff_id)); }
  if (req.query.department) { where.push('s.department = ?'); args.push(String(req.query.department)); }
  const total = db.prepare(`SELECT COUNT(*) c FROM attendance_records a JOIN staff s ON s.id = a.staff_id WHERE ${where.join(' AND ')}`).get(...args).c;
  const rows = db.prepare(`
    SELECT a.*, s.full_name, s.employee_ref, s.department, s.job_title
    FROM attendance_records a JOIN staff s ON s.id = a.staff_id
    WHERE ${where.join(' AND ')} ORDER BY a.work_date DESC, s.full_name LIMIT ? OFFSET ?
  `).all(...args, pageSize, offset);
  const summary = db.prepare(`
    SELECT COUNT(*) records,
      SUM(CASE WHEN clock_in IS NOT NULL THEN 1 ELSE 0 END) present,
      SUM(CASE WHEN late_minutes > 0 THEN 1 ELSE 0 END) late,
      SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) absent,
      COALESCE(SUM(worked_minutes),0) worked, COALESCE(SUM(overtime_minutes),0) overtime
    FROM attendance_records a JOIN staff s ON s.id = a.staff_id WHERE ${where.join(' AND ')}
  `).get(...args);
  res.json({ ...paginated(rows, total, page, pageSize), summary });
}));

/** Clock in / out — server timestamp in the configured company timezone. */
hrRouter.post('/hr/attendance/clock', requirePerm('staff.view'), ah(async (req, res) => {
  const staffId = req.user.staff_id || String(req.body?.staff_id || '');
  if (!staffId) return res.status(400).json({ error: 'Your account is not linked to an employee record.' });
  const staff = db.prepare('SELECT * FROM staff WHERE id = ?').get(staffId);
  if (!staff) return res.status(404).json({ error: 'Employee record not found.' });

  const action = req.body?.action === 'out' ? 'out' : 'in';
  const stamp = now();
  const date = todayISO();
  const shift = db.prepare(
    'SELECT * FROM shift_schedules WHERE staff_id = ? AND shift_date = ? ORDER BY start_time LIMIT 1'
  ).get(staffId, date);
  const shiftStart = shift?.start_time || '08:00';
  const shiftEnd = shift?.end_time || '17:00';

  const existing = db.prepare('SELECT * FROM attendance_records WHERE staff_id = ? AND work_date = ?').get(staffId, date);
  let record;

  if (action === 'in') {
    if (existing?.clock_in) return res.status(409).json({ error: 'You are already clocked in for today.' });
    const clockTime = stamp.slice(11, 16);
    const lateMinutes = clockTime > shiftStart
      ? Math.round((Date.parse(`1970-01-01T${clockTime}:00Z`) - Date.parse(`1970-01-01T${shiftStart}:00Z`)) / 60000)
      : 0;
    if (existing) {
      db.prepare(`
        UPDATE attendance_records SET clock_in = ?, late_minutes = ?, status = ?, source = 'manual',
          shift_start = ?, shift_end = ?, updated_at = ? WHERE id = ?
      `).run(stamp, lateMinutes, lateMinutes > 0 ? 'present' : 'present', shiftStart, shiftEnd, stamp, existing.id);
    } else {
      db.prepare(`
        INSERT INTO attendance_records (id, staff_id, work_date, clock_in, source, status, late_minutes,
          shift_start, shift_end, recorded_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'manual', 'present', ?, ?, ?, ?, ?, ?)
      `).run(newId(), staffId, date, stamp, lateMinutes, shiftStart, shiftEnd, req.user.id, stamp, stamp);
    }
  } else {
    if (!existing?.clock_in) return res.status(409).json({ error: 'You have not clocked in today.' });
    if (existing.clock_out) return res.status(409).json({ error: 'You are already clocked out for today.' });
    const inMin = timeToMinutes(existing.clock_in.slice(11, 16));
    const outMin = timeToMinutes(stamp.slice(11, 16));
    const worked = Math.max(0, outMin - inMin);
    const shiftEndMin = timeToMinutes(shiftEnd);
    const overtime = Math.max(0, outMin - shiftEndMin);
    db.prepare(`
      UPDATE attendance_records SET clock_out = ?, worked_minutes = ?, overtime_minutes = ?, updated_at = ? WHERE id = ?
    `).run(stamp, worked, overtime, stamp, existing.id);
  }
  record = db.prepare('SELECT * FROM attendance_records WHERE staff_id = ? AND work_date = ?').get(staffId, date);
  res.status(201).json(record);
}));

function timeToMinutes(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Manual attendance entry or authorised correction. */
hrRouter.post('/hr/attendance', requirePerm('hr.attendance'), ah(async (req, res) => {
  const b = req.body || {};
  if (isBlank(b.staff_id) || isBlank(b.work_date)) return res.status(400).json({ error: 'Employee and work date are required.' });
  const stamp = now();
  const existing = db.prepare('SELECT * FROM attendance_records WHERE staff_id = ? AND work_date = ?').get(b.staff_id, b.work_date);

  if (existing) {
    if (!can(req, 'hr.attendance.correct')) {
      return res.status(403).json({ error: 'Correcting recorded attendance requires the “Correct recorded attendance” permission.' });
    }
    if (isBlank(b.correction_note)) {
      return res.status(400).json({ error: 'A correction reason is required — recorded timestamps are never changed silently.' });
    }
    db.prepare(`
      UPDATE attendance_records SET clock_in = ?, clock_out = ?, worked_minutes = ?, overtime_minutes = ?,
        status = ?, note = ?, correction_note = ?, corrected_by = ?, corrected_at = ?, updated_at = ?
      WHERE id = ?
    `).run(b.clock_in || null, b.clock_out || null, num(b.worked_minutes, 0), num(b.overtime_minutes, 0),
      b.status || existing.status, b.note || null, b.correction_note, req.user.id, stamp, stamp, existing.id);
    audit({
      userId: req.user.id, userEmail: req.user.email, action: 'attendance.correct',
      entityType: 'attendance', entityId: existing.id,
      summary: `Corrected attendance for ${b.work_date}: ${b.correction_note}`, ip: req.ip,
    });
    return res.json(db.prepare('SELECT * FROM attendance_records WHERE id = ?').get(existing.id));
  }

  const id = newId();
  db.prepare(`
    INSERT INTO attendance_records (id, staff_id, work_date, clock_in, clock_out, source, status,
      late_minutes, worked_minutes, overtime_minutes, note, recorded_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'manual', ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, b.staff_id, b.work_date, b.clock_in || null, b.clock_out || null, b.status || 'present',
    num(b.late_minutes, 0), num(b.worked_minutes, 0), num(b.overtime_minutes, 0), b.note || null,
    req.user.id, stamp, stamp);
  audit({
    userId: req.user.id, userEmail: req.user.email, action: 'attendance.create',
    entityType: 'attendance', entityId: id, summary: `Recorded attendance for ${b.work_date}`, ip: req.ip,
  });
  res.status(201).json(db.prepare('SELECT * FROM attendance_records WHERE id = ?').get(id));
}));

hrRouter.get('/hr/shifts', requirePerm('staff.view'), ah(async (req, res) => {
  const from = String(req.query.from || todayISO());
  const to = String(req.query.to || todayISO());
  const rows = db.prepare(`
    SELECT sh.*, s.full_name, s.employee_ref FROM shift_schedules sh
    JOIN staff s ON s.id = sh.staff_id
    WHERE date(sh.shift_date) BETWEEN date(?) AND date(?) ORDER BY sh.shift_date, sh.start_time
  `).all(from, to);
  res.json({ data: rows });
}));

hrRouter.post('/hr/shifts', requirePerm('hr.attendance'), ah(async (req, res) => {
  const b = req.body || {};
  if (isBlank(b.staff_id) || isBlank(b.shift_date)) return res.status(400).json({ error: 'Employee and date are required.' });
  const id = newId();
  db.prepare(`
    INSERT INTO shift_schedules (id, staff_id, shift_date, name, start_time, end_time, note, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, b.staff_id, b.shift_date, b.name || 'Standard', b.start_time || '08:00',
    b.end_time || '17:00', b.note || null, req.user.id, now());
  res.status(201).json({ id });
}));

// ===========================================================================
// Leave
// ===========================================================================

hrRouter.get('/hr/leave/types', requirePerm('staff.view'), ah(async (req, res) => {
  res.json({ data: db.prepare('SELECT * FROM leave_types ORDER BY sort_order, name').all() });
}));

hrRouter.get('/hr/leave/requests', requirePerm('staff.view'), ah(async (req, res) => {
  const { q, page, pageSize, offset } = listParams(req);
  const where = ['1=1']; const args = [];
  if (q) { where.push("(s.full_name LIKE ? ESCAPE '\\' OR lr.leave_ref LIKE ? ESCAPE '\\')"); const t = likeTerm(q); args.push(t, t); }
  if (req.query.status) { where.push('lr.status = ?'); args.push(String(req.query.status)); }
  if (req.query.staff_id) { where.push('lr.staff_id = ?'); args.push(String(req.query.staff_id)); }
  // Employees may only see their own requests unless they can approve
  if (!can(req, 'hr.leave.approve') && !can(req, 'hr.dashboard') && req.user.staff_id) {
    where.push('lr.staff_id = ?'); args.push(req.user.staff_id);
  }
  const total = db.prepare(`SELECT COUNT(*) c FROM leave_requests lr JOIN staff s ON s.id = lr.staff_id WHERE ${where.join(' AND ')}`).get(...args).c;
  const rows = db.prepare(`
    SELECT lr.*, s.full_name, s.employee_ref, s.department, lt.name AS leave_type,
      mb.full_name AS manager_decided_name, hr_user.full_name AS hr_decided_name
    FROM leave_requests lr
    JOIN staff s ON s.id = lr.staff_id
    JOIN leave_types lt ON lt.id = lr.leave_type_id
    LEFT JOIN users mb ON mb.id = lr.manager_decided_by
    LEFT JOIN users hr_user ON hr_user.id = lr.hr_decided_by
    WHERE ${where.join(' AND ')} ORDER BY lr.created_at DESC LIMIT ? OFFSET ?
  `).all(...args, pageSize, offset);
  res.json(paginated(rows, total, page, pageSize));
}));

hrRouter.post('/hr/leave/requests', requirePerm('staff.view'), ah(async (req, res) => {
  const b = req.body || {};
  const staffId = (!can(req, 'hr.leave.approve') && !can(req, 'staff.manage')) ? req.user.staff_id : (b.staff_id || req.user.staff_id);
  if (isBlank(staffId) || isBlank(b.leave_type_id) || isBlank(b.start_date) || isBlank(b.end_date)) {
    return res.status(400).json({ error: 'Employee, leave type, start and end dates are required.' });
  }
  if (b.end_date < b.start_date) return res.status(400).json({ error: 'End date cannot be before the start date.' });
  const type = db.prepare('SELECT * FROM leave_types WHERE id = ?').get(b.leave_type_id);
  if (!type) return res.status(404).json({ error: 'Leave type not found.' });

  const days = workingDaysBetween(b.start_date, b.end_date);
  if (days <= 0) return res.status(400).json({ error: 'The selected range contains no working days.' });

  // overlapping request validation
  const overlap = db.prepare(`
    SELECT leave_ref FROM leave_requests
    WHERE staff_id = ? AND status IN ('pending','approved')
      AND date(start_date) <= date(?) AND date(end_date) >= date(?)
    LIMIT 1
  `).get(staffId, b.end_date, b.start_date);
  if (overlap) return res.status(409).json({ error: `This request overlaps existing leave ${overlap.leave_ref}.` });

  if (type.requires_document && !b.document_path) {
    return res.status(400).json({ error: `${type.name} requires a supporting document. Upload it in Documents first.` });
  }

  // balance check against entitlement (only where an entitlement is configured)
  if (type.days_per_year > 0) {
    const yearStart = `${new Date().getFullYear()}-01-01`;
    const used = db.prepare(
      "SELECT COALESCE(SUM(days),0) u FROM leave_requests WHERE staff_id = ? AND leave_type_id = ? AND status = 'approved' AND start_date >= ?"
    ).get(staffId, type.id, yearStart).u;
    if (used + days > type.days_per_year) {
      return res.status(409).json({
        error: `Insufficient ${type.name} balance: ${type.days_per_year - used} day(s) available, ${days} requested.`,
      });
    }
  }

  const id = newId();
  const ref = nextRef(db, 'FAR-LV');
  const t = now();
  db.prepare(`
    INSERT INTO leave_requests (id, leave_ref, staff_id, leave_type_id, start_date, end_date, days, reason,
      document_path, status, submitted_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
  `).run(id, ref, staffId, type.id, b.start_date, b.end_date, days, b.reason || null,
    b.document_path || null, req.user.id, t, t);

  audit({
    userId: req.user.id, userEmail: req.user.email, action: 'leave.apply',
    entityType: 'leave', entityId: id, summary: `Applied for ${type.name} (${ref}): ${b.start_date} → ${b.end_date} (${days} days)`, ip: req.ip,
  });
  notifyRoles(['super_admin', 'hr_manager', 'hr_officer', 'department_manager'], {
    type: 'leave', title: 'Leave request awaiting approval', body: `${ref} — ${days} day(s) of ${type.name}`, link: '/hr?tab=leave',
  });
  res.status(201).json(db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(id));
}));

hrRouter.post('/hr/leave/requests/:id/decision', requirePerm('staff.view'), ah(async (req, res) => {
  const lr = db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(req.params.id);
  if (!lr) return res.status(404).json({ error: 'Leave request not found.' });
  const stage = req.body?.stage === 'hr' ? 'hr' : 'manager';
  const approve = req.body?.decision !== 'reject';
  const t = now();

  if (stage === 'manager' && !can(req, 'hr.leave.approve') && !can(req, 'department_manager')) {
    return res.status(403).json({ error: 'You do not have permission to approve leave.' });
  }
  if (stage === 'hr' && !can(req, 'hr.leave.approve')) {
    return res.status(403).json({ error: 'HR verification permission is required.' });
  }

  if (stage === 'manager') {
    db.prepare(`
      UPDATE leave_requests SET manager_decision = ?, manager_decided_by = ?, manager_decided_at = ?,
        status = ?, updated_at = ? WHERE id = ?
    `).run(approve ? 'approved' : 'rejected', req.user.id, t, approve ? 'hr_pending' : 'rejected', t, lr.id);
  } else {
    if (lr.manager_decision === 'rejected') return res.status(409).json({ error: 'This request was already rejected.' });
    db.prepare(`
      UPDATE leave_requests SET hr_decision = ?, hr_decided_by = ?, hr_decided_at = ?, status = ?, updated_at = ? WHERE id = ?
    `).run(approve ? 'approved' : 'rejected', req.user.id, t, approve ? 'approved' : 'rejected', t, lr.id);
  }

  const finalStatus = db.prepare('SELECT status FROM leave_requests WHERE id = ?').get(lr.id).status;
  const staff = db.prepare('SELECT * FROM staff WHERE id = ?').get(lr.staff_id);
  if (staff?.email) {
    notify({ userId: null, studentId: null, type: 'leave', title: `Leave ${lr.leave_ref} ${finalStatus}`,
      body: `Your leave request is now ${finalStatus}.`, link: '/hr?tab=leave' });
  }
  audit({
    userId: req.user.id, userEmail: req.user.email, action: `leave.${stage}.${approve ? 'approve' : 'reject'}`,
    entityType: 'leave', entityId: lr.id,
    summary: `${stage === 'manager' ? 'Manager' : 'HR'} ${approve ? 'approved' : 'rejected'} ${lr.leave_ref} for ${staff?.full_name || 'employee'}`, ip: req.ip,
  });
  res.json({ ok: true, status: finalStatus });
}));

hrRouter.post('/hr/leave/requests/:id/cancel', requirePerm('staff.view'), ah(async (req, res) => {
  const lr = db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(req.params.id);
  if (!lr) return res.status(404).json({ error: 'Leave request not found.' });
  const isOwn = lr.staff_id === req.user.staff_id;
  if (!isOwn && !can(req, 'hr.leave.approve')) return res.status(403).json({ error: 'You can only cancel your own leave requests.' });
  if (['rejected', 'cancelled'].includes(lr.status)) return res.status(409).json({ error: `This request is already ${lr.status}.` });
  db.prepare("UPDATE leave_requests SET status = 'cancelled', cancellation_reason = ?, updated_at = ? WHERE id = ?")
    .run(req.body?.reason || null, now(), lr.id);
  audit({ userId: req.user.id, userEmail: req.user.email, action: 'leave.cancel',
    entityType: 'leave', entityId: lr.id, summary: `Cancelled ${lr.leave_ref}`, ip: req.ip });
  res.json({ ok: true, status: 'cancelled' });
}));

// ===========================================================================
// Payroll
// ===========================================================================

/** SARS annual-equivalent PAYE calculation for a monthly gross amount. */
function calculatePaye(monthlyGross, taxCfg) {
  const annual = monthlyGross * 12;
  let bracket = taxCfg.brackets[0];
  for (const b of taxCfg.brackets) {
    if (b.up_to === null || annual <= b.up_to) { bracket = b; break; }
  }
  const above = bracket.up_to === null ? annual : Math.max(0, annual - (taxCfg.brackets[taxCfg.brackets.indexOf(bracket) - 1]?.up_to ?? 0));
  // base + rate × income above the bracket floor
  const floor = bracket.up_to === null
    ? taxCfg.brackets[taxCfg.brackets.length - 2].up_to
    : (taxCfg.brackets[taxCfg.brackets.indexOf(bracket) - 1]?.up_to ?? 0);
  const taxBefore = bracket.base + bracket.rate * Math.max(0, annual - floor);
  const afterRebate = Math.max(0, taxBefore - taxCfg.rebates.primary);
  return Math.round((afterRebate / 12) * 100) / 100;
}

function calculateUif(monthlyGross, config) {
  const ceiling = Number(config?.ceiling || 17712);
  const rate = Number(config?.rate || 1);
  const capped = Math.min(monthlyGross, ceiling);
  return Math.round((capped * rate) / 100 * 100) / 100;
}

hrRouter.get('/hr/payroll/config', requirePerm('hr.payroll.view'), ah(async (req, res) => {
  res.json({
    tax: getSetting('payroll_tax'),
    deductions: db.prepare('SELECT * FROM payroll_deductions_config ORDER BY code').all(),
    finance: getSetting('finance'),
  });
}));

hrRouter.get('/hr/payroll/periods', requirePerm('hr.payroll.view'), ah(async (req, res) => {
  const rows = db.prepare(`
    SELECT p.*, u.full_name AS approved_by_name
    FROM payroll_periods p LEFT JOIN users u ON u.id = p.approved_by
    ORDER BY p.period_key DESC
  `).all();
  res.json({ data: rows });
}));

hrRouter.post('/hr/payroll/periods', requirePerm('hr.payroll.process'), ah(async (req, res) => {
  const b = req.body || {};
  if (isBlank(b.period_key)) return res.status(400).json({ error: 'Period key (YYYY-MM) is required.' });
  const key = String(b.period_key);
  if (!/^\d{4}-\d{2}$/.test(key)) return res.status(400).json({ error: 'Period must be in YYYY-MM format.' });
  if (db.prepare('SELECT id FROM payroll_periods WHERE period_key = ?').get(key)) {
    return res.status(409).json({ error: `Payroll for ${key} already exists.` });
  }
  const [y, m] = key.split('-').map(Number);
  const start = `${key}-01`;
  const end = `${key}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
  const id = newId();
  const t = now();
  db.prepare(`
    INSERT INTO payroll_periods (id, period_key, label, start_date, end_date, status, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?)
  `).run(id, key, new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-ZA', { month: 'long', year: 'numeric', timeZone: 'UTC' }), start, end, req.user.id, t, t);
  audit({ userId: req.user.id, userEmail: req.user.email, action: 'payroll.period.create',
    entityType: 'payroll', entityId: id, summary: `Created payroll period ${key}`, ip: req.ip });
  res.status(201).json(db.prepare('SELECT * FROM payroll_periods WHERE id = ?').get(id));
}));

/** Calculate payroll lines for every active employee from configured rules. */
hrRouter.post('/hr/payroll/periods/:id/calculate', requirePerm('hr.payroll.process'), ah(async (req, res) => {
  const period = db.prepare('SELECT * FROM payroll_periods WHERE id = ?').get(req.params.id);
  if (!period) return res.status(404).json({ error: 'Payroll period not found.' });
  if (!['draft', 'calculated'].includes(period.status)) {
    return res.status(409).json({ error: `A ${period.status} payroll period cannot be recalculated.` });
  }

  const taxCfg = getSetting('payroll_tax');
  const deductions = db.prepare('SELECT * FROM payroll_deductions_config WHERE active = 1').all();
  const uifCfg = deductions.find((d) => d.code === 'UIF_EMPLOYEE');
  const uifEmployerCfg = deductions.find((d) => d.code === 'UIF_EMPLOYER');
  const sdlCfg = deductions.find((d) => d.code === 'SDL');
  const extra = Array.isArray(req.body?.lines) ? req.body.lines : [];

  const employees = db.prepare(
    "SELECT * FROM staff WHERE archived_at IS NULL AND employment_status IN ('active','on_leave') ORDER BY full_name"
  ).all();

  if (!employees.length) {
    return res.status(400).json({ error: 'No active employees on record. Add employee records before running payroll.' });
  }

  const totals = { gross: 0, deductions: 0, net: 0 };
  const t = now();

  tx(() => {
    db.prepare('DELETE FROM payroll_entries WHERE period_id = ?').run(period.id);
    for (const emp of employees) {
      const basic = Math.max(0, Number(emp.base_salary || 0));
      const empExtra = extra.filter((e) => e.staff_id === emp.id);
      const allowances = empExtra.filter((e) => e.kind === 'allowance').reduce((s, e) => s + num(e.amount, 0), 0);
      const overtime = empExtra.filter((e) => e.kind === 'overtime').reduce((s, e) => s + num(e.amount, 0), 0);
      const otherDeductions = empExtra.filter((e) => e.kind === 'deduction').reduce((s, e) => s + num(e.amount, 0), 0);
      const gross = Math.round((basic + allowances + overtime) * 100) / 100;

      const paye = taxCfg && gross > 0 ? calculatePaye(gross, taxCfg) : 0;
      const uif = gross > 0 ? calculateUif(gross, uifCfg) : 0;
      const employerUif = gross > 0 ? calculateUif(gross, uifEmployerCfg) : 0;
      const employerSdl = 0; // SDL is an employer-level 1% levy — computed at period level

      const deductionsTotal = Math.round((paye + uif + otherDeductions) * 100) / 100;
      const net = Math.round((gross - deductionsTotal) * 100) / 100;

      const lines = [
        { code: 'BASIC', label: 'Basic salary', kind: 'earning', amount: basic },
        ...(allowances ? [{ code: 'ALLOW', label: 'Allowances', kind: 'earning', amount: allowances }] : []),
        ...(overtime ? [{ code: 'OT', label: 'Overtime', kind: 'earning', amount: overtime }] : []),
        { code: 'PAYE', label: 'PAYE (employee tax)', kind: 'deduction', amount: paye },
        ...(uif ? [{ code: 'UIF', label: 'UIF employee contribution', kind: 'deduction', amount: uif }] : []),
        ...(otherDeductions ? [{ code: 'OTHER', label: 'Other deductions', kind: 'deduction', amount: otherDeductions }] : []),
        { code: 'UIF_ER', label: 'UIF employer contribution', kind: 'employer', amount: employerUif },
        { code: 'SDL_ER', label: 'SDL employer contribution (1%)', kind: 'employer', amount: employerSdl },
      ];

      db.prepare(`
        INSERT INTO payroll_entries (id, period_id, staff_id, basic, allowances, overtime, bonus, gross,
          paye, uif, sdl, pension, other_deductions, deductions, net, lines, status)
        VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 0, 0, ?, ?, ?, ?, 'calculated')
      `).run(newId(), period.id, emp.id, basic, allowances, overtime, gross, paye, uif,
        otherDeductions, deductionsTotal, net, JSON.stringify(lines));

      totals.gross = Math.round((totals.gross + gross) * 100) / 100;
      totals.deductions = Math.round((totals.deductions + deductionsTotal) * 100) / 100;
      totals.net = Math.round((totals.net + net) * 100) / 100;
    }

    // SDL (employer 1% on total remuneration above the R500k annual threshold)
    const annualRemuneration = totals.gross * 12;
    const sdlTotal = annualRemuneration >= 500000 ? Math.round(totals.gross * 0.01 * 100) / 100 : 0;

    db.prepare(`
      UPDATE payroll_periods SET status = 'calculated', gross_total = ?, deduction_total = ?, net_total = ?,
        employee_count = ?, updated_at = ? WHERE id = ?
    `).run(totals.gross, totals.deductions, totals.net, employees.length, t, period.id);
    setSetting(`payroll_sdl_${period.period_key}`, { amount: sdlTotal, applies: sdlTotal > 0 }, null);
  });

  audit({ userId: req.user.id, userEmail: req.user.email, action: 'payroll.calculate',
    entityType: 'payroll', entityId: period.id,
    summary: `Calculated payroll ${period.period_key}: ${employees.length} employee(s)`, ip: req.ip });
  res.json({
    ok: true,
    employee_count: employees.length,
    gross: totals.gross,
    deductions: totals.deductions,
    net: totals.net,
    period: db.prepare('SELECT * FROM payroll_periods WHERE id = ?').get(period.id),
  });
}));

hrRouter.get('/hr/payroll/periods/:id', requirePerm('hr.payroll.view'), ah(async (req, res) => {
  const period = db.prepare('SELECT * FROM payroll_periods WHERE id = ?').get(req.params.id);
  if (!period) return res.status(404).json({ error: 'Payroll period not found.' });
  const entries = db.prepare(`
    SELECT e.*, s.full_name, s.employee_ref, s.job_title, s.department
    FROM payroll_entries e JOIN staff s ON s.id = e.staff_id
    WHERE e.period_id = ? ORDER BY s.full_name
  `).all(period.id).map((e) => {
    if (can(req, 'hr.salary')) return { ...e, lines: JSON.parse(e.lines || '[]') };
    const { paye, uif, sdl, pension, other_deductions, basic, allowances, overtime, bonus, gross, deductions, lines, ...rest } = e;
    return { ...rest, restricted_fields: ['paye', 'uif', 'basic', 'gross', 'net'] };
  });
  res.json({ ...period, entries });
}));

hrRouter.post('/hr/payroll/periods/:id/approve', requirePerm('hr.payroll.approve'), ah(async (req, res) => {
  const period = db.prepare('SELECT * FROM payroll_periods WHERE id = ?').get(req.params.id);
  if (!period) return res.status(404).json({ error: 'Payroll period not found.' });
  if (period.status !== 'calculated') {
    return res.status(409).json({ error: `Only a calculated payroll can be approved (current status: ${period.status}). Run the calculation first.` });
  }
  const count = db.prepare('SELECT COUNT(*) c FROM payroll_entries WHERE period_id = ?').get(period.id).c;
  if (!count) return res.status(400).json({ error: 'Calculate the payroll before approving it.' });

  const t = now();
  // Draft journal — posted separately by finance (separation of duties).
  const journalId = createPayrollJournal(period, req);
  db.prepare(`
    UPDATE payroll_periods SET status = 'approved', approved_by = ?, approved_at = ?, journal_id = ?, updated_at = ? WHERE id = ?
  `).run(req.user.id, t, journalId, t, period.id);
  audit({ userId: req.user.id, userEmail: req.user.email, action: 'payroll.approve',
    entityType: 'payroll', entityId: period.id,
    summary: `Approved payroll ${period.period_key} (${count} employees, net R${period.net_total.toFixed(2)})`, ip: req.ip });
  notifyRoles(['super_admin', 'finance_manager', 'accountant'], {
    type: 'payroll', title: `Payroll ${period.period_key} approved`,
    body: `Draft journal created for posting — net R${period.net_total.toFixed(2)}`, link: '/finance?tab=ledger',
  });
  res.json({ ok: true, journal_id: journalId, status: 'approved' });
}));

function createPayrollJournal(period, req) {
  const cfg = getSetting('finance') || {};
  const account = (code) => db.prepare('SELECT id FROM chart_of_accounts WHERE code = ?').get(code)?.id;
  const salaryAcct = account('5000');
  const uifErAcct = account('5010');
  const sdlErAcct = account('5020');
  const payeAcct = account('2200');
  const uifAcct = account('2210');
  const sdlAcct = account('2220');
  const bankAcct = account('1000');
  if (!salaryAcct || !payeAcct || !bankAcct) {
    const err = new Error('Chart of accounts is incomplete — configure salary, PAYE and bank accounts first.');
    err.status = 400;
    throw err;
  }
  const periodKey = period.period_key;
  const openPeriod = ensurePeriodOpen(req, `${periodKey}-01`);
  const sdl = getSetting(`payroll_sdl_${periodKey}`)?.amount || 0;

  let employerUifTotal = 0;
  for (const row of db.prepare('SELECT lines FROM payroll_entries WHERE period_id = ?').all(period.id)) {
    for (const line of JSON.parse(row.lines || '[]')) {
      if (line.code === 'UIF_ER') employerUifTotal += Number(line.amount || 0);
    }
  }
  employerUifTotal = Math.round(employerUifTotal * 100) / 100;

  const journalId = newId();
  const ref = nextRef(db, cfg.journal_prefix || 'JV');
  const t = now();
  const desc = `Payroll ${period.label} — ${period.employee_count} employee(s)`;
  db.prepare(`
    INSERT INTO journal_entries (id, journal_ref, period_id, entry_date, description, source_type, source_id,
      total_debit, total_credit, status, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'payroll', ?, ?, ?, 'draft', ?, ?, ?)
  `).run(journalId, ref, openPeriod?.id || null, `${periodKey}-01`, desc, period.id,
    period.gross_total + employerUifTotal + sdl, period.gross_total + employerUifTotal + sdl, req.user.id, t, t);

  const line = (accountId, debit, credit, memo) => db.prepare(
    'INSERT INTO journal_lines (id, entry_id, account_id, debit, credit, memo) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(newId(), journalId, accountId, debit, credit, memo);

  // Gross payroll + employer contributions are expenses
  line(salaryAcct, period.gross_total, 0, 'Gross salaries and wages');
  if (employerUifTotal > 0) line(uifErAcct, employerUifTotal, 0, 'Employer UIF');
  if (sdl > 0) line(sdlErAcct, sdl, 0, 'Skills Development Levy');

  // Liabilities withheld
  let payeTotal = 0; let uifTotal = 0;
  for (const row of db.prepare('SELECT lines FROM payroll_entries WHERE period_id = ?').all(period.id)) {
    for (const l of JSON.parse(row.lines || '[]')) {
      if (l.code === 'PAYE') payeTotal += Number(l.amount || 0);
      if (l.code === 'UIF') uifTotal += Number(l.amount || 0);
    }
  }
  payeTotal = Math.round(payeTotal * 100) / 100;
  uifTotal = Math.round(uifTotal * 100) / 100;
  const uifPayable = Math.round((uifTotal + employerUifTotal) * 100) / 100;
  if (payeTotal > 0) line(payeAcct, 0, payeTotal, 'PAYE payable to SARS');
  if (uifPayable > 0) line(uifAcct, 0, uifPayable, 'UIF payable (employee + employer)');
  if (sdl > 0) line(sdlAcct, 0, sdl, 'SDL payable');
  // Net pay released from bank
  line(bankAcct, 0, period.net_total, 'Net salaries paid');

  audit({ userId: req.user.id, userEmail: req.user.email, action: 'journal.create',
    entityType: 'journal', entityId: journalId, summary: `Draft journal ${ref} from payroll ${period.period_key}`, ip: req.ip });
  return journalId;
}

hrRouter.post('/hr/payroll/periods/:id/pay', requirePerm('hr.payroll.approve'), ah(async (req, res) => {
  const period = db.prepare('SELECT * FROM payroll_periods WHERE id = ?').get(req.params.id);
  if (!period) return res.status(404).json({ error: 'Payroll period not found.' });
  if (period.status !== 'approved') return res.status(409).json({ error: 'Approve the payroll before confirming payment.' });
  const bankAccountId = req.body?.bank_account_id;
  const accounts = db.prepare('SELECT id, name FROM bank_accounts WHERE active = 1').all();
  if (!accounts.length) return res.status(400).json({ error: 'Configure a bank account in Finance → Banking first.' });
  if (bankAccountId && !accounts.some((a) => a.id === bankAccountId)) {
    return res.status(400).json({ error: 'Bank account not found.' });
  }
  const t = now();
  db.prepare("UPDATE payroll_periods SET status = 'paid', paid_by = ?, paid_at = ?, updated_at = ? WHERE id = ?")
    .run(req.user.id, t, t, period.id);
  audit({ userId: req.user.id, userEmail: req.user.email, action: 'payroll.pay',
    entityType: 'payroll', entityId: period.id,
    summary: `Confirmed payment of payroll ${period.period_key} — net R${period.net_total.toFixed(2)}`, ip: req.ip });
  res.json({ ok: true, status: 'paid' });
}));

/** Payslip data for one employee in one period. */
hrRouter.get('/hr/payroll/payslips/:entryId', requirePerm('hr.payroll.view'), ah(async (req, res) => {
  const entry = db.prepare(`
    SELECT e.*, p.period_key, p.label, p.start_date, p.end_date, p.status AS period_status,
      s.full_name, s.employee_ref, s.job_title, s.department, s.bank_name, s.bank_account, s.tax_number
    FROM payroll_entries e
    JOIN payroll_periods p ON p.id = e.period_id
    JOIN staff s ON s.id = e.staff_id
    WHERE e.id = ?
  `).get(req.params.id || req.params.entryId);
  if (!entry) return res.status(404).json({ error: 'Payslip not found.' });
  if (!can(req, 'hr.salary') && entry.staff_id !== req.user.staff_id) {
    return res.status(403).json({ error: 'Salary information is restricted to authorised users.' });
  }
  const company = getSetting('company');
  res.json({ ...entry, lines: JSON.parse(entry.lines || '[]'), company });
}));

// ===========================================================================
// Recruitment
// ===========================================================================

hrRouter.get('/hr/recruitment/requisitions', requirePerm('staff.view'), ah(async (req, res) => {
  const { q, page, pageSize, offset } = listParams(req);
  const where = ['1=1']; const args = [];
  if (q) { where.push("(title LIKE ? ESCAPE '\\' OR department LIKE ? ESCAPE '\\')"); const t = likeTerm(q); args.push(t, t); }
  if (req.query.status) { where.push('status = ?'); args.push(String(req.query.status)); }
  const total = db.prepare(`SELECT COUNT(*) c FROM job_requisitions WHERE ${where.join(' AND ')}`).get(...args).c;
  const rows = db.prepare(`
    SELECT r.*, (SELECT COUNT(*) FROM job_applications a WHERE a.requisition_id = r.id) AS applicants
    FROM job_requisitions r WHERE ${where.join(' AND ')}
    ORDER BY r.created_at DESC LIMIT ? OFFSET ?
  `).all(...args, pageSize, offset);
  res.json(paginated(rows, total, page, pageSize));
}));

hrRouter.post('/hr/recruitment/requisitions', requirePerm('hr.recruitment'), ah(async (req, res) => {
  const b = req.body || {};
  if (isBlank(b.title)) return res.status(400).json({ error: 'Job title is required.' });
  const id = newId();
  const ref = nextRef(db, 'FAR-VAC');
  const t = now();
  db.prepare(`
    INSERT INTO job_requisitions (id, req_ref, title, department, branch, vacancies, employment_type,
      salary_min, salary_max, description, requirements, status, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, ref, b.title, b.department || null, b.branch || null, num(b.vacancies, 1),
    b.employment_type || 'permanent', num(b.salary_min, 0) || null, num(b.salary_max, 0) || null,
    b.description || null, b.requirements || null, b.status === 'open' ? 'open' : 'draft', req.user.id, t, t);
  audit({ userId: req.user.id, userEmail: req.user.email, action: 'requisition.create',
    entityType: 'requisition', entityId: id, summary: `Created vacancy ${ref} — ${b.title}`, ip: req.ip });
  res.status(201).json(db.prepare('SELECT * FROM job_requisitions WHERE id = ?').get(id));
}));

hrRouter.post('/hr/recruitment/requisitions/:id/status', requirePerm('hr.recruitment'), ah(async (req, res) => {
  const r = db.prepare('SELECT * FROM job_requisitions WHERE id = ?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Vacancy not found.' });
  const status = String(req.body?.status || '');
  if (!['draft', 'open', 'on_hold', 'closed', 'cancelled'].includes(status)) {
    return res.status(400).json({ error: 'Invalid vacancy status.' });
  }
  const t = now();
  const extra = status === 'open' ? ', posted_at = COALESCE(posted_at, ?)' : '';
  db.prepare(`UPDATE job_requisitions SET status = ?${extra}, closed_at = ?, updated_at = ? WHERE id = ?`)
    .run(status, ...(status === 'open' ? [t] : []), ['closed', 'cancelled'].includes(status) ? t : null, t, r.id);
  audit({ userId: req.user.id, userEmail: req.user.email, action: 'requisition.status',
    entityType: 'requisition', entityId: r.id, summary: `Vacancy ${r.req_ref} → ${status}`, ip: req.ip });
  res.json({ ok: true, status });
}));

hrRouter.get('/hr/recruitment/applicants', requirePerm('staff.view'), ah(async (req, res) => {
  const { q, page, pageSize, offset } = listParams(req);
  const where = ['1=1']; const args = [];
  if (q) { where.push("(full_name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' OR applicant_ref LIKE ? ESCAPE '\\')"); const t = likeTerm(q); args.push(t, t, t); }
  const total = db.prepare(`SELECT COUNT(*) c FROM job_applicants WHERE ${where.join(' AND ')}`).get(...args).c;
  const rows = db.prepare(`
    SELECT a.*, (SELECT COUNT(*) FROM job_applications ja WHERE ja.applicant_id = a.id) AS applications
    FROM job_applicants a WHERE ${where.join(' AND ')} ORDER BY a.created_at DESC LIMIT ? OFFSET ?
  `).all(...args, pageSize, offset);
  res.json(paginated(rows, total, page, pageSize));
}));

hrRouter.post('/hr/recruitment/applicants', requirePerm('hr.recruitment'), ah(async (req, res) => {
  const b = req.body || {};
  if (isBlank(b.full_name)) return res.status(400).json({ error: 'Applicant name is required.' });
  const id = newId();
  const ref = nextRef(db, 'FAR-APP');
  const t = now();
  db.prepare(`
    INSERT INTO job_applicants (id, applicant_ref, full_name, email, phone, source, cv_path, notes, status, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?)
  `).run(id, ref, b.full_name, b.email || null, b.phone || null, b.source || null,
    b.cv_path || null, b.notes || null, req.user.id, t, t);
  res.status(201).json(db.prepare('SELECT * FROM job_applicants WHERE id = ?').get(id));
}));

hrRouter.get('/hr/recruitment/applications', requirePerm('staff.view'), ah(async (req, res) => {
  const { page, pageSize, offset } = listParams(req);
  const where = ['1=1']; const args = [];
  if (req.query.status) { where.push('ja.status = ?'); args.push(String(req.query.status)); }
  if (req.query.requisition_id) { where.push('ja.requisition_id = ?'); args.push(String(req.query.requisition_id)); }
  const total = db.prepare(`SELECT COUNT(*) c FROM job_applications ja WHERE ${where.join(' AND ')}`).get(...args).c;
  const rows = db.prepare(`
    SELECT ja.*, ap.full_name, ap.email, ap.phone, r.title, r.department
    FROM job_applications ja
    JOIN job_applicants ap ON ap.id = ja.applicant_id
    JOIN job_requisitions r ON r.id = ja.requisition_id
    WHERE ${where.join(' AND ')} ORDER BY ja.created_at DESC LIMIT ? OFFSET ?
  `).all(...args, pageSize, offset);
  res.json(paginated(rows, total, page, pageSize));
}));

hrRouter.post('/hr/recruitment/applications', requirePerm('hr.recruitment'), ah(async (req, res) => {
  const b = req.body || {};
  if (isBlank(b.applicant_id) || isBlank(b.requisition_id)) {
    return res.status(400).json({ error: 'Applicant and vacancy are required.' });
  }
  const dup = db.prepare('SELECT id FROM job_applications WHERE applicant_id = ? AND requisition_id = ?').get(b.applicant_id, b.requisition_id);
  if (dup) return res.status(409).json({ error: 'This applicant has already applied for that vacancy.' });
  const id = newId();
  const ref = nextRef(db, 'FAR-JA');
  const t = now();
  db.prepare(`
    INSERT INTO job_applications (id, application_ref, applicant_id, requisition_id, status, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, ref, b.applicant_id, b.requisition_id, 'screening', b.notes || null, t, t);
  res.status(201).json(db.prepare('SELECT * FROM job_applications WHERE id = ?').get(id));
}));

hrRouter.post('/hr/recruitment/applications/:id/stage', requirePerm('hr.recruitment'), ah(async (req, res) => {
  const app = db.prepare('SELECT * FROM job_applications WHERE id = ?').get(req.params.id);
  if (!app) return res.status(404).json({ error: 'Application not found.' });
  const status = String(req.body?.status || '');
  const allowed = ['screening', 'shortlisted', 'interview', 'offer', 'hired', 'rejected', 'withdrawn'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid application stage.' });
  const t = now();
  db.prepare('UPDATE job_applications SET status = ?, updated_at = ? WHERE id = ?')
    .run(status, t, app.id);

  if (status === 'hired') {
    // Candidate → employee conversion (only once the hiring decision is made)
    const applicant = db.prepare('SELECT * FROM job_applicants WHERE id = ?').get(app.applicant_id);
    const reqRow = db.prepare('SELECT * FROM job_requisitions WHERE id = ?').get(app.requisition_id);
    const empId = newId();
    const empRef = nextRef(db, 'FAR-EMP');
    db.prepare(`
      INSERT INTO staff (id, employee_ref, full_name, email, phone, job_title, department, employment_status,
        employment_type, hired_at, contract_start, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)
    `).run(empId, empRef, applicant.full_name, applicant.email, applicant.phone, reqRow.title,
      reqRow.department, reqRow.employment_type, t.slice(0, 10), t.slice(0, 10), t, t);
    db.prepare('UPDATE job_applications SET hired_staff_id = ?, offer_status = ? WHERE id = ?')
      .run(empId, 'accepted', app.id);
    audit({ userId: req.user.id, userEmail: req.user.email, action: 'recruitment.hire',
      entityType: 'employee', entityId: empId,
      summary: `Hired ${applicant.full_name} as ${reqRow.title} (${empRef})`, ip: req.ip });
  }

  audit({ userId: req.user.id, userEmail: req.user.email, action: 'application.stage',
    entityType: 'job_application', entityId: app.id, summary: `Application ${app.application_ref} → ${status}`, ip: req.ip });
  res.json({ ok: true, status });
}));

hrRouter.post('/hr/recruitment/applications/:id/interviews', requirePerm('hr.recruitment'), ah(async (req, res) => {
  const app = db.prepare('SELECT * FROM job_applications WHERE id = ?').get(req.params.id);
  if (!app) return res.status(404).json({ error: 'Application not found.' });
  const b = req.body || {};
  if (isBlank(b.scheduled_at)) return res.status(400).json({ error: 'Interview date and time are required.' });
  const id = newId();
  db.prepare(`
    INSERT INTO interviews (id, application_id, round, scheduled_at, interviewer, mode, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, app.id, num(b.round, 1), b.scheduled_at, b.interviewer || null, b.mode || 'in_person', b.notes || null, now());
  db.prepare("UPDATE job_applications SET status = 'interview', updated_at = ? WHERE id = ? AND status != 'hired'").run(now(), app.id);
  res.status(201).json({ id });
}));

// ===========================================================================
// Onboarding tasks
// ===========================================================================

hrRouter.get('/hr/onboarding', requirePerm('staff.view'), ah(async (req, res) => {
  const where = ['1=1']; const args = [];
  if (req.query.staff_id) { where.push('ot.staff_id = ?'); args.push(String(req.query.staff_id)); }
  if (req.query.status) { where.push('ot.status = ?'); args.push(String(req.query.status)); }
  const rows = db.prepare(`
    SELECT ot.*, s.full_name, s.employee_ref FROM onboarding_tasks ot
    JOIN staff s ON s.id = ot.staff_id WHERE ${where.join(' AND ')}
    ORDER BY ot.status, ot.due_date LIMIT 500
  `).all(...args);
  res.json({ data: rows });
}));

hrRouter.post('/hr/onboarding/:id/complete', requirePerm('staff.manage'), ah(async (req, res) => {
  const task = db.prepare('SELECT * FROM onboarding_tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Onboarding task not found.' });
  db.prepare("UPDATE onboarding_tasks SET status = 'completed', completed_at = ?, completed_by = ? WHERE id = ?")
    .run(now(), req.user.id, task.id);
  res.json({ ok: true });
}));

// ===========================================================================
// Performance & training
// ===========================================================================

hrRouter.get('/hr/performance/reviews', requirePerm('staff.view'), ah(async (req, res) => {
  const where = ['1=1']; const args = [];
  if (req.query.status) { where.push('r.status = ?'); args.push(String(req.query.status)); }
  if (req.query.staff_id) { where.push('r.staff_id = ?'); args.push(String(req.query.staff_id)); }
  const rows = db.prepare(`
    SELECT r.*, s.full_name, s.employee_ref, s.job_title, s.department
    FROM performance_reviews r JOIN staff s ON s.id = r.staff_id
    WHERE ${where.join(' AND ')} ORDER BY r.created_at DESC LIMIT 200
  `).all(...args);
  res.json({ data: rows.map((r) => ({ ...r, goals: JSON.parse(r.goals || '[]') })) });
}));

hrRouter.post('/hr/performance/reviews', requirePerm('hr.performance'), ah(async (req, res) => {
  const b = req.body || {};
  if (isBlank(b.staff_id) || isBlank(b.cycle)) return res.status(400).json({ error: 'Employee and review cycle are required.' });
  const id = newId();
  const ref = nextRef(db, 'FAR-PR');
  const t = now();
  db.prepare(`
    INSERT INTO performance_reviews (id, review_ref, staff_id, cycle, period_start, period_end, goals,
      employee_comment, self_rating, status, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)
  `).run(id, ref, b.staff_id, b.cycle, b.period_start || null, b.period_end || null,
    JSON.stringify(Array.isArray(b.goals) ? b.goals : []), b.employee_comment || null,
    b.self_rating ?? null, req.user.id, t, t);
  res.status(201).json(db.prepare('SELECT * FROM performance_reviews WHERE id = ?').get(id));
}));

hrRouter.post('/hr/performance/reviews/:id/decision', requirePerm('hr.performance'), ah(async (req, res) => {
  const r = db.prepare('SELECT * FROM performance_reviews WHERE id = ?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Review not found.' });
  const status = ['submitted', 'approved', 'rejected'].includes(req.body?.status) ? req.body.status : 'submitted';
  db.prepare('UPDATE performance_reviews SET status = ?, manager_comment = ?, manager_rating = ?, decided_by = ?, decided_at = ?, updated_at = ? WHERE id = ?')
    .run(status, req.body?.manager_comment ?? r.manager_comment, req.body?.manager_rating ?? r.manager_rating,
      req.user.id, now(), now(), r.id);
  audit({ userId: req.user.id, userEmail: req.user.email, action: `performance.${status}`,
    entityType: 'performance', entityId: r.id, summary: `Review ${r.review_ref} ${status}`, ip: req.ip });
  res.json({ ok: true, status });
}));

hrRouter.get('/hr/training', requirePerm('staff.view'), ah(async (req, res) => {
  const programs = db.prepare(`
    SELECT t.*, (SELECT COUNT(*) FROM training_enrollments e WHERE e.program_id = t.id) AS enrolled,
      (SELECT COUNT(*) FROM training_enrollments e WHERE e.program_id = t.id AND e.status = 'completed') AS completed
    FROM training_programs t ORDER BY t.start_date DESC
  `).all();
  const enrollments = db.prepare(`
    SELECT e.*, s.full_name, s.employee_ref, t.name AS program_name
    FROM training_enrollments e JOIN staff s ON s.id = e.staff_id JOIN training_programs t ON t.id = e.program_id
    ORDER BY e.created_at DESC LIMIT 200
  `).all();
  res.json({ data: programs, enrollments });
}));

hrRouter.post('/hr/training', requirePerm('hr.performance'), ah(async (req, res) => {
  const b = req.body || {};
  if (isBlank(b.name)) return res.status(400).json({ error: 'Programme name is required.' });
  const id = newId();
  db.prepare(`
    INSERT INTO training_programs (id, name, provider, category, start_date, end_date, cost, max_seats, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, b.name, b.provider || null, b.category || null, b.start_date || null, b.end_date || null,
    num(b.cost, 0), num(b.max_seats, 0), b.status || 'planned', now());
  res.status(201).json({ id });
}));

hrRouter.post('/hr/training/:id/enroll', requirePerm('hr.performance'), ah(async (req, res) => {
  const program = db.prepare('SELECT * FROM training_programs WHERE id = ?').get(req.params.id);
  if (!program) return res.status(404).json({ error: 'Training programme not found.' });
  const staffId = req.body?.staff_id;
  if (!staffId) return res.status(400).json({ error: 'Select an employee.' });
  try {
    db.prepare('INSERT INTO training_enrollments (id, program_id, staff_id, created_at) VALUES (?, ?, ?, ?)')
      .run(newId(), program.id, staffId, now());
  } catch (e) {
    if (/UNIQUE/i.test(e.message)) return res.status(409).json({ error: 'This employee is already enrolled.' });
    throw e;
  }
  res.status(201).json({ ok: true });
}));

// ===========================================================================
// Employee relations (grievances, discipline, incidents)
// ===========================================================================

hrRouter.get('/hr/cases', requirePerm('hr.cases'), ah(async (req, res) => {
  const { q, page, pageSize, offset } = listParams(req);
  const confidentialOk = can(req, 'hr.cases.confidential');
  const where = confidentialOk ? ['1=1'] : ['c.confidential = 0'];
  const args = [];
  if (q) { where.push("(c.title LIKE ? ESCAPE '\\' OR c.case_ref LIKE ? ESCAPE '\\')"); const t = likeTerm(q); args.push(t, t); }
  if (req.query.status) { where.push('c.status = ?'); args.push(String(req.query.status)); }
  const total = db.prepare(`SELECT COUNT(*) c FROM hr_cases c WHERE ${where.join(' AND ')}`).get(...args).c;
  const rows = db.prepare(`
    SELECT c.*, s.full_name, s.employee_ref FROM hr_cases c LEFT JOIN staff s ON s.id = c.staff_id
    WHERE ${where.join(' AND ')} ORDER BY c.created_at DESC LIMIT ? OFFSET ?
  `).all(...args, pageSize, offset);
  res.json(paginated(rows, total, page, pageSize));
}));

hrRouter.get('/hr/cases/:id', requirePerm('hr.cases'), ah(async (req, res) => {
  const c = db.prepare(`
    SELECT c.*, s.full_name, s.employee_ref FROM hr_cases c
    LEFT JOIN staff s ON s.id = c.staff_id WHERE c.id = ?
  `).get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Case not found.' });
  if (c.confidential && !can(req, 'hr.cases.confidential')) {
    return res.status(403).json({ error: 'This case is confidential and your role cannot view it.' });
  }
  const notes = db.prepare('SELECT * FROM hr_case_notes WHERE case_id = ? ORDER BY created_at').all(c.id);
  res.json({ ...c, notes });
}));

hrRouter.post('/hr/cases', requirePerm('hr.cases'), ah(async (req, res) => {
  const b = req.body || {};
  if (isBlank(b.title)) return res.status(400).json({ error: 'Case title is required.' });
  if (b.confidential && !can(req, 'hr.cases.confidential')) {
    return res.status(403).json({ error: 'Creating confidential cases requires the confidential HR case permission.' });
  }
  const id = newId();
  const ref = nextRef(db, 'FAR-HR');
  const t = now();
  db.prepare(`
    INSERT INTO hr_cases (id, case_ref, staff_id, type, title, description, severity, status, confidential,
      due_date, opened_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)
  `).run(id, ref, b.staff_id || null, b.type || 'grievance', b.title, b.description || null,
    b.severity || 'normal', b.confidential ? 1 : 0, b.due_date || null, req.user.id, t, t);
  audit({ userId: req.user.id, userEmail: req.user.email, action: 'hr_case.create',
    entityType: 'hr_case', entityId: id, summary: `Opened HR case ${ref} — ${b.title}`, ip: req.ip });
  res.status(201).json(db.prepare('SELECT * FROM hr_cases WHERE id = ?').get(id));
}));

hrRouter.post('/hr/cases/:id/notes', requirePerm('hr.cases'), ah(async (req, res) => {
  const c = db.prepare('SELECT * FROM hr_cases WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Case not found.' });
  if (c.confidential && !can(req, 'hr.cases.confidential')) return res.status(403).json({ error: 'Confidential case.' });
  if (isBlank(req.body?.body)) return res.status(400).json({ error: 'Note text is required.' });
  const id = newId();
  db.prepare('INSERT INTO hr_case_notes (id, case_id, author_id, author_name, body, visibility, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, c.id, req.user.id, req.user.full_name, req.body.body, req.body.visibility || 'internal', now());
  res.status(201).json({ id });
}));

hrRouter.post('/hr/cases/:id/status', requirePerm('hr.cases'), ah(async (req, res) => {
  const c = db.prepare('SELECT * FROM hr_cases WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Case not found.' });
  if (c.confidential && !can(req, 'hr.cases.confidential')) return res.status(403).json({ error: 'Confidential case.' });
  const status = String(req.body?.status || '');
  if (!['open', 'investigating', 'hearing_scheduled', 'resolved', 'closed'].includes(status)) {
    return res.status(400).json({ error: 'Invalid case status.' });
  }
  const t = now();
  db.prepare('UPDATE hr_cases SET status = ?, outcome = ?, corrective_action = ?, closed_by = ?, closed_at = ?, updated_at = ? WHERE id = ?')
    .run(status, req.body?.outcome ?? c.outcome, req.body?.corrective_action ?? c.corrective_action,
      ['resolved', 'closed'].includes(status) ? req.user.id : null,
      ['resolved', 'closed'].includes(status) ? t : null, t, c.id);
  audit({ userId: req.user.id, userEmail: req.user.email, action: 'hr_case.status',
    entityType: 'hr_case', entityId: c.id, summary: `HR case ${c.case_ref} → ${status}`, ip: req.ip });
  res.json({ ok: true, status });
}));

export { workingDaysBetween, calculatePaye, calculateUif };
