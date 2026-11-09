// ---------------------------------------------------------------------------
// Executive dashboard metrics, charts, reports & exports.
// Every figure below is computed from live records — no fabricated values.
// ---------------------------------------------------------------------------
import { Router } from 'express';
import { db } from '../db.js';
import { requirePerm } from '../auth.js';
import { ah, todayISO, sendCsv, monthKey } from '../util.js';

export const reportsRouter = Router();

/** WHERE-clause builder honouring property + date range filters. */
function filters(req, { dateCol, propCol }) {
  const where = [];
  const args = [];
  const pid = String(req.query.property_id || '').trim();
  if (pid && propCol) { where.push(`${propCol} = ?`); args.push(pid); }
  const from = String(req.query.from || '').trim();
  if (from && dateCol) { where.push(`date(${dateCol}) >= date(?)`); args.push(from); }
  const to = String(req.query.to || '').trim();
  if (to && dateCol) { where.push(`date(${dateCol}) <= date(?)`); args.push(to); }
  return { clause: where.length ? `AND ${where.join(' AND ')}` : '', args };
}

// --------------------------- summary cards ---------------------------------

reportsRouter.get('/dashboard/summary', requirePerm('students.view'), ah(async (req, res) => {
  const from = String(req.query.from || '').trim();
  const to = String(req.query.to || '').trim();
  const pid = String(req.query.property_id || '').trim();
  const dateRange = (col) => {
    const c = [];
    const a = [];
    if (from) { c.push(`date(${col}) >= date(?)`); a.push(from); }
    if (to) { c.push(`date(${col}) <= date(?)`); a.push(to); }
    return { clause: c.length ? `AND ${c.join(' AND ')}` : '', args: a };
  };
  const studentRange = dateRange('created_at');

  const totalStudents = db.prepare(`SELECT COUNT(*) AS c FROM students WHERE status != 'archived' ${studentRange.clause}`).get(...studentRange.args).c;
  const activeStudents = db.prepare("SELECT COUNT(*) AS c FROM students WHERE status = 'active'").get().c;

  const propWhere = pid ? 'WHERE p.id = ?' : '';
  const propArgs = pid ? [pid] : [];
  const totalProperties = db.prepare(`SELECT COUNT(*) AS c FROM properties p ${propWhere}`).get(...propArgs).c;
  const totalBuildings = db.prepare(`
    SELECT COUNT(*) AS c FROM buildings b ${pid ? 'WHERE b.property_id = ?' : ''}
  `).get(...propArgs).c;

  const bedRows = db.prepare(`
    SELECT COUNT(be.id) AS total,
      SUM(CASE WHEN EXISTS (SELECT 1 FROM bed_allocations a WHERE a.bed_id = be.id AND a.status IN ('active','reserved'))
        THEN 1 ELSE 0 END) AS occupied
    FROM beds be
    JOIN rooms r ON r.id = be.room_id
    JOIN buildings b ON b.id = r.building_id
    ${pid ? 'WHERE b.property_id = ?' : ''}
  `).get(...propArgs);
  const totalBeds = bedRows.total || 0;
  const occupiedBeds = bedRows.occupied || 0;
  const occupancyPct = totalBeds ? Math.round((occupiedBeds / totalBeds) * 100) : 0;

  const appRange = dateRange('created_at');
  const pendingApps = db.prepare(`
    SELECT COUNT(*) AS c FROM applications a
    WHERE a.status IN ('submitted','under_review','info_required') ${pid ? 'AND a.property_id = ?' : ''} ${appRange.clause}
  `).get(...(pid ? [pid, ...appRange.args] : appRange.args)).c;
  const awaitingApproval = db.prepare(`
    SELECT COUNT(*) AS c FROM applications a
    WHERE a.status IN ('under_review') ${pid ? 'AND a.property_id = ?' : ''} ${appRange.clause}
  `).get(...(pid ? [pid, ...appRange.args] : appRange.args)).c;

  const complaintRange = dateRange('created_at');
  const openComplaints = db.prepare(`
    SELECT COUNT(*) AS c FROM complaints c
    WHERE c.status IN ('open','acknowledged','assigned','in_progress','awaiting_student','escalated')
      ${pid ? 'AND c.property_id = ?' : ''} ${complaintRange.clause}
  `).get(...(pid ? [pid, ...complaintRange.args] : complaintRange.args)).c;
  const urgentComplaints = db.prepare(`
    SELECT COUNT(*) AS c FROM complaints c
    WHERE c.priority IN ('urgent','high') AND c.status IN ('open','acknowledged','assigned','in_progress','escalated')
      ${pid ? 'AND c.property_id = ?' : ''}
  `).get(...propArgs).c;

  const urgentMaintenance = db.prepare(`
    SELECT COUNT(*) AS c FROM maintenance_jobs m
    WHERE m.priority IN ('urgent','high') AND m.status NOT IN ('verified','cancelled')
      ${pid ? 'AND m.property_id = ?' : ''}
  `).get(...propArgs).c;

  const outstanding = db.prepare(`
    SELECT COALESCE(SUM(x.due), 0) AS total FROM (
      SELECT (i.total - COALESCE((SELECT SUM(pa.amount) FROM payment_allocations pa WHERE pa.invoice_id = i.id), 0)) AS due
      FROM invoices i JOIN students s ON s.id = i.student_id
      WHERE i.status NOT IN ('void','paid') AND s.status IN ('active','registered')
        ${pid ? 'AND s.property_id = ?' : ''}
    ) x
  `).get(...propArgs).total;

  const incomeRange = dateRange('paid_at');
  const paymentsReceived = db.prepare(`
    SELECT COALESCE(SUM(p.amount), 0) AS t FROM payments p
    WHERE p.status != 'void' ${incomeRange.clause}
  `).get(...incomeRange.args).t;

  const overdueTasks = db.prepare(`
    SELECT COUNT(*) AS c FROM tasks t
    WHERE date(t.due_date) < date('${todayISO()}') AND t.status NOT IN ('done','verified')
  `).get().c;

  const cleaningAwaiting = db.prepare(`
    SELECT COUNT(*) AS c FROM cleaning_tasks ct
    WHERE ct.task_date <= '${todayISO()}' AND ct.status IN ('pending','in_progress','missed')
      ${pid ? 'AND ct.property_id = ?' : ''}
  `).get(...propArgs).c;

  // previous-period comparison for trend arrows
  const prevMonth = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const prevStudents = db.prepare("SELECT COUNT(*) AS c FROM students WHERE status != 'archived' AND date(created_at) < date(?)").get(prevMonth).c;
  const prevComplaints = db.prepare("SELECT COUNT(*) AS c FROM complaints WHERE date(created_at) < date(?)").get(prevMonth).c;
  const studentDelta = prevStudents ? Math.round(((totalStudents - prevStudents) / prevStudents) * 100) : 0;
  const complaintDelta = prevComplaints ? Math.round(((openComplaints - prevComplaints) / prevComplaints) * 100) : 0;

  res.json({
    total_students: totalStudents,
    active_students: activeStudents,
    total_properties: totalProperties,
    total_buildings: totalBuildings,
    total_beds: totalBeds,
    occupied_beds: occupiedBeds,
    available_beds: totalBeds - occupiedBeds,
    occupancy_pct: occupancyPct,
    pending_applications: pendingApps,
    awaiting_approval: awaitingApproval,
    open_complaints: openComplaints,
    urgent_complaints: urgentComplaints,
    urgent_maintenance: urgentMaintenance,
    outstanding_balances: Math.round(outstanding * 100) / 100,
    payments_received: Math.round(paymentsReceived * 100) / 100,
    overdue_tasks: overdueTasks,
    cleaning_pending: cleaningAwaiting,
    student_delta_pct: studentDelta,
    complaint_delta_pct: complaintDelta,
  });
}));

