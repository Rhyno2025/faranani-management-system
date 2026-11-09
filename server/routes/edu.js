// ---------------------------------------------------------------------------
// Students & Applications (Admissions) routes
// ---------------------------------------------------------------------------
import { Router } from 'express';
import { db, newId, nextRef, now, tx, audit } from '../db.js';
import { requirePerm, can } from '../auth.js';
import {
  ah, listParams, paginated, likeTerm, isBlank, num, todayISO,
  notify, notifyRoles, requireFields, CATEGORIES,
} from '../util.js';

export const eduRouter = Router();

const STUDENT_STATUSES = ['registered', 'active', 'checked_out', 'deactivated', 'archived'];
const APP_STATUSES = ['draft', 'submitted', 'under_review', 'info_required', 'approved', 'waitlisted', 'rejected'];

function studentRow(id) {
  return db.prepare('SELECT * FROM students WHERE id = ?').get(id);
}

function studentBalances(studentId) {
  const inv = db.prepare(
    "SELECT COALESCE(SUM(total),0) AS t FROM invoices WHERE student_id = ? AND status != 'void'"
  ).get(studentId).t;
  const paid = db.prepare(
    "SELECT COALESCE(SUM(amount),0) AS t FROM payments WHERE student_id = ? AND status != 'void'"
  ).get(studentId).t;
  return { invoiced: inv, paid, balance: Math.round((inv - paid) * 100) / 100 };
}

// ------------------------------- students ----------------------------------

eduRouter.get('/students', requirePerm('students.view'), ah(async (req, res) => {
  const { q, page, pageSize, offset, sort, dir } = listParams(req);
  const where = ['1=1'];
  const args = [];
  if (q) {
    where.push('(s.full_name LIKE ? ESCAPE \'\\\' OR s.student_ref LIKE ? ESCAPE \'\\\' OR s.email LIKE ? ESCAPE \'\\\' OR s.phone LIKE ? ESCAPE \'\\\' OR s.institution LIKE ? ESCAPE \'\\\')');
    const t = likeTerm(q);
    args.push(t, t, t, t, t);
  }
  const status = String(req.query.status || '').trim();
  if (status) { where.push('s.status = ?'); args.push(status); }
  const propertyId = String(req.query.property_id || '').trim();
  if (propertyId) { where.push('s.property_id = ?'); args.push(propertyId); }
  const archived = String(req.query.archived || '');
  if (archived !== 'true') where.push("s.status != 'archived'");

  const sortable = new Set(['full_name', 'student_ref', 'status', 'created_at', 'check_in_date', 'institution']);
  const orderCol = sortable.has(sort) ? `s.${sort}` : 's.created_at';
  const total = db.prepare(`SELECT COUNT(*) AS c FROM students s WHERE ${where.join(' AND ')}`).get(...args).c;
  const rows = db.prepare(`
    SELECT s.*, p.name AS property_name, r.room_number, b.label AS bed_label, bd.name AS building_name
    FROM students s
    LEFT JOIN properties p ON p.id = s.property_id
    LEFT JOIN rooms r ON r.id = s.room_id
    LEFT JOIN beds b ON b.id = s.bed_id
    LEFT JOIN buildings bd ON bd.id = r.building_id
    WHERE ${where.join(' AND ')}
    ORDER BY ${orderCol} ${dir}
    LIMIT ? OFFSET ?
  `).all(...args, pageSize, offset);
  res.json(paginated(rows, total, page, pageSize));
}));

