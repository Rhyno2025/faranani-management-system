// ---------------------------------------------------------------------------
// Properties, Buildings, Rooms, Beds & Allocation routes
// Bed availability is ALWAYS derived from valid allocations — never from a
// manually entered label. Overlapping active allocations are prevented inside
// an atomic transaction (plus a partial unique index in the schema).
// ---------------------------------------------------------------------------
import { Router } from 'express';
import { db, newId, nextRef, now, tx, audit } from '../db.js';
import { requirePerm } from '../auth.js';
import { ah, listParams, paginated, likeTerm, isBlank, num, todayISO, notify, notifyRoles } from '../util.js';

export const propsRouter = Router();

const ROOM_TYPES = ['Single', 'Double', 'Twin', 'Shared', 'Studio', 'Family'];

// ------------------------------ properties ---------------------------------

propsRouter.get('/properties', requirePerm('properties.view'), ah(async (req, res) => {
  const { q, page, pageSize, offset } = listParams(req);
  const where = ['1=1']; const args = [];
  if (q) {
    where.push("(p.name LIKE ? ESCAPE '\\' OR p.property_ref LIKE ? ESCAPE '\\' OR p.city LIKE ? ESCAPE '\\')");
    const t = likeTerm(q); args.push(t, t, t);
  }
  const status = String(req.query.status || '').trim();
  if (status) { where.push('p.status = ?'); args.push(status); }
  const total = db.prepare(`SELECT COUNT(*) AS c FROM properties p WHERE ${where.join(' AND ')}`).get(...args).c;
  const rows = db.prepare(`
    SELECT p.*, s.full_name AS manager_name,
      (SELECT COUNT(*) FROM buildings b WHERE b.property_id = p.id) AS building_count,
      (SELECT COUNT(*) FROM rooms r JOIN buildings b ON b.id = r.building_id WHERE b.property_id = p.id) AS room_count,
      (SELECT COUNT(*) FROM beds bd JOIN rooms r ON r.id = bd.room_id JOIN buildings b ON b.id = r.building_id WHERE b.property_id = p.id) AS bed_count
    FROM properties p
    LEFT JOIN staff s ON s.id = p.manager_staff_id
    WHERE ${where.join(' AND ')}
    ORDER BY p.name LIMIT ? OFFSET ?
  `).all(...args, pageSize, offset);
  res.json(paginated(rows, total, page, pageSize));
}));

propsRouter.get('/properties/:id', requirePerm('properties.view'), ah(async (req, res) => {
  const row = db.prepare(`
    SELECT p.*, s.full_name AS manager_name FROM properties p
    LEFT JOIN staff s ON s.id = p.manager_staff_id WHERE p.id = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Property not found.' });
  const buildings = db.prepare(`
    SELECT b.*, (SELECT COUNT(*) FROM rooms r WHERE r.building_id = b.id) AS room_count
    FROM buildings b WHERE b.property_id = ? ORDER BY b.name
  `).all(req.params.id);
  const beds = db.prepare(`
    SELECT bd.status, COUNT(*) AS c FROM beds bd
    JOIN rooms r ON r.id = bd.room_id JOIN buildings b ON b.id = r.building_id
    WHERE b.property_id = ? GROUP BY bd.status
  `).all(req.params.id);
  res.json({ ...row, buildings, bedSummary: beds });
}));

function parseFacilities(f) {
  if (Array.isArray(f)) return f;
  if (typeof f === 'string' && f.trim()) return f.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}

propsRouter.post('/properties', requirePerm('properties.manage'), ah(async (req, res) => {
  const b = req.body || {};
  if (isBlank(b.name)) return res.status(400).json({ error: 'Property name is required.' });
  const id = newId();
  const ref = nextRef(db, 'FAR-PR');
  const t = now();
  db.prepare(`
    INSERT INTO properties (id, property_ref, name, address, city, province, manager_staff_id,
      contact_email, contact_phone, description, facilities, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, ref, b.name.trim(), b.address || null, b.city || null, b.province || null,
    b.manager_staff_id || null, b.contact_email || null, b.contact_phone || null,
    b.description || null, JSON.stringify(parseFacilities(b.facilities)), b.status || 'active', t, t);
  audit({
    userId: req.user.id, userEmail: req.user.email, action: 'property.create',
    entityType: 'property', entityId: id, summary: `Created property ${ref} — ${b.name}`, ip: req.ip,
  });
  res.status(201).json(db.prepare('SELECT * FROM properties WHERE id = ?').get(id));
}));

propsRouter.patch('/properties/:id', requirePerm('properties.manage'), ah(async (req, res) => {
  const existing = db.prepare('SELECT * FROM properties WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Property not found.' });
  const b = req.body || {};
  const map = { name: 'name', address: 'address', city: 'city', province: 'province',
    manager_staff_id: 'manager_staff_id', contact_email: 'contact_email', contact_phone: 'contact_phone',
    description: 'description', status: 'status' };
  const sets = []; const args = [];
  for (const [k, col] of Object.entries(map)) {
    if (b[k] !== undefined) { sets.push(`${col} = ?`); args.push(b[k] === '' ? null : b[k]); }
  }
  if (b.facilities !== undefined) { sets.push('facilities = ?'); args.push(JSON.stringify(parseFacilities(b.facilities))); }
  if (!sets.length) return res.json(existing);
  sets.push('updated_at = ?'); args.push(now(), req.params.id);
  db.prepare(`UPDATE properties SET ${sets.join(', ')} WHERE id = ?`).run(...args);
  audit({
    userId: req.user.id, userEmail: req.user.email, action: 'property.update',
    entityType: 'property', entityId: req.params.id, summary: `Updated property ${existing.property_ref}`, ip: req.ip,
  });
  res.json(db.prepare('SELECT * FROM properties WHERE id = ?').get(req.params.id));
}));