// ------------------------------- charts ------------------------------------

/**
 * Calendar months, oldest first, for chart axes. Uses real month arithmetic so
 * a range never repeats or skips a month (30-day offsets do both).
 */
function recentMonths(count) {
  const now = new Date();
  const out = [];
  for (let i = count - 1; i >= 0; i--) {
    const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
    out.push({
      key: first.toISOString().slice(0, 7),
      label: first.toLocaleDateString('en-ZA', { month: 'short', timeZone: 'UTC' }),
      end_date: last.toISOString().slice(0, 10),
    });
  }
  return out;
}

/** Monthly registrations for the last N months. */
reportsRouter.get('/dashboard/charts/registrations', requirePerm('students.view'), ah(async (req, res) => {
  const months = parseInt(req.query.months, 10) || 12;
  const rows = db.prepare(`
    SELECT strftime('%Y-%m', created_at) AS m, COUNT(*) AS c FROM students
    WHERE created_at >= date('now', ?) GROUP BY m ORDER BY m
  `).all(`-${months} months`);
  const map = new Map(rows.map((r) => [r.m, r.c]));
  const out = recentMonths(months).map((m) => ({
    month: m.key, label: m.label, count: map.get(m.key) || 0,
  }));
  res.json({ data: out });
}));

reportsRouter.get('/dashboard/charts/applications', requirePerm('applications.view'), ah(async (req, res) => {
  const months = parseInt(req.query.months, 10) || 12;
  const created = db.prepare(`
    SELECT strftime('%Y-%m', created_at) AS m, COUNT(*) AS c FROM applications
    WHERE created_at >= date('now', ?) GROUP BY m
  `).all(`-${months} months`);
  const approved = db.prepare(`
    SELECT strftime('%Y-%m', decision_at) AS m, COUNT(*) AS c FROM applications
    WHERE decision_at IS NOT NULL AND status = 'approved' AND decision_at >= date('now', ?) GROUP BY m
  `).all(`-${months} months`);
  const rejected = db.prepare(`
    SELECT strftime('%Y-%m', decision_at) AS m, COUNT(*) AS c FROM applications
    WHERE decision_at IS NOT NULL AND status = 'rejected' AND decision_at >= date('now', ?) GROUP BY m
  `).all(`-${months} months`);
  const cm = new Map(created.map((r) => [r.m, r.c]));
  const am = new Map(approved.map((r) => [r.m, r.c]));
  const rm = new Map(rejected.map((r) => [r.m, r.c]));
  const out = recentMonths(months).map((m) => ({
    month: m.key, label: m.label,
    received: cm.get(m.key) || 0, approved: am.get(m.key) || 0, rejected: rm.get(m.key) || 0,
  }));
  res.json({ data: out });
}));

