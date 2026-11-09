// ---------------------------------------------------------------------------
// Operations routes: Complaints, Maintenance, Cleaning, Tasks, Events,
// Announcements. Complaints are ONE shared record used by the public website,
// student portal and internal system — never duplicated per platform.
// ---------------------------------------------------------------------------
import { Router } from 'express';
import { db, newId, nextRef, now, tx, audit } from '../db.js';
import { requirePerm, can } from '../auth.js';
import {
  ah, listParams, paginated, likeTerm, isBlank, num, todayISO,
  notify, notifyRoles, CATEGORIES, COMPLAINT_STATUSES, PRIORITY_RULES,
} from '../util.js';

export const opsRouter = Router();

// ============================== COMPLAINTS ================================

const OPEN_STATUSES = ['open', 'acknowledged', 'assigned', 'in_progress', 'awaiting_student', 'escalated'];

function complaintHistory(id) {
  return db.prepare(
    'SELECT * FROM complaint_status_history WHERE complaint_id = ? ORDER BY changed_at DESC'
  ).all(id);
}

function pushHistory(complaintId, from, to, req, note) {
  db.prepare(`
    INSERT INTO complaint_status_history (id, complaint_id, from_status, to_status, changed_by, changed_by_name, note, changed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(newId(), complaintId, from, to, req.user?.id || null, req.user?.full_name || 'System', note || null, now());
}

/** Configurable routing rules: category → department. */
const ROUTING = {
  Electrical: 'Maintenance', Plumbing: 'Maintenance', Facilities: 'Maintenance',
  Cleaning: 'Housekeeping', Security: 'Security', Noise: 'Security',
  'Internet Access': 'Facilities', 'Room Conditions': 'Housekeeping', Other: 'Admissions',
};
const ESCALATE_CATEGORIES = new Set(['Security', 'Electrical', 'Plumbing']);

function dueDateFor(priority) {
  const hours = PRIORITY_RULES[priority] || PRIORITY_RULES.normal;
  return new Date(Date.now() + hours * 3600 * 1000).toISOString();
}

opsRouter.get('/complaints', requirePerm('complaints.view'), ah(async (req, res) => {
  const { q, page, pageSize, offset, sort, dir } = listParams(req);
  const where = ['1=1']; const args = [];
  if (q) {
    where.push("(c.ticket_ref LIKE ? ESCAPE '\\' OR c.subject LIKE ? ESCAPE '\\' OR c.description LIKE ? ESCAPE '\\' OR s.full_name LIKE ? ESCAPE '\\' OR s.student_ref LIKE ? ESCAPE '\\')");
    const t = likeTerm(q); args.push(t, t, t, t, t);
  }
  for (const [param, col] of [['status', 'c.status'], ['category', 'c.category'], ['priority', 'c.priority'],
    ['property_id', 'c.property_id'], ['assigned_dept', 'c.assigned_dept'], ['assigned_to', 'c.assigned_to']]) {
    const v = String(req.query[param] || '').trim();
    if (v) { where.push(`${col} = ?`); args.push(v); }
  }
  if (req.query.open === 'true') {
    where.push(`c.status IN (${OPEN_STATUSES.map(() => '?').join(',')})`);
    args.push(...OPEN_STATUSES);
  }
  const from = String(req.query.from || '').trim();
  if (from) { where.push('date(c.created_at) >= date(?)'); args.push(from); }
  const to = String(req.query.to || '').trim();
  if (to) { where.push('date(c.created_at) <= date(?)'); args.push(to); }

  const sortable = new Set(['ticket_ref', 'status', 'priority', 'created_at', 'category']);
  const orderCol = sortable.has(sort) ? `c.${sort}` : 'c.created_at';
  const total = db.prepare(`SELECT COUNT(*) AS c FROM complaints c LEFT JOIN students s ON s.id = c.student_id WHERE ${where.join(' AND ')}`).get(...args).c;
  const rows = db.prepare(`
    SELECT c.*, s.full_name AS student_name, s.student_ref, p.name AS property_name,
      b.name AS building_name, r.room_number, st.full_name AS assignee_name
    FROM complaints c
    LEFT JOIN students s ON s.id = c.student_id
    LEFT JOIN properties p ON p.id = c.property_id
    LEFT JOIN buildings b ON b.id = c.building_id
    LEFT JOIN rooms r ON r.id = c.room_id
    LEFT JOIN staff st ON st.id = c.assigned_to
    WHERE ${where.join(' AND ')}
    ORDER BY ${orderCol} ${dir}
    LIMIT ? OFFSET ?
  `).all(...args, pageSize, offset);
  res.json(paginated(rows, total, page, pageSize));
}));

opsRouter.get('/complaints/:id', requirePerm('complaints.view'), ah(async (req, res) => {
  const row = db.prepare(`
    SELECT c.*, s.full_name AS student_name, s.student_ref, s.email AS student_email, s.phone AS student_phone,
      p.name AS property_name, b.name AS building_name, r.room_number, st.full_name AS assignee_name
    FROM complaints c
    LEFT JOIN students s ON s.id = c.student_id
    LEFT JOIN properties p ON p.id = c.property_id
    LEFT JOIN buildings b ON b.id = c.building_id
    LEFT JOIN rooms r ON r.id = c.room_id
    LEFT JOIN staff st ON st.id = c.assigned_to
    WHERE c.id = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Complaint not found.' });
  const comments = db.prepare('SELECT * FROM complaint_comments WHERE complaint_id = ? ORDER BY created_at').all(req.params.id);
  const history = complaintHistory(req.params.id);
  const jobs = db.prepare('SELECT id, job_ref, title, status, priority, assigned_to FROM maintenance_jobs WHERE complaint_id = ?').all(req.params.id);
  // Internal notes are stripped for users without complaints.manage
  const visibleComments = can(req, 'complaints.manage')
    ? comments
    : comments.filter((c) => c.visibility !== 'internal');
  res.json({ ...row, comments: visibleComments, history, maintenance_jobs: jobs });
}));

