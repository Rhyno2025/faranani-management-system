// ---------------------------------------------------------------------------
// Faranani Property Group — Office Administration API
// Comprehensive property management & student accommodation administration
// ---------------------------------------------------------------------------
import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { db, newId, nextRef, now, audit } from '../db.js';
import { requireAuth, requirePerm } from '../auth.js';
import { ah, listParams, paginated, likeTerm, isBlank, UPLOAD_DIR, ALLOWED_MIME, MAX_UPLOAD_MB, storedFileName } from '../util.js';

export const officeRouter = Router();

officeRouter.use(requireAuth);

// Storage for office documents
const officeUploadDir = path.join(UPLOAD_DIR, 'office');
if (!fs.existsSync(officeUploadDir)) fs.mkdirSync(officeUploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, officeUploadDir),
  filename: (_req, file, cb) => cb(null, storedFileName(file.originalname)),
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype) || file.mimetype === 'application/msword' ||
        file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        file.mimetype === 'application/vnd.ms-excel' ||
        file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file type.'));
    }
  },
});

// Dashboard
officeRouter.get('/office/dashboard', requirePerm('office.dashboard', 'office.view'), ah(async (req, res) => {
  const counts = {
    total_properties: db.prepare("SELECT COUNT(*) c FROM properties WHERE status != 'inactive'").get().c,
    total_buildings: db.prepare("SELECT COUNT(*) c FROM buildings").get().c,
    total_rooms: db.prepare("SELECT COUNT(*) c FROM rooms").get().c,
    total_beds: db.prepare("SELECT COUNT(*) c FROM beds").get().c,
    occupied_beds: db.prepare("SELECT COUNT(*) c FROM beds WHERE status = 'occupied'").get().c,
    available_beds: db.prepare("SELECT COUNT(*) c FROM beds WHERE status IN ('vacant','available')").get().c,
    active_leases: db.prepare("SELECT COUNT(*) c FROM office_leases WHERE status = 'active'").get().c,
    leases_awaiting_renewal: db.prepare("SELECT COUNT(*) c FROM office_leases WHERE status = 'active' AND expiry_date IS NOT NULL AND date(expiry_date) BETWEEN date('now') AND date('now', '+60 days')").get().c,
    expired_leases: db.prepare("SELECT COUNT(*) c FROM office_leases WHERE status = 'expired' OR (status = 'active' AND expiry_date IS NOT NULL AND date(expiry_date) < date('now'))").get().c,
    pending_student_docs: db.prepare("SELECT COUNT(*) c FROM office_student_files WHERE status IN ('pending','incomplete')").get().c,
    pending_tenant_applications: db.prepare("SELECT COUNT(*) c FROM office_tenant_applications WHERE status = 'pending'").get().c,
    outstanding_admin_requests: db.prepare("SELECT COUNT(*) c FROM office_requests WHERE status IN ('open','in_progress')").get().c,
    pending_property_docs: db.prepare("SELECT COUNT(*) c FROM office_property_docs WHERE status IN ('pending','review')").get().c,
    upcoming_inspections: db.prepare("SELECT COUNT(*) c FROM office_inspections WHERE status IN ('scheduled','pending') AND date(scheduled_date) >= date('now') AND date(scheduled_date) <= date('now', '+30 days')").get().c,
    incoming_correspondence: db.prepare("SELECT COUNT(*) c FROM office_correspondence WHERE direction = 'incoming' AND status IN ('received','open')").get().c,
    outgoing_correspondence: db.prepare("SELECT COUNT(*) c FROM office_correspondence WHERE direction = 'outgoing' AND status IN ('draft','pending')").get().c,
    pending_approvals: db.prepare("SELECT COUNT(*) c FROM office_purchase_requests WHERE status = 'pending'").get().c,
    admin_tasks: db.prepare("SELECT COUNT(*) c FROM office_tasks WHERE status IN ('pending','in_progress')").get().c,
    overdue_tasks: db.prepare("SELECT COUNT(*) c FROM office_tasks WHERE status IN ('pending','in_progress') AND due_date IS NOT NULL AND date(due_date) < date('now')").get().c,
    upcoming_meetings: db.prepare("SELECT COUNT(*) c FROM office_meetings WHERE date(meeting_date) >= date('now') AND date(meeting_date) <= date('now', '+7 days')").get().c,
    pending_maintenance_coordination: db.prepare("SELECT COUNT(*) c FROM office_complaints WHERE status IN ('open','referred')").get().c,
    outstanding_supplier_docs: db.prepare("SELECT COUNT(*) c FROM office_suppliers WHERE status = 'active' AND (contract_expiry IS NULL OR date(contract_expiry) < date('now', '+60 days'))").get().c,
  };

  const recent_tasks = db.prepare(`
    SELECT * FROM office_tasks ORDER BY created_at DESC LIMIT 10
  `).all();

  const recent_correspondence = db.prepare(`
    SELECT * FROM office_correspondence ORDER BY created_at DESC LIMIT 10
  `).all();

  const upcoming_inspections = db.prepare(`
    SELECT * FROM office_inspections WHERE status IN ('scheduled','pending') ORDER BY scheduled_date ASC LIMIT 10
  `).all();

  res.json({
    counts,
    recent_tasks,
    recent_correspondence,
    upcoming_inspections,
    generated_at: now(),
  });
}));