/** Occupancy trend: beds occupied at each month end (derived from allocations). */
reportsRouter.get('/dashboard/charts/occupancy-trend', requirePerm('rooms.view'), ah(async (req, res) => {
  const months = parseInt(req.query.months, 10) || 12;
  const totalBeds = db.prepare('SELECT COUNT(*) AS c FROM beds').get().c;
  const out = recentMonths(months).map((m) => {
    const occupied = db.prepare(`
      SELECT COUNT(DISTINCT a.bed_id) AS c FROM bed_allocations a
      WHERE a.status IN ('active','reserved','completed')
        AND date(a.check_in_date) <= date(?)
        AND date(COALESCE(a.check_out_date, '9999-12-31')) >= date(?)
    `).get(m.end_date, m.end_date).c;
    return {
      month: m.key,
      label: m.label,
      pct: totalBeds ? Math.round((occupied / totalBeds) * 100) : 0,
      occupied,
    };
  });
  res.json({ data: out });
}));

reportsRouter.get('/dashboard/charts/complaints', requirePerm('complaints.view'), ah(async (req, res) => {
  const byCategory = db.prepare(`
    SELECT category, COUNT(*) AS count FROM complaints
    WHERE status IN ('open','acknowledged','assigned','in_progress','awaiting_student','escalated')
    GROUP BY category ORDER BY count DESC
  `).all();
  const byStatus = db.prepare('SELECT status, COUNT(*) AS count FROM complaints GROUP BY status ORDER BY count DESC').all();
  const avgResolution = db.prepare(`
    SELECT AVG((julianday(resolved_at) - julianday(created_at)) * 24) AS hours
    FROM complaints WHERE resolved_at IS NOT NULL
  `).get().hours;
  res.json({
    by_category: byCategory,
    by_status: byStatus,
    open_total: byCategory.reduce((s, r) => s + r.count, 0),
    avg_resolution_hours: avgResolution ? Math.round(avgResolution * 10) / 10 : null,
  });
}));

reportsRouter.get('/dashboard/charts/maintenance', requirePerm('maintenance.view'), ah(async (req, res) => {
  const byStatus = db.prepare('SELECT status, COUNT(*) AS count FROM maintenance_jobs GROUP BY status').all();
  const byPriority = db.prepare(`
    SELECT priority, COUNT(*) AS count FROM maintenance_jobs
    WHERE status NOT IN ('verified','cancelled') GROUP BY priority
  `).all();
  const monthly = db.prepare(`
    SELECT strftime('%Y-%m', created_at) AS m, COUNT(*) AS count FROM maintenance_jobs
    WHERE created_at >= date('now', '-11 months') GROUP BY m ORDER BY m
  `).all();
  res.json({ by_status: byStatus, by_priority: byPriority, monthly });
}));