eduRouter.get('/students/:id', requirePerm('students.view'), ah(async (req, res) => {
  const row = db.prepare(`
    SELECT s.*, p.name AS property_name, r.room_number, b.label AS bed_label, bd.name AS building_name
    FROM students s
    LEFT JOIN properties p ON p.id = s.property_id
    LEFT JOIN rooms r ON r.id = s.room_id
    LEFT JOIN beds b ON b.id = s.bed_id
    LEFT JOIN buildings bd ON bd.id = r.building_id
    WHERE s.id = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Student not found.' });
  const allocations = db.prepare(`
    SELECT a.*, b.label AS bed_label, r.room_number, p.name AS property_name
    FROM bed_allocations a
    JOIN beds b ON b.id = a.bed_id
    JOIN rooms r ON r.id = b.room_id
    JOIN buildings bd ON bd.id = r.building_id
    JOIN properties p ON p.id = bd.property_id
    WHERE a.student_id = ? ORDER BY a.created_at DESC
  `).all(req.params.id);
  const complaints = db.prepare(
    'SELECT id, ticket_ref, subject, category, priority, status, created_at FROM complaints WHERE student_id = ? ORDER BY created_at DESC LIMIT 20'
  ).all(req.params.id);
  const applications = db.prepare(
    'SELECT id, app_ref, status, move_in_date, created_at FROM applications WHERE student_id = ? ORDER BY created_at DESC'
  ).all(req.params.id);
  const documents = db.prepare(
    'SELECT id, doc_ref, doc_type, file_name, mime, size, created_at FROM documents WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC'
  ).all('student', req.params.id);
  const invoices = db.prepare(
    'SELECT id, invoice_ref, issue_date, due_date, total, status FROM invoices WHERE student_id = ? ORDER BY issue_date DESC'
  ).all(req.params.id);
  const payments = db.prepare(
    'SELECT id, payment_ref, amount, method, reference, paid_at, status FROM payments WHERE student_id = ? ORDER BY paid_at DESC'
  ).all(req.params.id);
  res.json({ ...row, balances: studentBalances(req.params.id), allocations, complaints, applications, documents, invoices, payments });
}));

eduRouter.post('/students', requirePerm('students.manage'), ah(async (req, res) => {
  const b = req.body || {};
  requireFields(b, ['full_name']);
  // Duplicate prevention on identity number / email
  if (!isBlank(b.id_number)) {
    const dup = db.prepare('SELECT student_ref, full_name FROM students WHERE id_number = ? AND status != ?').get(String(b.id_number).trim(), 'archived');
    if (dup) return res.status(409).json({ error: `Possible duplicate: ${dup.full_name} (${dup.student_ref}) already uses this ID number.` });
  }
  if (!isBlank(b.email)) {
    const dup = db.prepare('SELECT student_ref, full_name FROM students WHERE lower(email) = lower(?) AND status != ?').get(String(b.email).trim(), 'archived');
    if (dup) return res.status(409).json({ error: `Possible duplicate: ${dup.full_name} (${dup.student_ref}) already uses this email.` });
  }
  const id = newId();
  const ref = nextRef(db, 'FAR-ST');
  const t = now();
  db.prepare(`
    INSERT INTO students (id, student_ref, full_name, email, phone, id_number, institution, course,
      emergency_contact_name, emergency_contact_phone, status, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'registered', ?, ?, ?)
  `).run(id, ref, b.full_name.trim(), b.email?.trim() || null, b.phone || null, b.id_number || null,
    b.institution || null, b.course || null, b.emergency_contact_name || null,
    b.emergency_contact_phone || null, b.notes || null, t, t);
  audit({
    userId: req.user.id, userEmail: req.user.email, action: 'student.create',
    entityType: 'student', entityId: id, summary: `Registered student ${ref} — ${b.full_name}`, ip: req.ip,
  });
  notifyRoles(['super_admin', 'ceo', 'receptionist'], {
    type: 'student', title: 'New student registered',
    body: `${b.full_name} (${ref}) was registered manually.`, link: `/students?id=${id}`,
  });
  res.status(201).json(studentRow(id));
}));

eduRouter.patch('/students/:id', requirePerm('students.manage'), ah(async (req, res) => {
  const existing = studentRow(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Student not found.' });
  const b = req.body || {};
  const fields = ['full_name', 'email', 'phone', 'id_number', 'institution', 'course',
    'emergency_contact_name', 'emergency_contact_phone', 'status', 'notes', 'expected_check_out_date'];
  const sets = [];
  const args = [];
  for (const f of fields) {
    if (b[f] !== undefined) { sets.push(`${f} = ?`); args.push(b[f] === '' ? null : b[f]); }
  }
  if (sets.length === 0) return res.json(existing);
  sets.push('updated_at = ?'); args.push(now()); args.push(req.params.id);
  db.prepare(`UPDATE students SET ${sets.join(', ')} WHERE id = ?`).run(...args);
  audit({
    userId: req.user.id, userEmail: req.user.email, action: 'student.update',
    entityType: 'student', entityId: req.params.id,
    summary: `Updated student ${existing.student_ref}`, details: Object.keys(b), ip: req.ip,
  });
  res.json(studentRow(req.params.id));
}));

eduRouter.post('/students/:id/archive', requirePerm('students.manage'), ah(async (req, res) => {
  const existing = studentRow(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Student not found.' });
  tx(() => {
    db.prepare("UPDATE students SET status = 'archived', archived_at = ?, updated_at = ? WHERE id = ?")
      .run(now(), now(), req.params.id);
    db.prepare("UPDATE bed_allocations SET status = 'completed', check_out_date = COALESCE(check_out_date, ?), updated_at = ? WHERE student_id = ? AND status = 'active'")
      .run(todayISO(), now(), req.params.id);
    const bedId = existing.bed_id;
    if (bedId) {
      db.prepare("UPDATE beds SET status = 'available' WHERE id = ?").run(bedId);
      db.prepare('UPDATE rooms SET status = ? WHERE id = ?').run('available', existing.room_id);
      db.prepare('UPDATE students SET property_id = NULL, room_id = NULL, bed_id = NULL WHERE id = ?').run(req.params.id);
    }
  });
  audit({
    userId: req.user.id, userEmail: req.user.email, action: 'student.archive',
    entityType: 'student', entityId: req.params.id, summary: `Archived student ${existing.student_ref}`, ip: req.ip,
  });
  res.json({ ok: true });
}));

eduRouter.post('/students/:id/restore', requirePerm('students.manage'), ah(async (req, res) => {
  const existing = studentRow(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Student not found.' });
  db.prepare("UPDATE students SET status = 'registered', archived_at = NULL, updated_at = ? WHERE id = ?").run(now(), req.params.id);
  audit({
    userId: req.user.id, userEmail: req.user.email, action: 'student.restore',
    entityType: 'student', entityId: req.params.id, summary: `Restored student ${existing.student_ref}`, ip: req.ip,
  });
  res.json(studentRow(req.params.id));
}));

eduRouter.get('/students/:id/statement', requirePerm('students.view'), ah(async (req, res) => {
  const s = studentRow(req.params.id);
  if (!s) return res.status(404).json({ error: 'Student not found.' });
  if (!can(req, 'finance.view') && !can(req, 'students.financial')) {
    return res.status(403).json({ error: 'You do not have permission to view financial records.' });
  }
  const invoices = db.prepare(`
    SELECT i.*, (SELECT COALESCE(SUM(pa.amount),0) FROM payment_allocations pa WHERE pa.invoice_id = i.id) AS paid
    FROM invoices i WHERE i.student_id = ? AND i.status != 'void' ORDER BY i.issue_date
  `).all(req.params.id);
  const payments = db.prepare(
    "SELECT * FROM payments WHERE student_id = ? AND status != 'void' ORDER BY paid_at"
  ).all(req.params.id);
  const events = [];
  let running = 0;
  for (const i of invoices) {
    running += i.total;
    events.push({ date: i.issue_date, type: 'invoice', ref: i.invoice_ref, description: `Invoice ${i.invoice_ref}`, debit: i.total, credit: 0, balance: Math.round(running * 100) / 100 });
  }
  // Recompute running balance with payments interleaved by date
  running = 0;
  const merged = [
    ...invoices.map((i) => ({ date: i.issue_date, sort: i.issue_date, type: 'invoice', ref: i.invoice_ref, description: `Invoice ${i.invoice_ref}`, debit: i.total, credit: 0 })),
    ...payments.map((p) => ({ date: p.paid_at?.slice(0, 10), sort: p.paid_at, type: 'payment', ref: p.payment_ref, description: `Payment ${p.payment_ref} (${p.method})`, debit: 0, credit: p.amount })),
  ].sort((a, b) => String(a.sort).localeCompare(String(b.sort)));
  for (const e of merged) {
    running += e.debit - e.credit;
    e.balance = Math.round(running * 100) / 100;
    events.push(e);
  }
  res.json({ student: s, events, balances: studentBalances(req.params.id) });
}));

// ----------------------------- applications --------------------------------

eduRouter.get('/applications', requirePerm('applications.view'), ah(async (req, res) => {
  const { q, page, pageSize, offset, sort, dir } = listParams(req);
  const where = ['1=1'];
  const args = [];
  if (q) {
    where.push("(a.app_ref LIKE ? ESCAPE '\\' OR s.full_name LIKE ? ESCAPE '\\' OR s.student_ref LIKE ? ESCAPE '\\' OR s.email LIKE ? ESCAPE '\\')");
    const t = likeTerm(q); args.push(t, t, t, t);
  }
  const status = String(req.query.status || '').trim();
  if (status) { where.push('a.status = ?'); args.push(status); }
  const propertyId = String(req.query.property_id || '').trim();
  if (propertyId) { where.push('a.property_id = ?'); args.push(propertyId); }
  const from = String(req.query.from || '').trim();
  if (from) { where.push('date(a.created_at) >= date(?)'); args.push(from); }
  const to = String(req.query.to || '').trim();
  if (to) { where.push('date(a.created_at) <= date(?)'); args.push(to); }

  const sortable = new Set(['app_ref', 'status', 'created_at', 'move_in_date']);
  const orderCol = sortable.has(sort) ? `a.${sort}` : 'a.created_at';
  const total = db.prepare(`SELECT COUNT(*) AS c FROM applications a JOIN students s ON s.id = a.student_id WHERE ${where.join(' AND ')}`).get(...args).c;
  const rows = db.prepare(`
    SELECT a.*, s.full_name AS student_name, s.student_ref, s.email AS student_email, s.phone AS student_phone,
           s.institution, p.name AS property_name, u.full_name AS reviewer_name
    FROM applications a
    JOIN students s ON s.id = a.student_id
    LEFT JOIN properties p ON p.id = a.property_id
    LEFT JOIN users u ON u.id = a.reviewer_id
    WHERE ${where.join(' AND ')}
    ORDER BY ${orderCol} ${dir}
    LIMIT ? OFFSET ?
  `).all(...args, pageSize, offset);
  // Attach document counts
  const docCounts = db.prepare('SELECT application_id, COUNT(*) AS c FROM application_documents GROUP BY application_id');
  const counts = new Map(docCounts.all().map((r) => [r.application_id, r.c]));
  for (const r of rows) r.document_count = counts.get(r.id) || 0;
  res.json(paginated(rows, total, page, pageSize));
}));

eduRouter.get('/applications/:id', requirePerm('applications.view'), ah(async (req, res) => {
  const row = db.prepare(`
    SELECT a.*, s.full_name AS student_name, s.student_ref, s.email AS student_email, s.phone AS student_phone,
           s.institution, s.course, s.id_number, s.emergency_contact_name, s.emergency_contact_phone,
           p.name AS property_name, u.full_name AS reviewer_name
    FROM applications a
    JOIN students s ON s.id = a.student_id
    LEFT JOIN properties p ON p.id = a.property_id
    LEFT JOIN users u ON u.id = a.reviewer_id
    WHERE a.id = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Application not found.' });
  const documents = db.prepare('SELECT * FROM application_documents WHERE application_id = ? ORDER BY uploaded_at DESC').all(req.params.id);
  const notes = db.prepare('SELECT * FROM application_notes WHERE application_id = ? ORDER BY created_at DESC').all(req.params.id);
  res.json({ ...row, documents, notes });
}));

eduRouter.post('/applications', requirePerm('applications.process'), ah(async (req, res) => {
  const b = req.body || {};
  requireFields(b, ['student_id']);
  const s = studentRow(b.student_id);
  if (!s) return res.status(404).json({ error: 'Student not found.' });
  const id = newId();
  const ref = nextRef(db, 'FAR-APP');
  const t = now();
  const status = b.submit ? 'submitted' : 'draft';
  db.prepare(`
    INSERT INTO applications (id, app_ref, student_id, property_id, room_type_pref, move_in_date,
      duration_months, status, internal_notes, submitted_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, ref, b.student_id, b.property_id || null, b.room_type_pref || null,
    b.move_in_date || null, num(b.duration_months, 12), status,
    b.internal_notes || null, b.submit ? t : null, t, t);
  if (b.submit) {
    notifyRoles(['super_admin', 'receptionist'], {
      type: 'application', title: 'New application submitted',
      body: `${ref} — ${s.full_name} is awaiting review.`, link: `/applications?id=${id}`,
    });
  }
  audit({
    userId: req.user.id, userEmail: req.user.email, action: 'application.create',
    entityType: 'application', entityId: id, summary: `Created application ${ref} for ${s.full_name}`, ip: req.ip,
  });
  res.status(201).json(db.prepare('SELECT * FROM applications WHERE id = ?').get(id));
}));

eduRouter.patch('/applications/:id', requirePerm('applications.process'), ah(async (req, res) => {
  const existing = db.prepare('SELECT * FROM applications WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Application not found.' });
  const b = req.body || {};
  const fields = ['property_id', 'room_type_pref', 'move_in_date', 'duration_months', 'internal_notes', 'reviewer_id'];
  const sets = []; const args = [];
  for (const f of fields) {
    if (b[f] !== undefined) { sets.push(`${f} = ?`); args.push(b[f] === '' ? null : b[f]); }
  }
  if (sets.length === 0) return res.json(existing);
  sets.push('updated_at = ?'); args.push(now()); args.push(req.params.id);
  db.prepare(`UPDATE applications SET ${sets.join(', ')} WHERE id = ?`).run(...args);
  audit({
    userId: req.user.id, userEmail: req.user.email, action: 'application.update',
    entityType: 'application', entityId: req.params.id, summary: `Updated application ${existing.app_ref}`, ip: req.ip,
  });
  res.json(db.prepare('SELECT * FROM applications WHERE id = ?').get(req.params.id));
}));

function transitionApplication(req, res, nextStatus, action, extra = {}) {
  const existing = db.prepare('SELECT * FROM applications WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Application not found.' });
  if (!APP_STATUSES.includes(nextStatus)) return res.status(400).json({ error: 'Invalid status.' });
  const t = now();
  const sets = ['status = ?', 'updated_at = ?'];
  const args = [nextStatus, t];
  if (nextStatus === 'submitted') { sets.push('submitted_at = ?'); args.push(t); }
  if (['approved', 'rejected', 'waitlisted'].includes(nextStatus)) {
    sets.push('decision_at = ?', 'decision_by = ?', 'decision_notes = ?');
    args.push(t, req.user.id, req.body?.decision_notes || null);
  }
  if (nextStatus === 'under_review' && !existing.reviewer_id) {
    sets.push('reviewer_id = ?'); args.push(req.user.id);
  }
  args.push(req.params.id);
  db.prepare(`UPDATE applications SET ${sets.join(', ')} WHERE id = ?`).run(...args);

  const s = db.prepare('SELECT * FROM students WHERE id = ?').get(existing.student_id);
  if (['approved', 'rejected', 'waitlisted', 'info_required'].includes(nextStatus)) {
    const labels = { approved: 'Approved', rejected: 'Rejected', waitlisted: 'Waitlisted', info_required: 'Additional information required' };
    notify({
      studentId: existing.student_id, type: 'application',
      title: `Application ${labels[nextStatus]}`,
      body: `Your application ${existing.app_ref} is now: ${labels[nextStatus]}.`,
      link: '/portal',
    });
  }
  audit({
    userId: req.user.id, userEmail: req.user.email, action,
    entityType: 'application', entityId: req.params.id,
    summary: `Application ${existing.app_ref}: ${existing.status} → ${nextStatus}`, ip: req.ip,
  });
  if (extra.auditOnly !== true) {
    notifyRoles(['super_admin', 'receptionist'], {
      type: 'application', title: 'Application updated',
      body: `${existing.app_ref} — ${s?.full_name || ''} is now ${nextStatus.replace('_', ' ')}.`,
      link: `/applications?id=${existing.id}`,
    });
  }
  res.json(db.prepare('SELECT * FROM applications WHERE id = ?').get(req.params.id));
}

eduRouter.post('/applications/:id/submit', requirePerm('applications.process'), ah(async (req, res) => transitionApplication(req, res, 'submitted', 'application.submit')));
eduRouter.post('/applications/:id/review', requirePerm('applications.process'), ah(async (req, res) => {
  if (req.body?.reviewer_id) {
    db.prepare('UPDATE applications SET reviewer_id = ?, updated_at = ? WHERE id = ?').run(req.body.reviewer_id, now(), req.params.id);
  }
  return transitionApplication(req, res, 'under_review', 'application.review');
}));
eduRouter.post('/applications/:id/request-info', requirePerm('applications.process'), ah(async (req, res) => {
  const notes = req.body?.note || 'Additional information required.';
  const existing = db.prepare('SELECT * FROM applications WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Application not found.' });
  db.prepare(`
    INSERT INTO application_notes (id, application_id, author_id, author_name, body, visibility, created_at)
    VALUES (?, ?, ?, ?, ?, 'internal', ?)
  `).run(newId(), req.params.id, req.user.id, req.user.full_name, `Information requested: ${notes}`, now());
  notify({
    student_id: existing.student_id, studentId: existing.student_id, type: 'application',
    title: 'Additional information required', body: notes, link: '/portal',
  });
  return transitionApplication(req, res, 'info_required', 'application.request_info');
}));
eduRouter.post('/applications/:id/decision', requirePerm('applications.process'), ah(async (req, res) => {
  const decision = String(req.body?.decision || '');
  if (!['approved', 'rejected', 'waitlisted'].includes(decision)) {
    return res.status(400).json({ error: 'Decision must be approved, rejected or waitlisted.' });
  }
  return transitionApplication(req, res, decision, `application.${decision}`);
}));

eduRouter.post('/applications/:id/documents', requirePerm('applications.process'), ah(async (req, res) => {
  const existing = db.prepare('SELECT * FROM applications WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Application not found.' });
  if (!req.file) return res.status(400).json({ error: 'No file supplied.' });
  db.prepare(`
    INSERT INTO application_documents (id, application_id, doc_type, file_name, stored_path, mime, size, uploaded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(newId(), req.params.id, req.body?.doc_type || 'Other', req.file.originalname,
    req.file.filename, req.file.mimetype, req.file.size, now());
  audit({
    userId: req.user.id, userEmail: req.user.email, action: 'application.document_upload',
    entityType: 'application', entityId: req.params.id,
    summary: `Uploaded ${req.file.originalname} to ${existing.app_ref}`, ip: req.ip,
  });
  res.status(201).json({ ok: true });
}));

eduRouter.delete('/applications/:id/documents/:docId', requirePerm('applications.process'), ah(async (req, res) => {
  const doc = db.prepare('SELECT * FROM application_documents WHERE id = ? AND application_id = ?').get(req.params.docId, req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found.' });
  db.prepare('DELETE FROM application_documents WHERE id = ?').run(req.params.docId);
  audit({
    userId: req.user.id, userEmail: req.user.email, action: 'application.document_delete',
    entityType: 'application', entityId: req.params.id, summary: `Removed ${doc.file_name}`, ip: req.ip,
  });
  res.json({ ok: true });
}));

export { CATEGORIES, STUDENT_STATUSES, APP_STATUSES, studentBalances };