// Properties Administration
officeRouter.get('/office/properties', requirePerm('office.properties', 'office.view'), ah(async (req, res) => {
  const { q } = req.query;
  let sql = `
    SELECT p.*, 
      (SELECT COUNT(*) FROM buildings b WHERE b.property_id = p.id) AS building_count,
      (SELECT COUNT(*) FROM rooms r WHERE r.building_id IN (SELECT id FROM buildings WHERE property_id = p.id)) AS room_count
    FROM properties p WHERE 1=1
  `;
  const args = [];
  if (q) {
    sql += ` AND (p.name LIKE ? OR p.property_ref LIKE ? OR p.address LIKE ?)`;
    const t = likeTerm(q);
    args.push(t, t, t);
  }
  sql += ` ORDER BY p.name`;
  const rows = db.prepare(sql).all(...args);
  res.json({ data: rows });
}));

officeRouter.post('/office/property-docs', requirePerm('office.properties'), upload.single('file'), ah(async (req, res) => {
  const b = req.body || {};
  const id = newId();
  const ref = nextRef(db, 'OAD-PDOC');
  db.prepare(`
    INSERT INTO office_property_docs (id, ref, property_id, building_id, category, title, document_type, file_path, file_name, file_mime, expiry_date, status, uploaded_by, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, ref, b.property_id || null, b.building_id || null, b.category || 'general', b.title || (req.file?.originalname || 'Document'),
    b.document_type || null, req.file ? `/uploads/office/${req.file.filename}` : null, req.file?.originalname || null, req.file?.mimetype || null,
    b.expiry_date || null, b.status || 'pending', req.user.id, b.notes || null, now(), now());
  audit({ userId: req.user.id, userEmail: req.user.email, action: 'office.property_doc.upload', entityType: 'office_property_doc', entityId: id, summary: `Uploaded property document ${ref}`, ip: req.ip });
  res.status(201).json(db.prepare('SELECT * FROM office_property_docs WHERE id = ?').get(id));
}));

officeRouter.get('/office/property-docs', requirePerm('office.properties', 'office.view'), ah(async (req, res) => {
  const rows = db.prepare(`SELECT opd.*, p.name as property_name FROM office_property_docs opd LEFT JOIN properties p ON p.id = opd.property_id ORDER BY opd.created_at DESC`).all();
  res.json({ data: rows });
}));

// Student & Tenant Administration
officeRouter.get('/office/student-files', requirePerm('office.students_tenants', 'office.view'), ah(async (req, res) => {
  const rows = db.prepare(`SELECT osf.*, s.first_name, s.last_name, s.student_number FROM office_student_files osf LEFT JOIN students s ON s.id = osf.student_id ORDER BY osf.created_at DESC`).all();
  res.json({ data: rows });
}));

officeRouter.get('/office/tenant-applications', requirePerm('office.students_tenants', 'office.view'), ah(async (req, res) => {
  const rows = db.prepare(`SELECT * FROM office_tenant_applications ORDER BY created_at DESC`).all();
  res.json({ data: rows });
}));

// Lease Administration
officeRouter.get('/office/leases', requirePerm('office.leases', 'office.view'), ah(async (req, res) => {
  const rows = db.prepare(`
    SELECT ol.*, p.name as property_name, s.first_name || ' ' || s.last_name as student_name
    FROM office_leases ol 
    LEFT JOIN properties p ON p.id = ol.property_id 
    LEFT JOIN students s ON s.id = ol.student_id
    ORDER BY ol.expiry_date ASC
  `).all();
  res.json({ data: rows });
}));

officeRouter.post('/office/leases', requirePerm('office.leases'), ah(async (req, res) => {
  const b = req.body || {};
  const id = newId();
  const ref = nextRef(db, 'OAD-LSE');
  db.prepare(`
    INSERT INTO office_leases (id, ref, property_id, building_id, room_id, student_id, tenant_id, lease_type, commencement_date, expiry_date, renewal_date, status, signed_date, agreement_path, notes, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, ref, b.property_id || null, b.building_id || null, b.room_id || null, b.student_id || null, b.tenant_id || null,
    b.lease_type || 'student', b.commencement_date || null, b.expiry_date || null, b.renewal_date || null, b.status || 'draft',
    b.signed_date || null, b.agreement_path || null, b.notes || null, req.user.id, now(), now());
  audit({ userId: req.user.id, userEmail: req.user.email, action: 'office.lease.create', entityType: 'office_lease', entityId: id, summary: `Created lease ${ref}`, ip: req.ip });
  res.status(201).json(db.prepare('SELECT * FROM office_leases WHERE id = ?').get(id));
}));

// Document Management
officeRouter.get('/office/documents', requirePerm('office.documents', 'office.view'), ah(async (req, res) => {
  const { category } = req.query;
  let sql = `SELECT * FROM office_documents WHERE 1=1`;
  const args = [];
  if (category) { sql += ` AND category = ?`; args.push(category); }
  sql += ` ORDER BY created_at DESC`;
  const rows = db.prepare(sql).all(...args);
  res.json({ data: rows });
}));

officeRouter.post('/office/documents/upload', requirePerm('office.documents'), upload.single('file'), ah(async (req, res) => {
  const b = req.body || {};
  const id = newId();
  const ref = nextRef(db, 'OAD-DOC');
  db.prepare(`
    INSERT INTO office_documents (id, ref, category, subcategory, title, file_path, file_name, file_mime, property_id, related_to, expiry_date, permissions, version, status, uploaded_by, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, ref, b.category || 'company', b.subcategory || null, b.title || (req.file?.originalname || 'Document'),
    req.file ? `/uploads/office/${req.file.filename}` : null, req.file?.originalname || null, req.file?.mimetype || null,
    b.property_id || null, b.related_to || null, b.expiry_date || null, b.permissions || 'restricted', b.version || 1,
    b.status || 'active', req.user.id, b.notes || null, now(), now());
  audit({ userId: req.user.id, userEmail: req.user.email, action: 'office.document.upload', entityType: 'office_document', entityId: id, summary: `Uploaded document ${ref}`, ip: req.ip });
  res.status(201).json(db.prepare('SELECT * FROM office_documents WHERE id = ?').get(id));
}));

// Inspections
officeRouter.get('/office/inspections', requirePerm('office.inspections', 'office.view'), ah(async (req, res) => {
  const rows = db.prepare(`SELECT oi.*, p.name as property_name FROM office_inspections oi LEFT JOIN properties p ON p.id = oi.property_id ORDER BY oi.scheduled_date ASC`).all();
  res.json({ data: rows });
}));

officeRouter.post('/office/inspections', requirePerm('office.inspections'), ah(async (req, res) => {
  const b = req.body || {};
  const id = newId();
  const ref = nextRef(db, 'OAD-INS');
  db.prepare(`
    INSERT INTO office_inspections (id, ref, property_id, building_id, room_id, inspection_type, scheduled_date, assigned_to, inspector_id, checklist, findings, corrective_actions, status, completion_date, notes, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, ref, b.property_id || null, b.building_id || null, b.room_id || null, b.inspection_type || 'general',
    b.scheduled_date || null, b.assigned_to || null, b.inspector_id || null, b.checklist ? JSON.stringify(b.checklist) : '[]',
    b.findings || null, b.corrective_actions || null, b.status || 'scheduled', b.completion_date || null, b.notes || null,
    req.user.id, now(), now());
  audit({ userId: req.user.id, userEmail: req.user.email, action: 'office.inspection.create', entityType: 'office_inspection', entityId: id, summary: `Scheduled inspection ${ref}`, ip: req.ip });
  res.status(201).json(db.prepare('SELECT * FROM office_inspections WHERE id = ?').get(id));
}));

// Correspondence
officeRouter.get('/office/correspondence', requirePerm('office.correspondence', 'office.view'), ah(async (req, res) => {
  const rows = db.prepare(`SELECT * FROM office_correspondence ORDER BY created_at DESC`).all();
  res.json({ data: rows });
}));

officeRouter.post('/office/correspondence', requirePerm('office.correspondence'), ah(async (req, res) => {
  const b = req.body || {};
  const id = newId();
  const ref = nextRef(db, 'OAD-COR');
  db.prepare(`
    INSERT INTO office_correspondence (id, ref, direction, sender, recipient, subject, category, correspondence_date, property_id, student_id, tenant_id, responsible_employee, status, follow_up_date, attachments, notes, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, ref, b.direction || 'incoming', b.sender || null, b.recipient || null, b.subject || null,
    b.category || 'general', b.correspondence_date || now(), b.property_id || null, b.student_id || null, b.tenant_id || null,
    b.responsible_employee || req.user.id, b.status || 'received', b.follow_up_date || null, b.attachments ? JSON.stringify(b.attachments) : '[]',
    b.notes || null, req.user.id, now(), now());
  audit({ userId: req.user.id, userEmail: req.user.email, action: 'office.correspondence.create', entityType: 'office_correspondence', entityId: id, summary: `Created correspondence ${ref}`, ip: req.ip });
  res.status(201).json(db.prepare('SELECT * FROM office_correspondence WHERE id = ?').get(id));
}));

// Procurement
officeRouter.get('/office/procurement', requirePerm('office.procurement', 'office.view'), ah(async (req, res) => {
  const rows = db.prepare(`SELECT * FROM office_purchase_requests ORDER BY created_at DESC`).all();
  res.json({ data: rows });
}));

officeRouter.post('/office/procurement', requirePerm('office.procurement'), ah(async (req, res) => {
  const b = req.body || {};
  const id = newId();
  const ref = nextRef(db, 'OAD-PR');
  db.prepare(`
    INSERT INTO office_purchase_requests (id, ref, requester_id, category, item_description, quantity, estimated_cost, supplier_id, property_id, justification, status, approved_by, approved_at, po_number, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, ref, req.user.id, b.category || 'general', b.item_description || null, b.quantity || 1,
    b.estimated_cost || null, b.supplier_id || null, b.property_id || null, b.justification || null,
    b.status || 'pending', null, null, null, b.notes || null, now(), now());
  audit({ userId: req.user.id, userEmail: req.user.email, action: 'office.procurement.create', entityType: 'office_purchase_request', entityId: id, summary: `Created purchase request ${ref}`, ip: req.ip });
  res.status(201).json(db.prepare('SELECT * FROM office_purchase_requests WHERE id = ?').get(id));
}));

officeRouter.post('/office/procurement/:id/approve', requirePerm('office.approve'), ah(async (req, res) => {
  const row = db.prepare('SELECT * FROM office_purchase_requests WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Purchase request not found.' });
  db.prepare("UPDATE office_purchase_requests SET status = 'approved', approved_by = ?, approved_at = ?, updated_at = ? WHERE id = ?")
    .run(req.user.id, now(), now(), req.params.id);
  audit({ userId: req.user.id, userEmail: req.user.email, action: 'office.procurement.approve', entityType: 'office_purchase_request', entityId: row.id, summary: `Approved purchase request ${row.ref}`, ip: req.ip });
  res.json({ ok: true });
}));

// Suppliers
officeRouter.get('/office/suppliers', requirePerm('office.suppliers', 'office.view'), ah(async (req, res) => {
  const rows = db.prepare(`SELECT * FROM office_suppliers ORDER BY name ASC`).all();
  res.json({ data: rows });
}));

officeRouter.post('/office/suppliers', requirePerm('office.suppliers'), ah(async (req, res) => {
  const b = req.body || {};
  const id = newId();
  const ref = nextRef(db, 'OAD-SUP');
  db.prepare(`
    INSERT INTO office_suppliers (id, ref, name, company_reg_no, contact_person, email, phone, address, services_offered, contract_details, contract_commencement, contract_expiry, renewal_date, status, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, ref, b.name || null, b.company_reg_no || null, b.contact_person || null, b.email || null, b.phone || null,
    b.address || null, b.services_offered || null, b.contract_details || null, b.contract_commencement || null,
    b.contract_expiry || null, b.renewal_date || null, b.status || 'active', b.notes || null, now(), now());
  audit({ userId: req.user.id, userEmail: req.user.email, action: 'office.supplier.create', entityType: 'office_supplier', entityId: id, summary: `Created supplier ${ref}`, ip: req.ip });
  res.status(201).json(db.prepare('SELECT * FROM office_suppliers WHERE id = ?').get(id));
}));

// Assets
officeRouter.get('/office/assets', requirePerm('office.assets', 'office.view'), ah(async (req, res) => {
  const rows = db.prepare(`SELECT oa.*, p.name as property_name FROM office_assets oa LEFT JOIN properties p ON p.id = oa.property_id ORDER BY oa.asset_number ASC`).all();
  res.json({ data: rows });
}));

officeRouter.post('/office/assets', requirePerm('office.assets'), ah(async (req, res) => {
  const b = req.body || {};
  const id = newId();
  const ref = nextRef(db, 'OAD-AST');
  db.prepare(`
    INSERT INTO office_assets (id, ref, asset_number, asset_name, category, property_id, building_id, room_id, brand, model, serial_number, purchase_date, supplier_id, purchase_value, condition, status, warranty_details, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, ref, b.asset_number || ref, b.asset_name || null, b.category || null, b.property_id || null, b.building_id || null,
    b.room_id || null, b.brand || null, b.model || null, b.serial_number || null, b.purchase_date || null, b.supplier_id || null,
    b.purchase_value || null, b.condition || 'good', b.status || 'active', b.warranty_details || null, b.notes || null, now(), now());
  audit({ userId: req.user.id, userEmail: req.user.email, action: 'office.asset.create', entityType: 'office_asset', entityId: id, summary: `Registered asset ${ref}`, ip: req.ip });
  res.status(201).json(db.prepare('SELECT * FROM office_assets WHERE id = ?').get(id));
}));

// Tasks
officeRouter.get('/office/tasks', requirePerm('office.tasks', 'office.view'), ah(async (req, res) => {
  const rows = db.prepare(`SELECT * FROM office_tasks ORDER BY due_date ASC, created_at DESC`).all();
  res.json({ data: rows });
}));

officeRouter.post('/office/tasks', requirePerm('office.tasks'), ah(async (req, res) => {
  const b = req.body || {};
  const id = newId();
  const ref = nextRef(db, 'OAD-TASK');
  db.prepare(`
    INSERT INTO office_tasks (id, ref, title, description, assigned_to, assigned_by, related_department, related_property_id, related_student_id, related_tenant_id, priority, start_date, due_date, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, ref, b.title || null, b.description || null, b.assigned_to || null, req.user.id,
    b.related_department || 'Office Administration', b.related_property_id || null, b.related_student_id || null, b.related_tenant_id || null,
    b.priority || 'medium', b.start_date || now(), b.due_date || null, b.status || 'pending', now(), now());
  audit({ userId: req.user.id, userEmail: req.user.email, action: 'office.task.create', entityType: 'office_task', entityId: id, summary: `Created task ${ref}`, ip: req.ip });
  res.status(201).json(db.prepare('SELECT * FROM office_tasks WHERE id = ?').get(id));
}));

// Meetings
officeRouter.get('/office/meetings', requirePerm('office.meetings', 'office.view'), ah(async (req, res) => {
  const rows = db.prepare(`SELECT * FROM office_meetings ORDER BY meeting_date ASC`).all();
  res.json({ data: rows });
}));

officeRouter.post('/office/meetings', requirePerm('office.meetings'), ah(async (req, res) => {
  const b = req.body || {};
  const id = newId();
  const ref = nextRef(db, 'OAD-MTG');
  db.prepare(`
    INSERT INTO office_meetings (id, ref, title, meeting_type, meeting_date, start_time, end_time, location, participants, agenda, minutes, follow_up_actions, status, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, ref, b.title || null, b.meeting_type || 'meeting', b.meeting_date || null, b.start_time || null, b.end_time || null,
    b.location || null, b.participants ? JSON.stringify(b.participants) : '[]', b.agenda || null, b.minutes || null,
    b.follow_up_actions ? JSON.stringify(b.follow_up_actions) : '[]', b.status || 'scheduled', req.user.id, now(), now());
  audit({ userId: req.user.id, userEmail: req.user.email, action: 'office.meeting.create', entityType: 'office_meeting', entityId: id, summary: `Scheduled meeting ${ref}`, ip: req.ip });
  res.status(201).json(db.prepare('SELECT * FROM office_meetings WHERE id = ?').get(id));
}));

// Complaints & Requests
officeRouter.get('/office/complaints', requirePerm('office.complaints', 'office.view'), ah(async (req, res) => {
  const rows = db.prepare(`SELECT oc.*, p.name as property_name FROM office_complaints oc LEFT JOIN properties p ON p.id = oc.property_id ORDER BY oc.created_at DESC`).all();
  res.json({ data: rows });
}));

officeRouter.post('/office/complaints', requirePerm('office.complaints'), ah(async (req, res) => {
  const b = req.body || {};
  const id = newId();
  const ref = nextRef(db, 'OAD-CMP');
  db.prepare(`
    INSERT INTO office_complaints (id, ref, complainant, complainant_type, property_id, building_id, room_id, category, description, priority, assigned_to, status, actions_taken, resolution_details, closure_date, supporting_docs, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, ref, b.complainant || null, b.complainant_type || 'student', b.property_id || null, b.building_id || null, b.room_id || null,
    b.category || 'general', b.description || null, b.priority || 'medium', b.assigned_to || null, b.status || 'open',
    b.actions_taken || null, b.resolution_details || null, b.closure_date || null, b.supporting_docs ? JSON.stringify(b.supporting_docs) : '[]',
    req.user.id, now(), now());
  audit({ userId: req.user.id, userEmail: req.user.email, action: 'office.complaint.create', entityType: 'office_complaint', entityId: id, summary: `Registered complaint ${ref}`, ip: req.ip });
  res.status(201).json(db.prepare('SELECT * FROM office_complaints WHERE id = ?').get(id));
}));

// Compliance
officeRouter.get('/office/compliance', requirePerm('office.compliance', 'office.view'), ah(async (req, res) => {
  const rows = db.prepare(`SELECT oc.*, p.name as property_name FROM office_compliance oc LEFT JOIN properties p ON p.id = oc.property_id ORDER BY oc.expiry_date ASC`).all();
  res.json({ data: rows });
}));

// Reports
officeRouter.get('/office/reports/summary', requirePerm('office.reports', 'office.view'), ah(async (req, res) => {
  const report = {
    properties: db.prepare("SELECT COUNT(*) c FROM properties").get().c,
    leases_expiring_30: db.prepare("SELECT COUNT(*) c FROM office_leases WHERE status = 'active' AND expiry_date IS NOT NULL AND date(expiry_date) BETWEEN date('now') AND date('now', '+30 days')").get().c,
    inspections_pending: db.prepare("SELECT COUNT(*) c FROM office_inspections WHERE status IN ('scheduled','pending')").get().c,
    open_complaints: db.prepare("SELECT COUNT(*) c FROM office_complaints WHERE status IN ('open','referred','in_progress')").get().c,
    pending_pr: db.prepare("SELECT COUNT(*) c FROM office_purchase_requests WHERE status = 'pending'").get().c,
    overdue_tasks: db.prepare("SELECT COUNT(*) c FROM office_tasks WHERE status IN ('pending','in_progress') AND due_date IS NOT NULL AND date(due_date) < date('now')").get().c,
  };
  res.json({ report, generated_at: now() });
}));

export default officeRouter;