reportsRouter.get('/dashboard/charts/cleaning', requirePerm('cleaning.view'), ah(async (req, res) => {
  const totals = db.prepare(`
    SELECT COUNT(*) AS total,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN status IN ('pending','in_progress') THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status IN ('failed_inspection','missed') THEN 1 ELSE 0 END) AS failed
    FROM cleaning_tasks WHERE task_date = ?
  `).get(todayISO());
  const week = db.prepare(`
    SELECT task_date AS date,
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed
    FROM cleaning_tasks WHERE task_date >= date('now', '-6 days') GROUP BY task_date ORDER BY task_date
  `).all();
  res.json({ today: totals, week });
}));

/** Income vs expenses per month (income = payments, expenses = expense records). */
reportsRouter.get('/dashboard/charts/financial', requirePerm('finance.view'), ah(async (req, res) => {
  const months = parseInt(req.query.months, 10) || 12;
  const income = db.prepare(`
    SELECT strftime('%Y-%m', paid_at) AS m, SUM(amount) AS total FROM payments
    WHERE status != 'void' AND paid_at >= date('now', ?) GROUP BY m
  `).all(`-${months} months`);
  const expense = db.prepare(`
    SELECT strftime('%Y-%m', incurred_date) AS m, SUM(amount) AS total FROM expenses
    WHERE status IN ('approved','paid') AND incurred_date >= date('now', ?) GROUP BY m
  `).all(`-${months} months`);
  const im = new Map(income.map((r) => [r.m, r.total]));
  const em = new Map(expense.map((r) => [r.m, r.total]));
  const out = recentMonths(months).map((m) => ({
    month: m.key, label: m.label,
    income: Math.round((im.get(m.key) || 0) * 100) / 100,
    expenses: Math.round((em.get(m.key) || 0) * 100) / 100,
  }));
  res.json({ data: out });
}));

reportsRouter.get('/dashboard/charts/outstanding', requirePerm('finance.view'), ah(async (req, res) => {
  const rows = db.prepare(`
    SELECT s.student_ref, s.full_name,
      (i.total - COALESCE((SELECT SUM(pa.amount) FROM payment_allocations pa WHERE pa.invoice_id = i.id), 0)) AS due
    FROM invoices i JOIN students s ON s.id = i.student_id
    WHERE i.status NOT IN ('void','paid') AND s.status IN ('active','registered')
    ORDER BY due DESC LIMIT 10
  `).all().map((r) => ({ ...r, due: Math.round(r.due * 100) / 100 }));
  res.json({ data: rows });
}));

reportsRouter.get('/dashboard/charts/tasks', requirePerm('tasks.view'), ah(async (req, res) => {
  const byStatus = db.prepare('SELECT status, COUNT(*) AS count FROM tasks GROUP BY status').all();
  const monthly = db.prepare(`
    SELECT strftime('%Y-%m', COALESCE(completed_at, created_at)) AS m,
      SUM(CASE WHEN status IN ('done','verified') THEN 1 ELSE 0 END) AS completed,
      COUNT(*) AS total
    FROM tasks WHERE created_at >= date('now', '-11 months') GROUP BY m ORDER BY m
  `).all();
  res.json({ by_status: byStatus, monthly });
}));

// --------------------------- operational panels ----------------------------