/** Public/portal submission — same table as the internal system. */
opsRouter.post('/complaints', ah(async (req, res) => {
  const b = req.body || {};
  requireFields_public(b);
  // Public submission requires either an authenticated session or a valid student reference
  let studentId = b.student_id || null;
  if (!studentId && b.student_ref) {
    const s = db.prepare('SELECT id FROM students WHERE student_ref = ?').get(String(b.student_ref).trim());
    if (s) studentId = s.id;
  }
  if (!req.user && !studentId) {
    return res.status(400).json({ error: 'Provide your student reference so we can track your complaint.' });
  }
  const student = studentId ? db.prepare('SELECT * FROM students WHERE id = ?').get(studentId) : null;
  const category = CATEGORIES.includes(b.category) ? b.category : 'Other';
  const priority = ['low', 'normal', 'high', 'urgent'].includes(b.priority) ? b.priority : 'normal';
  const escalate = ESCALATE_CATEGORIES.has(category) && (priority === 'urgent' || priority === 'high');
  const id = newId();
  const ref = nextRef(db, 'FAR');
  const t = now();
  const dept = ROUTING[category] || 'Admissions';
  const status = escalate ? 'escalated' : 'open';

  // Resolve property/building/room from the student when not supplied
  let propertyId = b.property_id || student?.property_id || null;
  let buildingId = b.building_id || null;
  let roomId = b.room_id || student?.room_id || null;
  if (roomId && !buildingId) {
    const r = db.prepare('SELECT building_id FROM rooms WHERE id = ?').get(roomId);
    buildingId = r?.building_id || null;
  }
  if (buildingId && !propertyId) {
    const bd = db.prepare('SELECT property_id FROM buildings WHERE id = ?').get(buildingId);
    propertyId = bd?.property_id || null;
  }

  tx(() => {
    db.prepare(`
      INSERT INTO complaints (id, ticket_ref, student_id, property_id, building_id, room_id, category, subject,
        description, priority, status, assigned_dept, submitted_via, submitted_at, due_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, ref, studentId, propertyId, buildingId, roomId, category, b.subject.trim(),
      b.description?.trim() || b.subject.trim(), priority, status, dept,
      b.submitted_via || (req.user ? 'staff' : 'portal'), t, dueDateFor(priority), t, t);
    pushHistory(id, null, status, req, escalate ? 'Auto-escalated: urgent security/electrical/water category' : 'Complaint received');
    if (b.message) {
      db.prepare(`
        INSERT INTO complaint_comments (id, complaint_id, author_id, author_name, body, visibility, created_at)
        VALUES (?, ?, ?, ?, ?, 'student_visible', ?)
      `).run(newId(), id, studentId, student?.full_name || 'Student', b.message, t);
    }
  });

  audit({
    userId: req.user?.id, userEmail: req.user?.email || student?.email, action: 'complaint.create',
    entityType: 'complaint', entityId: id, summary: `Complaint ${ref} submitted (${category}, ${priority})`, ip: req.ip,
  });
  // 5, 6, 7 — notify department + student
  notifyRoles(['super_admin', 'receptionist', 'ceo'], {
    type: 'complaint', title: `New complaint ${ref}`,
    body: `${category} · ${priority} · ${dept}${escalate ? ' · ESCALATED' : ''} — ${b.subject}`, link: `/complaints?id=${id}`,
  });
  if (studentId) {
    notify({
      studentId, userId: null, type: 'complaint', title: `Complaint received — ${ref}`,
      body: 'We have received your complaint and will update you as it progresses.', link: '/portal',
    });
  }
  res.status(201).json({ id, ticket_ref: ref, status });
}));

function requireFields_public(b) {
  if (isBlank(b?.subject) || isBlank(b?.description)) {
    const err = new Error('Subject and description are required.');
    err.status = 400;
    throw err;
  }
}

opsRouter.patch('/complaints/:id', requirePerm('complaints.manage'), ah(async (req, res) => {
  const existing = db.prepare('SELECT * FROM complaints WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Complaint not found.' });
  const b = req.body || {};
  const sets = []; const args = [];
  if (b.status !== undefined && b.status !== existing.status) {
    if (!COMPLAINT_STATUSES.includes(b.status)) return res.status(400).json({ error: 'Invalid status.' });
    sets.push('status = ?'); args.push(b.status);
    const t = now();
    if (['resolved', 'closed'].includes(b.status)) { sets.push(b.status === 'closed' ? 'closed_at = ?' : 'resolved_at = ?'); args.push(t); }
    if (b.status === 'resolved' && b.resolution_notes) { sets.push('resolution_notes = ?'); args.push(b.resolution_notes); }
    pushHistory(req.params.id, existing.status, b.status, req, b.note || null);
    if (existing.student_id) {
      notify({
        studentId: existing.student_id, type: 'complaint',
        title: `Complaint ${existing.ticket_ref} — ${b.status.replace('_', ' ')}`,
        body: b.student_message || b.note || `Your complaint is now ${b.status.replace('_', ' ')}.`,
        link: '/portal',
      });
    }
  }
  for (const f of ['assigned_dept', 'assigned_to', 'priority']) {
    if (b[f] !== undefined) { sets.push(`${f} = ?`); args.push(b[f] === '' ? null : b[f]); }
  }
  if (sets.length === 0) return res.json(existing);
  sets.push('updated_at = ?'); args.push(now(), req.params.id);
  db.prepare(`UPDATE complaints SET ${sets.join(', ')} WHERE id = ?`).run(...args);
  if (b.assigned_to) {
    const staff = db.prepare('SELECT * FROM staff WHERE id = ?').get(b.assigned_to);
    if (staff?.email) {
      notify({ type: 'assignment', title: `Complaint ${existing.ticket_ref} assigned to you`,
        body: existing.subject, link: `/complaints?id=${existing.id}` });
    }
  }
  audit({
    userId: req.user.id, userEmail: req.user.email, action: 'complaint.update',
    entityType: 'complaint', entityId: req.params.id,
    summary: `Complaint ${existing.ticket_ref} updated`, details: b, ip: req.ip,
  });
  res.json(db.prepare('SELECT * FROM complaints WHERE id = ?').get(req.params.id));
}));

opsRouter.post('/complaints/:id/comments', requirePerm('complaints.view'), ah(async (req, res) => {
  const existing = db.prepare('SELECT * FROM complaints WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Complaint not found.' });
  const body = String(req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Comment cannot be empty.' });
  const wantsInternal = req.body?.visibility === 'internal';
  if (wantsInternal && !can(req, 'complaints.manage')) {
    return res.status(403).json({ error: 'Only management can add internal notes.' });
  }
  const visibility = wantsInternal ? 'internal' : 'student_visible';
  db.prepare(`
    INSERT INTO complaint_comments (id, complaint_id, author_id, author_name, body, visibility, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(newId(), req.params.id, req.user.id, req.user.full_name, body, visibility, now());
  if (visibility === 'student_visible' && existing.student_id) {
    notify({ studentId: existing.student_id, type: 'complaint',
      title: `Update on ${existing.ticket_ref}`, body, link: '/portal' });
  }
  audit({
    userId: req.user.id, userEmail: req.user.email, action: 'complaint.comment',
    entityType: 'complaint', entityId: req.params.id, summary: `Commented on ${existing.ticket_ref}`, ip: req.ip,
  });
  res.status(201).json({ ok: true });
}));

// ============================= MAINTENANCE =================================

opsRouter.get('/maintenance', requirePerm('maintenance.view'), ah(async (req, res) => {
  const { q, page, pageSize, offset, sort, dir } = listParams(req);
  const where = ['1=1']; const args = [];
  if (q) {
    where.push("(m.job_ref LIKE ? ESCAPE '\\' OR m.title LIKE ? ESCAPE '\\' OR m.description LIKE ? ESCAPE '\\')");
    const t = likeTerm(q); args.push(t, t, t);
  }
  for (const [param, col] of [['status', 'm.status'], ['priority', 'm.priority'], ['property_id', 'm.property_id'], ['assigned_to', 'm.assigned_to']]) {
    const v = String(req.query[param] || '').trim();
    if (v) { where.push(`${col} = ?`); args.push(v); }
  }
  if (req.query.open === 'true') where.push("m.status NOT IN ('verified','cancelled')");
  const sortable = new Set(['job_ref', 'status', 'priority', 'created_at', 'due_date']);
  const orderCol = sortable.has(sort) ? `m.${sort}` : 'm.created_at';
  const total = db.prepare(`SELECT COUNT(*) AS c FROM maintenance_jobs m WHERE ${where.join(' AND ')}`).get(...args).c;
  const rows = db.prepare(`
    SELECT m.*, p.name AS property_name, r.room_number, b.name AS building_name, c.ticket_ref, c.subject AS complaint_subject,
      st.full_name AS assignee_name
    FROM maintenance_jobs m
    LEFT JOIN properties p ON p.id = m.property_id
    LEFT JOIN rooms r ON r.id = m.room_id
    LEFT JOIN buildings b ON b.id = m.building_id
    LEFT JOIN complaints c ON c.id = m.complaint_id
    LEFT JOIN staff st ON st.id = m.assigned_to
    WHERE ${where.join(' AND ')} ORDER BY ${orderCol} ${dir} LIMIT ? OFFSET ?
  `).all(...args, pageSize, offset);
  res.json(paginated(rows, total, page, pageSize));
}));

opsRouter.get('/maintenance/:id', requirePerm('maintenance.view'), ah(async (req, res) => {
  const row = db.prepare(`
    SELECT m.*, p.name AS property_name, r.room_number, b.name AS building_name, c.ticket_ref, c.subject AS complaint_subject,
      c.status AS complaint_status, st.full_name AS assignee_name
    FROM maintenance_jobs m
    LEFT JOIN properties p ON p.id = m.property_id
    LEFT JOIN rooms r ON r.id = m.room_id
    LEFT JOIN buildings b ON b.id = m.building_id
    LEFT JOIN complaints c ON c.id = m.complaint_id
    LEFT JOIN staff st ON st.id = m.assigned_to
    WHERE m.id = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Maintenance job not found.' });
  const photos = db.prepare('SELECT * FROM maintenance_photos WHERE job_id = ?').all(req.params.id);
  res.json({ ...row, photos });
}));

opsRouter.post('/maintenance', requirePerm('maintenance.manage'), ah(async (req, res) => {
  const b = req.body || {};
  if (isBlank(b.title) || isBlank(b.description)) return res.status(400).json({ error: 'Title and description are required.' });
  const id = newId();
  const ref = nextRef(db, 'FAR-MT');
  const t = now();
  // A complaint may create a maintenance job, but is NOT modified here —
  // closing this job later will never auto-close the complaint.
  db.prepare(`
    INSERT INTO maintenance_jobs (id, job_ref, complaint_id, property_id, building_id, room_id, title, description,
      priority, status, assigned_to, due_date, estimated_cost, materials, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, ref, b.complaint_id || null, b.property_id || null, b.building_id || null, b.room_id || null,
    b.title.trim(), b.description.trim(), b.priority || 'normal',
    b.assigned_to ? 'assigned' : 'pending', b.assigned_to || null, b.due_date || null,
    num(b.estimated_cost, 0), JSON.stringify(b.materials || []), req.user.id, t, t);
  if (b.complaint_id) {
    const c = db.prepare('SELECT * FROM complaints WHERE id = ?').get(b.complaint_id);
    if (c && c.status === 'open') {
      db.prepare("UPDATE complaints SET status = 'assigned', updated_at = ? WHERE id = ?").run(t, c.id);
      pushHistory(c.id, c.status, 'assigned', req, `Maintenance job ${ref} created`);
    }
    db.prepare(`
      INSERT INTO complaint_comments (id, complaint_id, author_id, author_name, body, visibility, created_at)
      VALUES (?, ?, ?, ?, ?, 'student_visible', ?)
    `).run(newId(), b.complaint_id, req.user.id, req.user.full_name,
      `Maintenance job ${ref} has been raised for this complaint.`, t);
  }
  if (b.assigned_to) {
    notify({ type: 'assignment', title: `Maintenance job ${ref} assigned`, body: b.title, link: `/maintenance?id=${id}` });
  }
  audit({
    userId: req.user.id, userEmail: req.user.email, action: 'maintenance.create',
    entityType: 'maintenance_job', entityId: id, summary: `Created job ${ref} — ${b.title}`, ip: req.ip,
  });
  res.status(201).json(db.prepare('SELECT * FROM maintenance_jobs WHERE id = ?').get(id));
}));

opsRouter.patch('/maintenance/:id', requirePerm('maintenance.manage'), ah(async (req, res) => {
  const existing = db.prepare('SELECT * FROM maintenance_jobs WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Maintenance job not found.' });
  const b = req.body || {};
  const sets = []; const args = [];
  for (const f of ['title', 'description', 'priority', 'status', 'assigned_to', 'due_date', 'estimated_cost', 'actual_cost', 'work_notes']) {
    if (b[f] !== undefined) { sets.push(`${f} = ?`); args.push(b[f] === '' ? null : b[f]); }
  }
  if (b.materials !== undefined) { sets.push('materials = ?'); args.push(JSON.stringify(b.materials || [])); }
  if (b.status === 'completed') { sets.push('completed_at = ?'); args.push(now()); }
  if (b.status === 'verified') {
    if (!can(req, 'maintenance.manage')) return res.status(403).json({ error: 'Not authorised to verify jobs.' });
    sets.push('verified_by = ?', 'verified_at = ?'); args.push(req.user.full_name, now());
    notifyRoles(['super_admin', 'ceo'], { type: 'maintenance', title: `Job ${existing.job_ref} verified`,
      body: existing.title, link: `/maintenance?id=${existing.id}` });
  }
  if (!sets.length) return res.json(existing);
  sets.push('updated_at = ?'); args.push(now(), req.params.id);
  db.prepare(`UPDATE maintenance_jobs SET ${sets.join(', ')} WHERE id = ?`).run(...args);
  if (b.status && existing.complaint_id && ['in_progress', 'completed', 'verified'].includes(b.status)) {
    const label = b.status === 'in_progress' ? 'In progress' : b.status === 'completed' ? 'Work completed (awaiting complaint resolution)' : 'Work verified';
    db.prepare(`
      INSERT INTO complaint_comments (id, complaint_id, author_id, author_name, body, visibility, created_at)
      VALUES (?, ?, ?, ?, ?, 'student_visible', ?)
    `).run(newId(), existing.complaint_id, req.user.id, req.user.full_name, `${existing.job_ref}: ${label}`, now());
  }
  audit({
    userId: req.user.id, userEmail: req.user.email, action: 'maintenance.update',
    entityType: 'maintenance_job', entityId: req.params.id,
    summary: `Updated job ${existing.job_ref}${b.status ? ` → ${b.status}` : ''}`, ip: req.ip,
  });
  res.json(db.prepare('SELECT * FROM maintenance_jobs WHERE id = ?').get(req.params.id));
}));

opsRouter.post('/maintenance/:id/photos', requirePerm('maintenance.manage'), ah(async (req, res) => {
  const job = db.prepare('SELECT * FROM maintenance_jobs WHERE id = ?').get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  if (!req.file) return res.status(400).json({ error: 'No file supplied.' });
  db.prepare('INSERT INTO maintenance_photos (id, job_id, kind, file_name, stored_path, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(newId(), req.params.id, req.body?.kind === 'after' ? 'after' : 'before', req.file.originalname, req.file.filename, now());
  res.status(201).json({ ok: true });
}));

// ============================== CLEANING ===================================

opsRouter.get('/cleaning/schedules', requirePerm('cleaning.view'), ah(async (req, res) => {
  const where = ['1=1']; const args = [];
  const propertyId = String(req.query.property_id || '').trim();
  if (propertyId) { where.push('cs.property_id = ?'); args.push(propertyId); }
  const rows = db.prepare(`
    SELECT cs.*, p.name AS property_name, b.name AS building_name, r.room_number,
      st.full_name AS cleaner_name, sup.full_name AS supervisor_name
    FROM cleaning_schedules cs
    LEFT JOIN properties p ON p.id = cs.property_id
    LEFT JOIN buildings b ON b.id = cs.building_id
    LEFT JOIN rooms r ON r.id = cs.room_id
    LEFT JOIN staff st ON st.id = cs.assigned_to
    LEFT JOIN staff sup ON sup.id = cs.supervisor_id
    WHERE ${where.join(' AND ')} ORDER BY p.name, cs.area_name
  `).all(...args);
  res.json({ data: rows });
}));

opsRouter.post('/cleaning/schedules', requirePerm('cleaning.manage'), ah(async (req, res) => {
  const b = req.body || {};
  if (isBlank(b.property_id) || isBlank(b.area_name)) return res.status(400).json({ error: 'Property and area are required.' });
  const id = newId();
  const t = now();
  db.prepare(`
    INSERT INTO cleaning_schedules (id, property_id, building_id, room_id, area_name, frequency, due_time, assigned_to, supervisor_id, checklist, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
  `).run(id, b.property_id, b.building_id || null, b.room_id || null, b.area_name.trim(),
    b.frequency || 'daily', b.due_time || '09:00', b.assigned_to || null, b.supervisor_id || null,
    JSON.stringify(b.checklist || []), t, t);
  audit({ userId: req.user.id, userEmail: req.user.email, action: 'cleaning.schedule_create',
    entityType: 'cleaning_schedule', entityId: id, summary: `Scheduled cleaning: ${b.area_name} (${b.frequency})`, ip: req.ip });
  res.status(201).json(db.prepare('SELECT * FROM cleaning_schedules WHERE id = ?').get(id));
}));

opsRouter.delete('/cleaning/schedules/:id', requirePerm('cleaning.manage'), ah(async (req, res) => {
  db.prepare('DELETE FROM cleaning_schedules WHERE id = ?').run(req.params.id);
  audit({ userId: req.user.id, userEmail: req.user.email, action: 'cleaning.schedule_delete',
    entityType: 'cleaning_schedule', entityId: req.params.id, summary: 'Deleted cleaning schedule', ip: req.ip });
  res.json({ ok: true });
}));

/** Generate today's tasks from active schedules (idempotent). */
function generateTodayTasks() {
  const date = todayISO();
  const schedules = db.prepare("SELECT * FROM cleaning_schedules WHERE status = 'active'").all();
  const created = [];
  for (const s of schedules) {
    const due = { daily: true, weekly: true, biweekly: true, monthly: true }[s.frequency];
    if (!due) continue;
    const existing = db.prepare('SELECT id FROM cleaning_tasks WHERE schedule_id = ? AND task_date = ?').get(s.id, date);
    if (existing) continue;
    const id = newId();
    db.prepare(`
      INSERT INTO cleaning_tasks (id, schedule_id, property_id, building_id, room_id, area_name, task_date, due_time, cleaner_id, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(id, s.id, s.property_id, s.building_id, s.room_id, s.area_name, date, s.due_time, s.assigned_to, now(), now());
    created.push(id);
  }
  return created;
}

opsRouter.get('/cleaning/tasks', requirePerm('cleaning.view'), ah(async (req, res) => {
  const { q, page, pageSize, offset } = listParams(req);
  generateTodayTasks();
  const where = ['1=1']; const args = [];
  if (q) { where.push("(ct.area_name LIKE ? ESCAPE '\\')"); args.push(likeTerm(q)); }
  // Cleaners with only cleaning.own see their assigned tasks exclusively
  const mine = req.query.mine === 'true' || (req.permissions.includes('cleaning.own') && !req.permissions.includes('cleaning.manage'));
  if (mine && req.user.staff_id) { where.push('ct.cleaner_id = ?'); args.push(req.user.staff_id); }
  for (const [param, col] of [['status', 'ct.status'], ['property_id', 'ct.property_id'], ['date', 'ct.task_date'], ['cleaner_id', 'ct.cleaner_id']]) {
    const v = String(req.query[param] || '').trim();
    if (v) { where.push(`${col} = ?`); args.push(v); }
  }
  const total = db.prepare(`SELECT COUNT(*) AS c FROM cleaning_tasks ct WHERE ${where.join(' AND ')}`).get(...args).c;
  const rows = db.prepare(`
    SELECT ct.*, p.name AS property_name, b.name AS building_name, r.room_number, st.full_name AS cleaner_name,
      sup.full_name AS supervisor_name, cs.checklist
    FROM cleaning_tasks ct
    LEFT JOIN properties p ON p.id = ct.property_id
    LEFT JOIN buildings b ON b.id = ct.building_id
    LEFT JOIN rooms r ON r.id = ct.room_id
    LEFT JOIN staff st ON st.id = ct.cleaner_id
    LEFT JOIN cleaning_schedules cs ON cs.id = ct.schedule_id
    LEFT JOIN staff sup ON sup.id = cs.supervisor_id
    WHERE ${where.join(' AND ')} ORDER BY ct.task_date DESC, ct.due_time LIMIT ? OFFSET ?
  `).all(...args, pageSize, offset);
  res.json(paginated(rows, total, page, pageSize));
}));

opsRouter.post('/cleaning/tasks/:id/complete', requirePerm('cleaning.view'), ah(async (req, res) => {
  const task = db.prepare('SELECT * FROM cleaning_tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Cleaning task not found.' });
  const owns = req.user.staff_id && task.cleaner_id === req.user.staff_id;
  if (!can(req, 'cleaning.manage') && !owns) {
    return res.status(403).json({ error: 'You can only complete your own assigned tasks.' });
  }
  const t = now();
  db.prepare("UPDATE cleaning_tasks SET status = 'completed', completed_at = ?, completed_by = ?, notes = ?, updated_at = ? WHERE id = ?")
    .run(t, req.user.full_name, req.body?.notes || task.notes, t, req.params.id);
  audit({ userId: req.user.id, userEmail: req.user.email, action: 'cleaning.complete',
    entityType: 'cleaning_task', entityId: req.params.id, summary: `Completed cleaning: ${task.area_name}`, ip: req.ip });
  notifyRoles(['super_admin'], { type: 'cleaning', title: 'Cleaning task completed', body: task.area_name, link: '/cleaning' });
  res.json(db.prepare('SELECT * FROM cleaning_tasks WHERE id = ?').get(req.params.id));
}));

opsRouter.post('/cleaning/tasks/:id/inspect', requirePerm('cleaning.manage'), ah(async (req, res) => {
  const task = db.prepare('SELECT * FROM cleaning_tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Cleaning task not found.' });
  const result = req.body?.result === 'fail' ? 'fail' : 'pass';
  const t = now();
  tx(() => {
    db.prepare('INSERT INTO cleaning_inspections (id, task_id, inspector_id, result, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(newId(), req.params.id, req.user.id, result, req.body?.notes || null, t);
    if (result === 'fail') {
      // Failed inspection → re-cleaning task
      db.prepare("UPDATE cleaning_tasks SET status = 'failed_inspection', updated_at = ? WHERE id = ?").run(t, req.params.id);
      const id = newId();
      db.prepare(`
        INSERT INTO cleaning_tasks (id, schedule_id, property_id, building_id, room_id, area_name, task_date, due_time, cleaner_id, status, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
      `).run(id, task.schedule_id, task.property_id, task.building_id, task.room_id, task.area_name,
        todayISO(), task.due_time, task.cleaner_id, 'Re-clean required after failed inspection', t, t);
    } else {
      db.prepare("UPDATE cleaning_tasks SET status = 'completed', updated_at = ? WHERE id = ?").run(t, req.params.id);
    }
  });
  audit({ userId: req.user.id, userEmail: req.user.email, action: 'cleaning.inspect',
    entityType: 'cleaning_task', entityId: req.params.id, summary: `Inspection ${result} for ${task.area_name}`, ip: req.ip });
  res.json({ ok: true, result });
}));

// ================================ TASKS ====================================

opsRouter.get('/tasks', requirePerm('tasks.view'), ah(async (req, res) => {
  const { q, page, pageSize, offset, sort, dir } = listParams(req);
  const where = ['1=1']; const args = [];
  if (q) { where.push("(t.title LIKE ? ESCAPE '\\' OR t.task_ref LIKE ? ESCAPE '\\' OR t.description LIKE ? ESCAPE '\\')"); const t2 = likeTerm(q); args.push(t2, t2, t2); }
  for (const [param, col] of [['status', 't.status'], ['priority', 't.priority'], ['property_id', 't.property_id'],
    ['assigned_to', 't.assigned_to'], ['department', 't.department'], ['due', 't.due_date']]) {
    const v = String(req.query[param] || '').trim();
    if (v) {
      if (param === 'due') { where.push('date(t.due_date) <= date(?) AND t.status NOT IN (?, ?)'); args.push(v, 'done', 'verified'); }
      else { where.push(`${col} = ?`); args.push(v); }
    }
  }
  const sortable = new Set(['title', 'due_date', 'priority', 'status', 'created_at']);
  const orderCol = sortable.has(sort) ? `t.${sort}` : 't.due_date';
  const total = db.prepare(`SELECT COUNT(*) AS c FROM tasks t WHERE ${where.join(' AND ')}`).get(...args).c;
  const rows = db.prepare(`
    SELECT t.*, st.full_name AS assignee_name, p.name AS property_name
    FROM tasks t LEFT JOIN staff st ON st.id = t.assigned_to LEFT JOIN properties p ON p.id = t.property_id
    WHERE ${where.join(' AND ')} ORDER BY ${orderCol} ${dir} LIMIT ? OFFSET ?
  `).all(...args, pageSize, offset);
  res.json(paginated(rows, total, page, pageSize));
}));

opsRouter.post('/tasks', requirePerm('tasks.manage'), ah(async (req, res) => {
  const b = req.body || {};
  if (isBlank(b.title)) return res.status(400).json({ error: 'Task title is required.' });
  const id = newId();
  const ref = nextRef(db, 'FAR-TK');
  const t = now();
  db.prepare(`
    INSERT INTO tasks (id, task_ref, title, description, assigned_to, department, property_id, link_type, link_id,
      due_date, priority, status, recurring, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'todo', ?, ?, ?, ?)
  `).run(id, ref, b.title.trim(), b.description || null, b.assigned_to || null, b.department || null,
    b.property_id || null, b.link_type || null, b.link_id || null, b.due_date || null,
    b.priority || 'normal', b.recurring ? JSON.stringify(b.recurring) : null, req.user.id, t, t);
  if (b.assigned_to) {
    notify({ type: 'task', title: `Task assigned: ${ref}`, body: b.title, link: `/tasks?id=${id}` });
  }
  audit({ userId: req.user.id, userEmail: req.user.email, action: 'task.create',
    entityType: 'task', entityId: id, summary: `Created task ${ref} — ${b.title}`, ip: req.ip });
  res.status(201).json(db.prepare('SELECT * FROM tasks WHERE id = ?').get(id));
}));

opsRouter.patch('/tasks/:id', requirePerm('tasks.manage'), ah(async (req, res) => {
  const existing = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Task not found.' });
  const b = req.body || {};
  const sets = []; const args = [];
  for (const f of ['title', 'description', 'assigned_to', 'department', 'property_id', 'due_date', 'priority', 'status']) {
    if (b[f] !== undefined) { sets.push(`${f} = ?`); args.push(b[f] === '' ? null : b[f]); }
  }
  if (b.status === 'done') { sets.push('completed_at = ?'); args.push(now()); }
  if (b.status === 'verified') { sets.push('verified_by = ?', 'completed_at = ?'); args.push(req.user.full_name, now()); }
  if (!sets.length) return res.json(existing);
  sets.push('updated_at = ?'); args.push(now(), req.params.id);
  db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...args);
  audit({ userId: req.user.id, userEmail: req.user.email, action: 'task.update',
    entityType: 'task', entityId: req.params.id, summary: `Task ${existing.task_ref} ${b.status ? `→ ${b.status}` : 'updated'}`, ip: req.ip });
  res.json(db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id));
}));

opsRouter.delete('/tasks/:id', requirePerm('tasks.manage'), ah(async (req, res) => {
  const existing = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
  audit({ userId: req.user.id, userEmail: req.user.email, action: 'task.delete',
    entityType: 'task', entityId: req.params.id, summary: `Deleted task ${existing?.task_ref || req.params.id}`, ip: req.ip });
  res.json({ ok: true });
}));

// ============================ CALENDAR EVENTS ==============================

opsRouter.get('/events', requirePerm('tasks.view'), ah(async (req, res) => {
  const from = String(req.query.from || '').trim() || todayISO();
  const to = String(req.query.to || '').trim();
  const where = ['date(e.starts_at) >= date(?)']; const args = [from];
  if (to) { where.push('date(e.starts_at) <= date(?)'); args.push(to); }
  const events = db.prepare(`
    SELECT e.*, p.name AS property_name FROM calendar_events e LEFT JOIN properties p ON p.id = e.property_id
    WHERE ${where.join(' AND ')} ORDER BY e.starts_at
  `).all(...args);
  // Derived operational events (check-ins, cleaning due, maintenance due, overdue tasks)
  const checkins = db.prepare(`
    SELECT s.id AS student_id, s.student_ref, s.full_name, s.check_in_date AS d, p.name AS property_name
    FROM students s LEFT JOIN properties p ON p.id = s.property_id
    WHERE s.check_in_date IS NOT NULL AND date(s.check_in_date) >= date(?) ${to ? 'AND date(s.check_in_date) <= date(?)' : ''}
  `).all(...(to ? [from, to] : [from]));
  const derived = checkins.filter((c) => c.d).map((c) => ({
    id: `std-in-${c.student_id}`, title: `Check-in: ${c.full_name} (${c.student_ref})`,
    type: 'checkin', starts_at: `${c.d}T09:00:00.000Z`, all_day: 0,
    property_name: c.property_name, derived: true,
  }));
  const checkouts = db.prepare(`
    SELECT s.id AS student_id, s.student_ref, s.full_name, s.expected_check_out_date AS d, p.name AS property_name
    FROM students s LEFT JOIN properties p ON p.id = s.property_id
    WHERE s.expected_check_out_date IS NOT NULL AND date(s.expected_check_out_date) >= date(?) ${to ? 'AND date(s.expected_check_out_date) <= date(?)' : ''}
  `).all(...(to ? [from, to] : [from]));
  for (const c of checkouts) {
    if (c.d) derived.push({ id: `std-out-${c.student_id}`, title: `Check-out: ${c.full_name} (${c.student_ref})`,
      type: 'checkout', starts_at: `${c.d}T09:00:00.000Z`, all_day: 0, property_name: c.property_name, derived: true });
  }
  const jobs = db.prepare(`
    SELECT m.id, m.job_ref, m.title, m.due_date AS d, p.name AS property_name FROM maintenance_jobs m
    LEFT JOIN properties p ON p.id = m.property_id
    WHERE m.due_date IS NOT NULL AND m.status NOT IN ('verified','cancelled') AND date(m.due_date) >= date(?) ${to ? 'AND date(m.due_date) <= date(?)' : ''}
  `).all(...(to ? [from, to] : [from]));
  for (const j of jobs) {
    if (j.d) derived.push({ id: `mt-${j.id}`, title: `Maintenance due: ${j.title}`, type: 'maintenance',
      starts_at: `${j.d}T09:00:00.000Z`, all_day: 0, property_name: j.property_name, derived: true });
  }
  const cleans = db.prepare(`
    SELECT ct.id, ct.area_name, ct.task_date AS d, p.name AS property_name FROM cleaning_tasks ct
    LEFT JOIN properties p ON p.id = ct.property_id
    WHERE date(ct.task_date) >= date(?) ${to ? 'AND date(ct.task_date) <= date(?)' : ''}
  `).all(...(to ? [from, to] : [from]));
  for (const c of cleans) {
    if (c.d) derived.push({ id: `cl-${c.id}`, title: `Cleaning: ${c.area_name}`, type: 'cleaning',
      starts_at: `${c.d}T07:00:00.000Z`, all_day: 1, property_name: c.property_name, derived: true });
  }
  res.json({ data: [...events, ...derived] });
}));

opsRouter.post('/events', requirePerm('tasks.manage'), ah(async (req, res) => {
  const b = req.body || {};
  if (isBlank(b.title) || isBlank(b.starts_at)) return res.status(400).json({ error: 'Title and start date are required.' });
  const id = newId();
  db.prepare(`
    INSERT INTO calendar_events (id, title, type, starts_at, ends_at, all_day, property_id, description, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, b.title.trim(), b.type || 'other', b.starts_at, b.ends_at || null,
    b.all_day ? 1 : 0, b.property_id || null, b.description || null, req.user.id, now());
  audit({ userId: req.user.id, userEmail: req.user.email, action: 'event.create',
    entityType: 'event', entityId: id, summary: `Created event: ${b.title}`, ip: req.ip });
  res.status(201).json(db.prepare('SELECT * FROM calendar_events WHERE id = ?').get(id));
}));

opsRouter.delete('/events/:id', requirePerm('tasks.manage'), ah(async (req, res) => {
  db.prepare('DELETE FROM calendar_events WHERE id = ?').run(req.params.id);
  audit({ userId: req.user.id, userEmail: req.user.email, action: 'event.delete',
    entityType: 'event', entityId: req.params.id, summary: 'Deleted calendar event', ip: req.ip });
  res.json({ ok: true });
}));

// ============================= ANNOUNCEMENTS ===============================

opsRouter.get('/announcements', requirePerm('announcements.view'), ah(async (req, res) => {
  const { q, page, pageSize, offset } = listParams(req);
  const where = ['1=1']; const args = [];
  if (q) { where.push("(a.title LIKE ? ESCAPE '\\' OR a.body LIKE ? ESCAPE '\\')"); const t = likeTerm(q); args.push(t, t); }
  const status = String(req.query.status || '').trim();
  if (status) { where.push('a.status = ?'); args.push(status); }
  const total = db.prepare(`SELECT COUNT(*) AS c FROM announcements a WHERE ${where.join(' AND ')}`).get(...args).c;
  const rows = db.prepare(`
    SELECT a.*, u.full_name AS author_name FROM announcements a LEFT JOIN users u ON u.id = a.created_by
    WHERE ${where.join(' AND ')} ORDER BY COALESCE(a.published_at, a.created_at) DESC LIMIT ? OFFSET ?
  `).all(...args, pageSize, offset);
  res.json(paginated(rows, total, page, pageSize));
}));

opsRouter.post('/announcements', requirePerm('announcements.manage'), ah(async (req, res) => {
  const b = req.body || {};
  if (isBlank(b.title) || isBlank(b.body)) return res.status(400).json({ error: 'Title and body are required.' });
  const id = newId();
  const t = now();
  const status = b.status === 'published' ? 'published' : 'draft';
  db.prepare(`
    INSERT INTO announcements (id, title, body, audience, priority, status, published_at, expires_at, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, b.title.trim(), b.body, b.audience || 'all', b.priority || 'normal', status,
    status === 'published' ? t : null, b.expires_at || null, req.user.id, t, t);
  if (status === 'published') broadcastAnnouncement(id, b.title, b.audience);
  audit({ userId: req.user.id, userEmail: req.user.email, action: 'announcement.create',
    entityType: 'announcement', entityId: id, summary: `Created announcement: ${b.title}`, ip: req.ip });
  res.status(201).json(db.prepare('SELECT * FROM announcements WHERE id = ?').get(id));
}));

function broadcastAnnouncement(id, title, audience) {
  const payload = { type: 'announcement', title: 'New announcement', body: title, link: `/announcements?id=${id}` };
  if (audience === 'staff' || audience === 'all') notifyRoles(['super_admin', 'ceo', 'receptionist', 'finance', 'maintenance', 'cleaner', 'property_manager', 'auditor'], payload);
}

opsRouter.patch('/announcements/:id', requirePerm('announcements.manage'), ah(async (req, res) => {
  const existing = db.prepare('SELECT * FROM announcements WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Announcement not found.' });
  const b = req.body || {};
  const sets = []; const args = [];
  for (const f of ['title', 'body', 'audience', 'priority', 'status', 'expires_at']) {
    if (b[f] !== undefined) { sets.push(`${f} = ?`); args.push(b[f] === '' ? null : b[f]); }
  }
  if (b.status === 'published' && existing.status !== 'published') { sets.push('published_at = ?'); args.push(now()); }
  if (!sets.length) return res.json(existing);
  sets.push('updated_at = ?'); args.push(now(), req.params.id);
  db.prepare(`UPDATE announcements SET ${sets.join(', ')} WHERE id = ?`).run(...args);
  if (b.status === 'published' && existing.status !== 'published') broadcastAnnouncement(existing.id, existing.title, b.audience || existing.audience);
  audit({ userId: req.user.id, userEmail: req.user.email, action: 'announcement.update',
    entityType: 'announcement', entityId: req.params.id, summary: `Updated announcement: ${existing.title}`, ip: req.ip });
  res.json(db.prepare('SELECT * FROM announcements WHERE id = ?').get(req.params.id));
}));

opsRouter.delete('/announcements/:id', requirePerm('announcements.manage'), ah(async (req, res) => {
  const existing = db.prepare('SELECT * FROM announcements WHERE id = ?').get(req.params.id);
  db.prepare('DELETE FROM announcements WHERE id = ?').run(req.params.id);
  audit({ userId: req.user.id, userEmail: req.user.email, action: 'announcement.delete',
    entityType: 'announcement', entityId: req.params.id, summary: `Deleted announcement: ${existing?.title}`, ip: req.ip });
  res.json({ ok: true });
}));

export { OPEN_STATUSES, generateTodayTasks };