// ------------------------------ buildings ----------------------------------

propsRouter.get('/buildings', requirePerm('properties.view'), ah(async (req, res) => {
  const where = ['1=1']; const args = [];
  const propertyId = String(req.query.property_id || '').trim();
  if (propertyId) { where.push('b.property_id = ?'); args.push(propertyId); }
  const rows = db.prepare(`
    SELECT b.*, p.name AS property_name,
      (SELECT COUNT(*) FROM rooms r WHERE r.building_id = b.id) AS room_count
    FROM buildings b JOIN properties p ON p.id = b.property_id
    WHERE ${where.join(' AND ')} ORDER BY p.name, b.name
  `).all(...args);
  res.json({ data: rows });
}));

propsRouter.post('/buildings', requirePerm('properties.manage'), ah(async (req, res) => {
  const b = req.body || {};
  if (isBlank(b.property_id) || isBlank(b.name)) return res.status(400).json({ error: 'Property and building name are required.' });
  const id = newId();
  const ref = nextRef(db, 'FAR-BD');
  db.prepare(`
    INSERT INTO buildings (id, building_ref, property_id, name, floors, description, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, ref, b.property_id, b.name.trim(), num(b.floors, 1), b.description || null, now());
  audit({
    userId: req.user.id, userEmail: req.user.email, action: 'building.create',
    entityType: 'building', entityId: id, summary: `Created building ${ref} — ${b.name}`, ip: req.ip,
  });
  res.status(201).json(db.prepare('SELECT * FROM buildings WHERE id = ?').get(id));
}));

propsRouter.patch('/buildings/:id', requirePerm('properties.manage'), ah(async (req, res) => {
  const existing = db.prepare('SELECT * FROM buildings WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Building not found.' });
  const b = req.body || {};
  const sets = []; const args = [];
  for (const f of ['name', 'floors', 'description']) {
    if (b[f] !== undefined) { sets.push(`${f} = ?`); args.push(b[f]); }
  }
  if (!sets.length) return res.json(existing);
  args.push(req.params.id);
  db.prepare(`UPDATE buildings SET ${sets.join(', ')} WHERE id = ?`).run(...args);
  audit({
    userId: req.user.id, userEmail: req.user.email, action: 'building.update',
    entityType: 'building', entityId: req.params.id, summary: `Updated building ${existing.building_ref}`, ip: req.ip,
  });
  res.json(db.prepare('SELECT * FROM buildings WHERE id = ?').get(req.params.id));
}));

// -------------------------------- rooms ------------------------------------

propsRouter.get('/rooms', requirePerm('rooms.view'), ah(async (req, res) => {
  const { q, page, pageSize, offset } = listParams(req);
  const where = ['1=1']; const args = [];
  if (q) {
    where.push("(r.room_number LIKE ? ESCAPE '\\' OR r.room_ref LIKE ? ESCAPE '\\' OR b.name LIKE ? ESCAPE '\\')");
    const t = likeTerm(q); args.push(t, t, t);
  }
  const buildingId = String(req.query.building_id || '').trim();
  if (buildingId) { where.push('r.building_id = ?'); args.push(buildingId); }
  const propertyId = String(req.query.property_id || '').trim();
  if (propertyId) { where.push('bd.property_id = ?'); args.push(propertyId); }
  const status = String(req.query.status || '').trim();
  if (status) { where.push('r.status = ?'); args.push(status); }

  const total = db.prepare(`
    SELECT COUNT(*) AS c FROM rooms r JOIN buildings b ON b.id = r.building_id JOIN properties bd ON bd.id = b.property_id
    WHERE ${where.join(' AND ')}
  `).get(...args).c;
  const rows = db.prepare(`
    SELECT r.*, b.name AS building_name, bd.name AS property_name, bd.id AS property_id,
      (SELECT COUNT(*) FROM beds be WHERE be.room_id = r.id) AS bed_total,
      (SELECT COUNT(*) FROM beds be WHERE be.room_id = r.id AND be.status = 'occupied') AS bed_occupied
    FROM rooms r
    JOIN buildings b ON b.id = r.building_id
    JOIN properties bd ON bd.id = b.property_id
    WHERE ${where.join(' AND ')}
    ORDER BY b.name, r.room_number
    LIMIT ? OFFSET ?
  `).all(...args, pageSize, offset);
  res.json(paginated(rows, total, page, pageSize));
}));

propsRouter.get('/rooms/:id', requirePerm('rooms.view'), ah(async (req, res) => {
  const room = db.prepare(`
    SELECT r.*, b.name AS building_name, bd.name AS property_name, bd.id AS property_id
    FROM rooms r JOIN buildings b ON b.id = r.building_id JOIN properties bd ON bd.id = b.property_id
    WHERE r.id = ?
  `).get(req.params.id);
  if (!room) return res.status(404).json({ error: 'Room not found.' });
  const beds = db.prepare(`
    SELECT be.*, s.full_name AS occupant_name, s.student_ref AS occupant_ref, a.check_in_date, a.check_out_date
    FROM beds be
    LEFT JOIN bed_allocations a ON a.bed_id = be.id AND a.status IN ('active','reserved')
    LEFT JOIN students s ON s.id = a.student_id
    WHERE be.room_id = ? ORDER BY be.label
  `).all(req.params.id);
  const complaints = db.prepare(
    "SELECT ticket_ref, subject, priority, status, created_at FROM complaints WHERE room_id = ? ORDER BY created_at DESC LIMIT 10"
  ).all(req.params.id);
  const jobs = db.prepare(
    "SELECT job_ref, title, priority, status, created_at FROM maintenance_jobs WHERE room_id = ? ORDER BY created_at DESC LIMIT 10"
  ).all(req.params.id);
  res.json({ ...room, beds, complaints, maintenance: jobs });
}));

propsRouter.post('/rooms', requirePerm('rooms.manage'), ah(async (req, res) => {
  const b = req.body || {};
  if (isBlank(b.building_id) || isBlank(b.room_number)) return res.status(400).json({ error: 'Building and room number are required.' });
  const capacity = Math.max(1, num(b.capacity, 1));
  const id = newId();
  const ref = nextRef(db, 'FAR-RM');
  const t = now();
  tx(() => {
    db.prepare(`
      INSERT INTO rooms (id, room_ref, building_id, room_number, room_type, capacity, rate, furnishing, facilities, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'available', ?, ?)
    `).run(id, ref, b.building_id, String(b.room_number).trim(), b.room_type || 'Single',
      capacity, num(b.rate, 0), b.furnishing || null,
      JSON.stringify(Array.isArray(b.facilities) ? b.facilities : []), t, t);
    for (let i = 1; i <= capacity; i++) {
      db.prepare('INSERT INTO beds (id, bed_ref, room_id, label, status, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(newId(), nextRef(db, 'FAR-BED'), id, `Bed ${i}`, 'available', t);
    }
  });
  audit({
    userId: req.user.id, userEmail: req.user.email, action: 'room.create',
    entityType: 'room', entityId: id, summary: `Created room ${ref} (${capacity} beds)`, ip: req.ip,
  });
  res.status(201).json(db.prepare('SELECT * FROM rooms WHERE id = ?').get(id));
}));

propsRouter.patch('/rooms/:id', requirePerm('rooms.manage'), ah(async (req, res) => {
  const existing = db.prepare('SELECT * FROM rooms WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Room not found.' });
  const b = req.body || {};
  const sets = []; const args = [];
  for (const f of ['room_number', 'room_type', 'rate', 'furnishing', 'status', 'inspection_status']) {
    if (b[f] !== undefined) { sets.push(`${f} = ?`); args.push(b[f]); }
  }
  if (!sets.length) return res.json(existing);
  sets.push('updated_at = ?'); args.push(now(), req.params.id);
  db.prepare(`UPDATE rooms SET ${sets.join(', ')} WHERE id = ?`).run(...args);
  // Keep bed statuses in sync with a manually set room status
  if (b.status === 'out_of_service' || b.status === 'maintenance') {
    db.prepare("UPDATE beds SET status = 'out_of_service' WHERE room_id = ? AND status = 'available'").run(req.params.id);
  }
  audit({
    userId: req.user.id, userEmail: req.user.email, action: 'room.update',
    entityType: 'room', entityId: req.params.id, summary: `Updated room ${existing.room_ref}`, ip: req.ip,
  });
  res.json(db.prepare('SELECT * FROM rooms WHERE id = ?').get(req.params.id));
}));

// ------------------------- beds & availability -----------------------------

/** Availability derived from allocations — not stored labels. */
function bedStatus(bedId) {
  const active = db.prepare(
    "SELECT COUNT(*) AS c FROM bed_allocations WHERE bed_id = ? AND status IN ('active','reserved')"
  ).get(bedId).c;
  return active > 0 ? 'occupied' : 'available';
}

propsRouter.get('/beds', requirePerm('rooms.view'), ah(async (req, res) => {
  const propertyId = String(req.query.property_id || '').trim();
  const where = ['1=1']; const args = [];
  if (propertyId) { where.push('bd.property_id = ?'); args.push(propertyId); }
  const rows = db.prepare(`
    SELECT be.*, r.room_number, r.room_type, b.name AS building_name, p.name AS property_name,
      (SELECT COUNT(*) FROM bed_allocations a WHERE a.bed_id = be.id AND a.status IN ('active','reserved')) AS occupants
    FROM beds be
    JOIN rooms r ON r.id = be.room_id
    JOIN buildings b ON b.id = r.building_id
    JOIN properties p ON p.id = b.property_id
    WHERE ${where.join(' AND ')} ORDER BY p.name, b.name, r.room_number, be.label
  `).all(...args).map((r) => ({ ...r, live_status: r.occupants > 0 ? 'occupied' : (r.status === 'out_of_service' ? 'out_of_service' : 'available') }));
  res.json({ data: rows });
}));

propsRouter.get('/occupancy', requirePerm('rooms.view'), ah(async (req, res) => {
  const rows = db.prepare(`
    SELECT p.id AS property_id, p.name AS property_name,
      COUNT(be.id) AS total_beds,
      SUM(CASE WHEN EXISTS (
        SELECT 1 FROM bed_allocations a WHERE a.bed_id = be.id AND a.status IN ('active','reserved')
      ) THEN 1 ELSE 0 END) AS occupied_beds
    FROM properties p
    JOIN buildings b ON b.property_id = p.id
    JOIN rooms r ON r.building_id = b.id
    JOIN beds be ON be.room_id = r.id
    WHERE p.status = 'active'
    GROUP BY p.id ORDER BY p.name
  `).all();
  const byBuilding = db.prepare(`
    SELECT b.id AS building_id, b.name AS building_name, p.name AS property_name,
      COUNT(be.id) AS total_beds,
      SUM(CASE WHEN EXISTS (
        SELECT 1 FROM bed_allocations a WHERE a.bed_id = be.id AND a.status IN ('active','reserved')
      ) THEN 1 ELSE 0 END) AS occupied_beds
    FROM properties p JOIN buildings b ON b.property_id = p.id
    JOIN rooms r ON r.building_id = b.id JOIN beds be ON be.room_id = r.id
    WHERE p.status = 'active' GROUP BY b.id ORDER BY p.name, b.name
  `).all();
  const totals = rows.reduce((acc, r) => ({ total: acc.total + r.total_beds, occupied: acc.occupied + r.occupied_beds }), { total: 0, occupied: 0 });
  res.json({
    totals: { ...totals, pct: totals.total ? Math.round((totals.occupied / totals.total) * 100) : 0 },
    byProperty: rows,
    byBuilding,
  });
}));

// ----------------------------- allocations ---------------------------------

propsRouter.post('/allocations', requirePerm('rooms.allocate'), ah(async (req, res) => {
  const b = req.body || {};
  if (isBlank(b.student_id) || isBlank(b.bed_id)) return res.status(400).json({ error: 'Student and bed are required.' });
  const student = db.prepare('SELECT * FROM students WHERE id = ?').get(b.student_id);
  if (!student) return res.status(404).json({ error: 'Student not found.' });
  const bed = db.prepare(`
    SELECT be.*, r.id AS room_id, r.room_number, r.rate, bld.id AS building_id, bld.name AS building_name, p.id AS property_id, p.name AS property_name
    FROM beds be JOIN rooms r ON r.id = be.room_id JOIN buildings bld ON bld.id = r.building_id JOIN properties p ON p.id = bld.property_id
    WHERE be.id = ?
  `).get(b.bed_id);
  if (!bed) return res.status(404).json({ error: 'Bed not found.' });
  const checkIn = b.check_in_date || todayISO();
  const checkOut = b.check_out_date || null;

  // ---- atomic conflict check + allocation ----
  const result = tx(() => {
    const conflict = db.prepare(`
      SELECT a.*, s.full_name AS student_name, s.student_ref
      FROM bed_allocations a JOIN students s ON s.id = a.student_id
      WHERE a.bed_id = ? AND a.status IN ('active','reserved')
        AND date(a.check_in_date) <= date(COALESCE(?, '9999-12-31'))
        AND date(COALESCE(a.check_out_date, '9999-12-31')) >= date(?)
    `).get(b.bed_id, checkOut, checkIn);
    if (conflict) {
      const err = new Error(`Bed already allocated to ${conflict.student_name} (${conflict.student_ref}) for overlapping dates.`);
      err.status = 409;
      throw err;
    }
    const id = newId();
    const ref = nextRef(db, 'FAR-AL');
    const t = now();
    db.prepare(`
      INSERT INTO bed_allocations (id, allocation_ref, student_id, bed_id, application_id, check_in_date, check_out_date, status, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
    `).run(id, ref, b.student_id, b.bed_id, b.application_id || null, checkIn, checkOut, req.user.id, t, t);
    db.prepare("UPDATE beds SET status = 'occupied' WHERE id = ?").run(b.bed_id);
    db.prepare("UPDATE rooms SET status = 'occupied', updated_at = ? WHERE id = ?").run(t, bed.room_id);
    db.prepare(`
      UPDATE students SET property_id = ?, room_id = ?, bed_id = ?, check_in_date = COALESCE(check_in_date, ?),
        expected_check_out_date = COALESCE(?, expected_check_out_date), status = 'active', updated_at = ?
      WHERE id = ?
    `).run(bed.property_id, bed.room_id, b.bed_id, checkIn, checkOut, t, b.student_id);
    if (b.application_id) {
      db.prepare("UPDATE applications SET status = 'approved', decision_at = ?, decision_by = ?, updated_at = ? WHERE id = ?")
        .run(t, req.user.id, t, b.application_id);
    }
    return { id, ref, bed };
  });

  audit({
    userId: req.user.id, userEmail: req.user.email, action: 'allocation.create',
    entityType: 'allocation', entityId: result.id,
    summary: `Allocated ${bed.room_number} / ${bed.label} to ${student.full_name} (${student.student_ref}) from ${checkIn}`, ip: req.ip,
  });
  notify({ studentId: student.id, type: 'allocation', title: 'Bed allocation confirmed',
    body: `You have been allocated ${bed.property_name} — ${bed.building_name}, ${bed.room_number} (${bed.label}). Check-in: ${checkIn}.`,
    link: '/portal' });
  notifyRoles(['super_admin', 'receptionist'], { type: 'allocation', title: 'Bed allocated',
    body: `${student.student_ref} → ${bed.property_name} ${bed.room_number} (${bed.label})`, link: '/rooms' });
  res.status(201).json({ ok: true, id: result.id, allocation_ref: result.ref });
}));

propsRouter.post('/allocations/:id/checkout', requirePerm('rooms.allocate'), ah(async (req, res) => {
  const alloc = db.prepare('SELECT * FROM bed_allocations WHERE id = ?').get(req.params.id);
  if (!alloc) return res.status(404).json({ error: 'Allocation not found.' });
  const date = req.body?.check_out_date || todayISO();
  tx(() => {
    db.prepare("UPDATE bed_allocations SET status = 'completed', check_out_date = ?, updated_at = ? WHERE id = ?")
      .run(date, now(), req.params.id);
    db.prepare("UPDATE beds SET status = 'available' WHERE id = ?").run(alloc.bed_id);
    const bed = db.prepare('SELECT room_id FROM beds WHERE id = ?').get(alloc.bed_id);
    const others = db.prepare(
      "SELECT COUNT(*) AS c FROM bed_allocations WHERE bed_id = ? AND status IN ('active','reserved')"
    ).get(alloc.bed_id).c;
    if (others === 0 && bed) {
      db.prepare("UPDATE rooms SET status = 'available', updated_at = ? WHERE id = ?").run(now(), bed.room_id);
      db.prepare("UPDATE students SET property_id = NULL, room_id = NULL, bed_id = NULL, status = 'checked_out', updated_at = ? WHERE id = ? AND bed_id = ?")
        .run(now(), alloc.student_id, alloc.bed_id);
    }
  });
  audit({
    userId: req.user.id, userEmail: req.user.email, action: 'allocation.checkout',
    entityType: 'allocation', entityId: req.params.id,
    summary: `Checked out allocation ${alloc.allocation_ref} on ${date}`, ip: req.ip,
  });
  res.json({ ok: true });
}));

propsRouter.post('/allocations/:id/transfer', requirePerm('rooms.allocate'), ah(async (req, res) => {
  const alloc = db.prepare('SELECT * FROM bed_allocations WHERE id = ?').get(req.params.id);
  if (!alloc) return res.status(404).json({ error: 'Allocation not found.' });
  const newBedId = req.body?.bed_id;
  const newBed = db.prepare(`
    SELECT be.*, r.id AS room_id, r.room_number, bld.id AS building_id, p.id AS property_id
    FROM beds be JOIN rooms r ON r.id = be.room_id JOIN buildings bld ON bld.id = r.building_id JOIN properties p ON p.id = bld.property_id
    WHERE be.id = ?
  `).get(newBedId);
  if (!newBed) return res.status(404).json({ error: 'Target bed not found.' });
  const date = req.body?.date || todayISO();
  let newRef = null;
  tx(() => {
    // Conflict check on target bed
    const conflict = db.prepare(
      "SELECT COUNT(*) AS c FROM bed_allocations WHERE bed_id = ? AND status IN ('active','reserved') AND id != ?"
    ).get(newBedId, req.params.id).c;
    if (conflict) { const err = new Error('Target bed is already occupied.'); err.status = 409; throw err; }
    db.prepare("UPDATE bed_allocations SET status = 'completed', check_out_date = ?, updated_at = ? WHERE id = ?")
      .run(date, now(), req.params.id);
    db.prepare("UPDATE beds SET status = 'available' WHERE id = ?").run(alloc.bed_id);
    const id = newId();
    const ref = nextRef(db, 'FAR-AL');
    newRef = ref;
    const t = now();
    db.prepare(`
      INSERT INTO bed_allocations (id, allocation_ref, student_id, bed_id, application_id, check_in_date, status, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
    `).run(id, ref, alloc.student_id, newBedId, alloc.application_id, date, req.user.id, t, t);
    db.prepare("UPDATE beds SET status = 'occupied' WHERE id = ?").run(newBedId);
    db.prepare("UPDATE rooms SET status = 'occupied', updated_at = ? WHERE id = ?").run(t, newBed.room_id);
    db.prepare("UPDATE students SET property_id = ?, room_id = ?, bed_id = ?, updated_at = ? WHERE id = ?")
      .run(newBed.property_id, newBed.room_id, newBedId, t, alloc.student_id);
  });
  audit({
    userId: req.user.id, userEmail: req.user.email, action: 'allocation.transfer',
    entityType: 'allocation', entityId: req.params.id,
    summary: `Transferred student ${alloc.student_id} to bed ${newBedId} on ${date}`, ip: req.ip,
  });
  res.json({ ok: true, allocation_ref: newRef });
}));

propsRouter.get('/allocations', requirePerm('rooms.view'), ah(async (req, res) => {
  const status = String(req.query.status || '').trim();
  const where = ['1=1']; const args = [];
  if (status) { where.push('a.status = ?'); args.push(status); }
  const rows = db.prepare(`
    SELECT a.*, s.full_name AS student_name, s.student_ref, be.label AS bed_label, r.room_number,
      b.name AS building_name, p.name AS property_name
    FROM bed_allocations a
    JOIN students s ON s.id = a.student_id
    JOIN beds be ON be.id = a.bed_id
    JOIN rooms r ON r.id = be.room_id
    JOIN buildings b ON b.id = r.building_id
    JOIN properties p ON p.id = b.property_id
    WHERE ${where.join(' AND ')} ORDER BY a.created_at DESC LIMIT 500
  `).all(...args);
  res.json({ data: rows });
}));

export { ROOM_TYPES, bedStatus };