reportsRouter.get('/dashboard/panels', requirePerm('students.view'), ah(async (req, res) => {
  const today = todayISO();
  const myStaffId = req.user.staff_id || '';

  const todaysTasks = db.prepare(`
    SELECT t.*, st.full_name AS assignee_name FROM tasks t LEFT JOIN staff st ON st.id = t.assigned_to
    WHERE (date(t.due_date) = date(?) OR (t.due_date IS NULL AND date(t.created_at) = date(?)))
      AND t.status NOT IN ('done','verified')
    ORDER BY t.due_date, t.priority DESC LIMIT 8
  `).all(today, today);

  const upcoming = db.prepare(`
    SELECT s.id, s.student_ref, s.full_name, s.check_in_date, s.expected_check_out_date, p.name AS property_name
    FROM students s LEFT JOIN properties p ON p.id = s.property_id
    WHERE (date(s.check_in_date) BETWEEN date(?) AND date(?, '+7 days'))
       OR (date(s.expected_check_out_date) BETWEEN date(?) AND date(?, '+7 days'))
    ORDER BY COALESCE(s.check_in_date, s.expected_check_out_date) LIMIT 8
  `).all(today, today, today, today);

  const applicationsAttention = db.prepare(`
    SELECT a.id, a.app_ref, a.status, a.created_at, a.submitted_at, s.full_name AS student_name, s.student_ref, p.name AS property_name
    FROM applications a JOIN students s ON s.id = a.student_id LEFT JOIN properties p ON p.id = a.property_id
    WHERE a.status IN ('submitted','under_review','info_required')
    ORDER BY COALESCE(a.submitted_at, a.created_at) LIMIT 6
  `).all();

  const recentComplaints = db.prepare(`
    SELECT c.id, c.ticket_ref, c.subject, c.category, c.priority, c.status, c.created_at,
      s.full_name AS student_name, s.student_ref, p.name AS property_name, r.room_number
    FROM complaints c LEFT JOIN students s ON s.id = c.student_id
    LEFT JOIN properties p ON p.id = c.property_id LEFT JOIN rooms r ON r.id = c.room_id
    ORDER BY c.created_at DESC LIMIT 6
  `).all();

  const priorityMaintenance = db.prepare(`
    SELECT m.id, m.job_ref, m.title, m.priority, m.status, m.due_date, p.name AS property_name, r.room_number
    FROM maintenance_jobs m LEFT JOIN properties p ON p.id = m.property_id LEFT JOIN rooms r ON r.id = m.room_id
    WHERE m.status NOT IN ('verified','cancelled')
    ORDER BY CASE m.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, m.due_date
    LIMIT 6
  `).all();

  const overduePayments = db.prepare(`
    SELECT i.id, i.invoice_ref, i.due_date, i.total, i.status, s.full_name AS student_name, s.student_ref,
      (i.total - COALESCE((SELECT SUM(pa.amount) FROM payment_allocations pa WHERE pa.invoice_id = i.id), 0)) AS due
    FROM invoices i JOIN students s ON s.id = i.student_id
    WHERE i.status IN ('overdue','partially_paid','issued') AND date(i.due_date) < date(?)
      AND s.status IN ('active','registered')
    ORDER BY i.due_date LIMIT 6
  `).all(today).map((r) => ({ ...r, due: Math.round(r.due * 100) / 100 }));

  const recentActivity = db.prepare(
    'SELECT action, entity_type, summary, user_email, created_at FROM audit_logs ORDER BY created_at DESC LIMIT 8'
  ).all();

  const announcements = db.prepare(`
    SELECT id, title, priority, published_at FROM announcements
    WHERE status = 'published' ORDER BY published_at DESC LIMIT 4
  `).all();

  const alerts = [];
  const pendingApps = db.prepare("SELECT COUNT(*) AS c FROM applications WHERE status IN ('submitted','under_review')").get().c;
  for (const c of db.prepare(`
    SELECT ticket_ref, subject, priority, created_at FROM complaints
    WHERE priority = 'urgent' AND status IN ('open','escalated','assigned','in_progress') ORDER BY created_at DESC LIMIT 3
  `).all()) {
    alerts.push({ level: 'URGENT', title: c.subject, ref: c.ticket_ref, at: c.created_at, link: `/complaints?ref=${c.ticket_ref}` });
  }
  for (const m of db.prepare(`
    SELECT job_ref, title, created_at FROM maintenance_jobs
    WHERE priority = 'urgent' AND status NOT IN ('verified','cancelled') ORDER BY created_at DESC LIMIT 2
  `).all()) {
    alerts.push({ level: 'HIGH', title: m.title, ref: m.job_ref, at: m.created_at, link: '/maintenance' });
  }
  if (pendingApps > 0) alerts.push({ level: 'APPLICATIONS', title: `${pendingApps} applications awaiting review`, at: new Date().toISOString(), link: '/applications' });

  res.json({
    todays_tasks: todaysTasks,
    upcoming_checkinout: upcoming,
    applications_attention: applicationsAttention,
    recent_complaints: recentComplaints,
    priority_maintenance: priorityMaintenance,
    overdue_payments: overduePayments,
    recent_activity: recentActivity,
    announcements,
    alerts,
  });
}));

// ------------------------------ reports centre ------------------------------

const REPORTS = {
  registrations: {
    perm: 'students.view',
    run: (args) => ({
      headers: ['Student Ref', 'Full Name', 'Email', 'Phone', 'Institution', 'Status', 'Registered'],
      rows: db.prepare(`SELECT student_ref, full_name, email, phone, institution, status, date(created_at) AS registered
        FROM students WHERE 1=1 ${args.clause} ORDER BY created_at DESC`).all(...args.args)
        .map((r) => ({ 'Student Ref': r.student_ref, 'Full Name': r.full_name, Email: r.email, Phone: r.phone,
          Institution: r.institution, Status: r.status, Registered: r.registered })),
    }),
  },
  admissions: {
    perm: 'applications.view',
    run: (args) => ({
      headers: ['Application Ref', 'Student Ref', 'Student Name', 'Property', 'Status', 'Submitted', 'Decision Date'],
      rows: db.prepare(`SELECT a.app_ref, s.student_ref, s.full_name, p.name AS property, a.status,
          date(COALESCE(a.submitted_at, a.created_at)) AS submitted, date(a.decision_at) AS decision
        FROM applications a JOIN students s ON s.id = a.student_id LEFT JOIN properties p ON p.id = a.property_id
        WHERE 1=1 ${args.clause} ORDER BY a.created_at DESC`).all(...args.args)
        .map((r) => ({ 'Application Ref': r.app_ref, 'Student Ref': r.student_ref, 'Student Name': r.full_name,
          Property: r.property, Status: r.status, Submitted: r.submitted, 'Decision Date': r.decision })),
    }),
  },
  occupancy: {
    perm: 'rooms.view',
    run: (args) => ({
      headers: ['Property', 'Building', 'Room', 'Room Type', 'Bed', 'Occupant', 'Status', 'Check-in', 'Check-out'],
      rows: db.prepare(`SELECT p.name AS property, b.name AS building, r.room_number AS room, r.room_type,
          be.label AS bed, COALESCE(s.full_name, '') AS occupant, be.status,
          COALESCE(a.check_in_date, '') AS ci, COALESCE(a.check_out_date, '') AS co
        FROM beds be JOIN rooms r ON r.id = be.room_id JOIN buildings b ON b.id = r.building_id
        JOIN properties p ON p.id = b.property_id
        LEFT JOIN bed_allocations a ON a.bed_id = be.id AND a.status IN ('active','reserved')
        LEFT JOIN students s ON s.id = a.student_id
        WHERE 1=1 ${args.propClause || ''} ORDER BY p.name, b.name, r.room_number, be.label`).all(...(args.propArgs || []))
        .map((r) => ({ Property: r.property, Building: r.building, Room: r.room, 'Room Type': r.room_type,
          Bed: r.bed, Occupant: r.occupant, Status: r.status, 'Check-in': r.ci, 'Check-out': r.co })),
    }),
  },
  complaints: {
    perm: 'complaints.view',
    run: (args) => ({
      headers: ['Ticket', 'Category', 'Subject', 'Priority', 'Status', 'Department', 'Student', 'Property', 'Submitted', 'Resolved'],
      rows: db.prepare(`SELECT c.ticket_ref, c.category, c.subject, c.priority, c.status, c.assigned_dept,
          COALESCE(s.full_name, 'Walk-in') AS student, COALESCE(p.name, '') AS property,
          datetime(c.created_at) AS submitted, datetime(c.resolved_at) AS resolved
        FROM complaints c LEFT JOIN students s ON s.id = c.student_id LEFT JOIN properties p ON p.id = c.property_id
        WHERE 1=1 ${args.clause} ORDER BY c.created_at DESC`).all(...args.args)
        .map((r) => ({ Ticket: r.ticket_ref, Category: r.category, Subject: r.subject, Priority: r.priority,
          Status: r.status, Department: r.assigned_dept, Student: r.student, Property: r.property,
          Submitted: r.submitted, Resolved: r.resolved })),
    }),
  },
  maintenance: {
    perm: 'maintenance.view',
    run: (args) => ({
      headers: ['Job Ref', 'Title', 'Priority', 'Status', 'Property', 'Room', 'Assigned To', 'Due', 'Est Cost', 'Actual Cost'],
      rows: db.prepare(`SELECT m.job_ref, m.title, m.priority, m.status, COALESCE(p.name, '') AS property,
          COALESCE(r.room_number, '') AS room, COALESCE(st.full_name, '') AS assignee,
          COALESCE(m.due_date, '') AS due, m.estimated_cost, m.actual_cost
        FROM maintenance_jobs m LEFT JOIN properties p ON p.id = m.property_id LEFT JOIN rooms r ON r.id = m.room_id
        LEFT JOIN staff st ON st.id = m.assigned_to WHERE 1=1 ${args.clause} ORDER BY m.created_at DESC`).all(...args.args)
        .map((r) => ({ 'Job Ref': r.job_ref, Title: r.title, Priority: r.priority, Status: r.status,
          Property: r.property, Room: r.room, 'Assigned To': r.assignee, Due: r.due,
          'Est Cost': r.estimated_cost, 'Actual Cost': r.actual_cost })),
    }),
  },
  cleaning: {
    perm: 'cleaning.view',
    run: (args) => ({
      headers: ['Date', 'Area', 'Property', 'Cleaner', 'Status', 'Due Time', 'Completed At', 'Notes'],
      rows: db.prepare(`SELECT ct.task_date, ct.area_name, COALESCE(p.name, '') AS property,
          COALESCE(st.full_name, '') AS cleaner, ct.status, COALESCE(ct.due_time, '') AS due_time,
          datetime(ct.completed_at) AS completed, COALESCE(ct.notes, '') AS notes
        FROM cleaning_tasks ct LEFT JOIN properties p ON p.id = ct.property_id LEFT JOIN staff st ON st.id = ct.cleaner_id
        WHERE 1=1 ${args.clause} ORDER BY ct.task_date DESC`).all(...args.args)
        .map((r) => ({ Date: r.task_date, Area: r.area_name, Property: r.property, Cleaner: r.cleaner,
          Status: r.status, 'Due Time': r.due_time, 'Completed At': r.completed, Notes: r.notes })),
    }),
  },
  income_expenses: {
    perm: 'finance.view',
    run: (args) => ({
      headers: ['Month', 'Income (ZAR)', 'Expenses (ZAR)', 'Net (ZAR)'],
      rows: (() => {
        const inc = db.prepare(`SELECT strftime('%Y-%m', paid_at) AS m, SUM(amount) AS total FROM payments
          WHERE status != 'void' ${args.clause} GROUP BY m`).all(...args.args);
        const exp = db.prepare(`SELECT strftime('%Y-%m', incurred_date) AS m, SUM(amount) AS total FROM expenses
          WHERE status IN ('approved','paid') GROUP BY m`).all();
        const map = new Map();
        for (const i of inc) map.set(i.m, { income: i.total, expenses: 0 });
        for (const e of exp) {
          const cur = map.get(e.m) || { income: 0, expenses: 0 };
          cur.expenses = e.total; map.set(e.m, cur);
        }
        return [...map.entries()].sort().reverse().map(([m, v]) => ({
          Month: m, 'Income (ZAR)': (Math.round(v.income * 100) / 100).toFixed(2),
          'Expenses (ZAR)': (Math.round(v.expenses * 100) / 100).toFixed(2),
          'Net (ZAR)': (Math.round((v.income - v.expenses) * 100) / 100).toFixed(2),
        }));
      })(),
    }),
  },
  balances: {
    perm: 'finance.view',
    run: () => ({
      headers: ['Student Ref', 'Full Name', 'Status', 'Invoiced (ZAR)', 'Paid (ZAR)', 'Balance (ZAR)'],
      rows: db.prepare(`
        SELECT s.student_ref, s.full_name, s.status,
          COALESCE((SELECT SUM(total) FROM invoices i WHERE i.student_id = s.id AND i.status != 'void'), 0) AS invoiced,
          COALESCE((SELECT SUM(amount) FROM payments p WHERE p.student_id = s.id AND p.status != 'void'), 0) AS paid
        FROM students s WHERE s.status IN ('active','registered') ORDER BY s.full_name
      `).all().map((r) => ({ 'Student Ref': r.student_ref, 'Full Name': r.full_name, Status: r.status,
        'Invoiced (ZAR)': (Math.round(r.invoiced * 100) / 100).toFixed(2),
        'Paid (ZAR)': (Math.round(r.paid * 100) / 100).toFixed(2),
        'Balance (ZAR)': (Math.round((r.invoiced - r.paid) * 100) / 100).toFixed(2) })),
    }),
  },
  tasks: {
    perm: 'tasks.view',
    run: (args) => ({
      headers: ['Task Ref', 'Title', 'Assigned To', 'Department', 'Priority', 'Status', 'Due Date'],
      rows: db.prepare(`SELECT t.task_ref, t.title, COALESCE(st.full_name, '') AS assignee, COALESCE(t.department, '') AS department,
          t.priority, t.status, COALESCE(t.due_date, '') AS due
        FROM tasks t LEFT JOIN staff st ON st.id = t.assigned_to WHERE 1=1 ${args.clause} ORDER BY t.due_date`).all(...args.args)
        .map((r) => ({ 'Task Ref': r.task_ref, Title: r.title, 'Assigned To': r.assignee, Department: r.department,
          Priority: r.priority, Status: r.status, 'Due Date': r.due })),
    }),
  },
  property_performance: {
    perm: 'reports.view',
    run: () => ({
      headers: ['Property', 'Buildings', 'Rooms', 'Beds', 'Occupied', 'Occupancy %', 'Students', 'Open Complaints'],
      rows: db.prepare(`
        SELECT p.name, (SELECT COUNT(*) FROM buildings b WHERE b.property_id = p.id) AS buildings,
          (SELECT COUNT(*) FROM rooms r JOIN buildings b ON b.id = r.building_id WHERE b.property_id = p.id) AS rooms,
          (SELECT COUNT(*) FROM beds be JOIN rooms r ON r.id = be.room_id JOIN buildings b ON b.id = r.building_id WHERE b.property_id = p.id) AS beds,
          (SELECT COUNT(*) FROM beds be JOIN rooms r ON r.id = be.room_id JOIN buildings b ON b.id = r.building_id
            WHERE b.property_id = p.id AND EXISTS (SELECT 1 FROM bed_allocations a WHERE a.bed_id = be.id AND a.status IN ('active','reserved'))) AS occupied,
          (SELECT COUNT(*) FROM students s WHERE s.property_id = p.id AND s.status = 'active') AS students,
          (SELECT COUNT(*) FROM complaints c WHERE c.property_id = p.id AND c.status IN ('open','acknowledged','assigned','in_progress','escalated')) AS open_complaints
        FROM properties p WHERE p.status = 'active' ORDER BY p.name
      `).all().map((r) => ({ Property: r.name, Buildings: r.buildings, Rooms: r.rooms, Beds: r.beds,
        Occupied: r.occupied, 'Occupancy %': r.beds ? Math.round((r.occupied / r.beds) * 100) : 0,
        Students: r.students, 'Open Complaints': r.open_complaints })),
    }),
  },
};

reportsRouter.get('/reports/:kind', requirePerm('reports.view'), ah(async (req, res) => {
  const report = REPORTS[req.params.kind];
  if (!report) return res.status(404).json({ error: 'Unknown report.' });
  if (!req.permissions.includes(report.perm)) return res.status(403).json({ error: 'Not authorised for this report.' });
  const clause = [];
  const args = [];
  const from = String(req.query.from || '').trim();
  const to = String(req.query.to || '').trim();
  const propCol = { registrations: 'created_at', admissions: 'created_at', complaints: 'created_at',
    maintenance: 'created_at', cleaning: 'task_date', tasks: 'created_at', income_expenses: 'paid_at' }[req.params.kind];
  if (from && propCol) { clause.push(`AND date(${propCol}) >= date(?)`); args.push(from); }
  if (to && propCol) { clause.push(`AND date(${propCol}) <= date(?)`); args.push(to); }
  const pid = String(req.query.property_id || '').trim();
  if (pid && ['complaints', 'maintenance', 'cleaning'].includes(req.params.kind)) {
    clause.push('AND property_id = ?'); args.push(pid);
  }
  const propClause = pid ? 'AND p.id = ?' : '';
  const result = report.run({ clause: clause.join(' '), args, propClause, propArgs: pid ? [pid] : [] });

  if (req.query.format === 'csv') {
    if (!req.permissions.includes('reports.export')) return res.status(403).json({ error: 'Export not permitted.' });
    auditExport(req, req.params.kind);
    return sendCsv(res, `faranani-${req.params.kind}-${todayISO()}.csv`, result.headers, result.rows);
  }
  res.json({ headers: result.headers, rows: result.rows });
}));

function auditExport(req, kind) {
  // lazy import avoided: audit lives in db.js
  import('../db.js').then(({ audit }) => audit({
    userId: req.user.id, userEmail: req.user.email, action: 'report.export',
    entityType: 'report', entityId: kind, summary: `Exported ${kind} report to CSV`, ip: req.ip,
  }));
}

export { REPORTS };
