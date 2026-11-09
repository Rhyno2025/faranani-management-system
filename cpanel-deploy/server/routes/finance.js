// ---------------------------------------------------------------------------
// Finance routes: student accounts (invoices, payments, balances) and company
// finance (income, expenses, suppliers). Balances are always DERIVED from
// linked charges/payments — never directly editable.
// ---------------------------------------------------------------------------
import { Router } from 'express';
import { db, newId, nextRef, now, tx, audit } from '../db.js';
import { requirePerm, can } from '../auth.js';
import { ah, listParams, paginated, likeTerm, isBlank, num, todayISO, notify, notifyRoles } from '../util.js';
import { createDraftJournal, accountByCode } from '../ledger.js';

export const financeRouter = Router();

/** Invoice line category → income account code in the chart of accounts. */
const INCOME_ACCOUNT_BY_CATEGORY = {
  Accommodation: '4010',
  Utilities: '4020',
  Registration: '4030',
  Laundry: '4030',
  Damage: '4030',
  Other: '4030',
};

/** Expense category → expense account code in the chart of accounts. */
export const EXPENSE_ACCOUNT_BY_CATEGORY = {
  'Repairs & Maintenance': '5030',
  'Cleaning Supplies': '5040',
  Utilities: '5050',
  'Salaries & Wages': '5000',
  Security: '5060',
  'Internet & Telecoms': '5070',
  'Property Rates': '5080',
  Insurance: '5090',
  'Office Expenses': '5100',
  Other: '5190',
};

function balanceOf(studentId) {
  const invoiced = db.prepare("SELECT COALESCE(SUM(total),0) AS t FROM invoices WHERE student_id = ? AND status != 'void'").get(studentId).t;
  const paid = db.prepare("SELECT COALESCE(SUM(amount),0) AS t FROM payments WHERE student_id = ? AND status != 'void'").get(studentId).t;
  return {
    invoiced: Math.round(invoiced * 100) / 100,
    paid: Math.round(paid * 100) / 100,
    balance: Math.round((invoiced - paid) * 100) / 100,
  };
}

function refreshInvoiceStatus(invoiceId) {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
  if (!inv || inv.status === 'void' || inv.status === 'draft') return;
  const paid = db.prepare("SELECT COALESCE(SUM(pa.amount),0) AS t FROM payment_allocations pa JOIN payments p ON p.id = pa.payment_id WHERE pa.invoice_id = ? AND p.status != 'void'").get(invoiceId).t;
  let status = 'issued';
  if (paid >= inv.total - 0.005) status = 'paid';
  else if (paid > 0) status = 'partially_paid';
  if (status !== 'paid' && new Date(inv.due_date) < new Date()) status = status === 'issued' ? 'overdue' : status;
  db.prepare('UPDATE invoices SET status = ?, updated_at = ? WHERE id = ?').run(status, now(), invoiceId);
}

// ------------------------------- invoices ----------------------------------

financeRouter.get('/invoices', requirePerm('finance.view'), ah(async (req, res) => {
  const { q, page, pageSize, offset, sort, dir } = listParams(req);
  const where = ['1=1']; const args = [];
  if (q) {
    where.push("(i.invoice_ref LIKE ? ESCAPE '\\' OR s.full_name LIKE ? ESCAPE '\\' OR s.student_ref LIKE ? ESCAPE '\\')");
    const t = likeTerm(q); args.push(t, t, t);
  }
  const status = String(req.query.status || '').trim();
  if (status) { where.push('i.status = ?'); args.push(status); }
  const studentId = String(req.query.student_id || '').trim();
  if (studentId) { where.push('i.student_id = ?'); args.push(studentId); }
  const from = String(req.query.from || '').trim();
  if (from) { where.push('date(i.issue_date) >= date(?)'); args.push(from); }
  const to = String(req.query.to || '').trim();
  if (to) { where.push('date(i.issue_date) <= date(?)'); args.push(to); }
  const sortable = new Set(['invoice_ref', 'issue_date', 'due_date', 'total', 'status']);
  const orderCol = sortable.has(sort) ? `i.${sort}` : 'i.issue_date';
  const total = db.prepare(`SELECT COUNT(*) AS c FROM invoices i JOIN students s ON s.id = i.student_id WHERE ${where.join(' AND ')}`).get(...args).c;
  const rows = db.prepare(`
    SELECT i.*, s.full_name AS student_name, s.student_ref,
      (SELECT COALESCE(SUM(pa.amount),0) FROM payment_allocations pa WHERE pa.invoice_id = i.id) AS paid,
      (i.total - (SELECT COALESCE(SUM(pa.amount),0) FROM payment_allocations pa WHERE pa.invoice_id = i.id)) AS due
    FROM invoices i JOIN students s ON s.id = i.student_id
    WHERE ${where.join(' AND ')} ORDER BY ${orderCol} ${dir} LIMIT ? OFFSET ?
  `).all(...args, pageSize, offset);
  res.json(paginated(rows, total, page, pageSize));
}));

financeRouter.get('/invoices/:id', requirePerm('finance.view'), ah(async (req, res) => {
  const inv = db.prepare(`
    SELECT i.*, s.full_name AS student_name, s.student_ref, s.email AS student_email, s.phone AS student_phone
    FROM invoices i JOIN students s ON s.id = i.student_id WHERE i.id = ?
  `).get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Invoice not found.' });
  const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ?').all(req.params.id);
  const allocs = db.prepare(`
    SELECT pa.*, p.payment_ref, p.method, p.paid_at FROM payment_allocations pa
    JOIN payments p ON p.id = pa.payment_id WHERE pa.invoice_id = ?
  `).all(req.params.id);
  const paid = allocs.reduce((s, a) => s + a.amount, 0);
  res.json({ ...inv, items, allocations: allocs, paid: Math.round(paid * 100) / 100, due: Math.round((inv.total - paid) * 100) / 100 });
}));

financeRouter.post('/invoices', requirePerm('finance.manage'), ah(async (req, res) => {
  const b = req.body || {};
  if (isBlank(b.student_id)) return res.status(400).json({ error: 'Student is required.' });
  const items = Array.isArray(b.items) ? b.items.filter((i) => !isBlank(i.description)) : [];
  if (!items.length) return res.status(400).json({ error: 'At least one invoice line is required.' });
  const id = newId();
  const ref = nextRef(db, 'FAR-INV');
  const t = now();
  let subtotal = 0;
  const normalized = items.map((i) => {
    const qty = num(i.quantity, 1);
    const unit = num(i.unit_price, 0);
    const amount = Math.round(qty * unit * 100) / 100;
    subtotal += amount;
    return { description: i.description, category: i.category || 'Accommodation', quantity: qty, unit_price: unit, amount };
  });
  subtotal = Math.round(subtotal * 100) / 100;
  const total = Math.round((subtotal + num(b.adjustment, 0)) * 100) / 100;
  tx(() => {
    db.prepare(`
      INSERT INTO invoices (id, invoice_ref, student_id, issue_date, due_date, subtotal, total, status, notes, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, ref, b.student_id, b.issue_date || todayISO(), b.due_date || todayISO(),
      subtotal, total, 'issued', b.notes || null, req.user.id, t, t);
    for (const it of normalized) {
      db.prepare(`
        INSERT INTO invoice_items (id, invoice_id, description, category, quantity, unit_price, amount)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(newId(), id, it.description, it.category, it.quantity, it.unit_price, it.amount);
    }
    // Draft ledger entry: Dr Accounts Receivable / Cr Income (grouped by line category)
    const ar = accountByCode('1100');
    if (ar && total > 0) {
      const byAccount = {};
      for (const it of normalized) {
        const code = INCOME_ACCOUNT_BY_CATEGORY[it.category] || '4030';
        byAccount[code] = Math.round((byAccount[code] || 0) + it.amount * 100) / 100;
      }
      const lines = [{ code: '1100', debit: total, credit: 0, memo: `Invoice ${ref}`, party_type: 'student', party_id: b.student_id }];
      for (const [code, amount] of Object.entries(byAccount)) {
        if (amount > 0) lines.push({ code, debit: 0, credit: amount, memo: `Invoice ${ref}` });
      }
      createDraftJournal({
        description: `Rental invoice ${ref} issued`, entryDate: b.issue_date || todayISO(),
        lines, sourceType: 'invoice', sourceId: id, createdBy: req.user.id,
      });
    }
  });
  const s = db.prepare('SELECT * FROM students WHERE id = ?').get(b.student_id);
  notify({ studentId: b.student_id, type: 'invoice', title: `New invoice ${ref}`,
    body: `Total R${total.toFixed(2)} due ${b.due_date || todayISO()}`, link: '/portal' });
  audit({ userId: req.user.id, userEmail: req.user.email, action: 'invoice.create',
    entityType: 'invoice', entityId: id, summary: `Issued ${ref} to ${s?.full_name || b.student_id} — R${total.toFixed(2)}`, ip: req.ip });
  res.status(201).json(db.prepare('SELECT * FROM invoices WHERE id = ?').get(id));
}));

financeRouter.post('/invoices/:id/void', requirePerm('finance.manage'), ah(async (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Invoice not found.' });
  db.prepare("UPDATE invoices SET status = 'void', updated_at = ? WHERE id = ?").run(now(), req.params.id);
  audit({ userId: req.user.id, userEmail: req.user.email, action: 'invoice.void',
    entityType: 'invoice', entityId: req.params.id, summary: `Voided invoice ${inv.invoice_ref}`, ip: req.ip });
  res.json({ ok: true });
}));

// ------------------------------- payments ----------------------------------

financeRouter.get('/payments', requirePerm('finance.view'), ah(async (req, res) => {
  const { q, page, pageSize, offset, sort, dir } = listParams(req);
  const where = ['1=1']; const args = [];
  if (q) {
    where.push("(p.payment_ref LIKE ? ESCAPE '\\' OR s.full_name LIKE ? ESCAPE '\\' OR s.student_ref LIKE ? ESCAPE '\\' OR p.reference LIKE ? ESCAPE '\\')");
    const t = likeTerm(q); args.push(t, t, t, t);
  }
  const studentId = String(req.query.student_id || '').trim();
  if (studentId) { where.push('p.student_id = ?'); args.push(studentId); }
  const method = String(req.query.method || '').trim();
  if (method) { where.push('p.method = ?'); args.push(method); }
  const from = String(req.query.from || '').trim();
  if (from) { where.push('date(p.paid_at) >= date(?)'); args.push(from); }
  const to = String(req.query.to || '').trim();
  if (to) { where.push('date(p.paid_at) <= date(?)'); args.push(to); }
  const sortable = new Set(['payment_ref', 'amount', 'paid_at', 'method']);
  const orderCol = sortable.has(sort) ? `p.${sort}` : 'p.paid_at';
  const total = db.prepare(`SELECT COUNT(*) AS c FROM payments p JOIN students s ON s.id = p.student_id WHERE ${where.join(' AND ')}`).get(...args).c;
  const rows = db.prepare(`
    SELECT p.*, s.full_name AS student_name, s.student_ref, u.full_name AS recorded_by_name
    FROM payments p JOIN students s ON s.id = p.student_id LEFT JOIN users u ON u.id = p.recorded_by
    WHERE ${where.join(' AND ')} ORDER BY ${orderCol} ${dir} LIMIT ? OFFSET ?
  `).all(...args, pageSize, offset);
  res.json(paginated(rows, total, page, pageSize));
}));

/** Record a manual payment and optionally allocate it across invoices (FIFO). */
financeRouter.post('/payments', requirePerm('finance.manage'), ah(async (req, res) => {
  const b = req.body || {};
  if (isBlank(b.student_id) || num(b.amount, 0) <= 0) return res.status(400).json({ error: 'Student and a positive amount are required.' });
  const s = db.prepare('SELECT * FROM students WHERE id = ?').get(b.student_id);
  if (!s) return res.status(404).json({ error: 'Student not found.' });
  const amount = Math.round(num(b.amount, 0) * 100) / 100;
  const id = newId();
  const ref = nextRef(db, 'FAR-PAY');
  const t = now();
  const allocate = b.allocate !== false;
  const invoiceIds = [];

  tx(() => {
    db.prepare(`
      INSERT INTO payments (id, payment_ref, student_id, amount, method, reference, paid_at, recorded_by, status, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, ref, b.student_id, amount, b.method || 'eft', b.reference || null,
      b.paid_at || t, req.user.id, b.reconciled ? 'reconciled' : 'recorded', b.notes || null, t);

    if (allocate) {
      // Idempotent FIFO allocation against outstanding invoices
      const openInvoices = db.prepare(`
        SELECT i.*, (i.total - COALESCE((SELECT SUM(pa.amount) FROM payment_allocations pa WHERE pa.invoice_id = i.id), 0)) AS due
        FROM invoices i WHERE i.student_id = ? AND i.status NOT IN ('void','draft') ORDER BY i.issue_date
      `).all(b.student_id);
      let remaining = amount;
      for (const inv of openInvoices) {
        if (remaining <= 0.005) break;
        const pay = Math.min(remaining, Math.round(inv.due * 100) / 100);
        if (pay <= 0) continue;
        db.prepare('INSERT INTO payment_allocations (id, payment_id, invoice_id, amount, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(newId(), id, inv.id, pay, t);
        refreshInvoiceStatus(inv.id);
        remaining = Math.round((remaining - pay) * 100) / 100;
        invoiceIds.push(inv.id);
      }
    }

    // Draft ledger entry: Dr Bank / Cr Accounts Receivable
    if (amount > 0) {
      const bank = accountByCode('1000');
      if (bank) {
        createDraftJournal({
          description: `Payment ${ref} received from ${s.full_name}`,
          entryDate: String(b.paid_at || t).slice(0, 10),
          lines: [
            { code: '1000', debit: amount, credit: 0, memo: `${(b.method || 'eft').toUpperCase()} ${b.reference || ''}`.trim() },
            { code: '1100', debit: 0, credit: amount, memo: `Payment ${ref} allocated`, party_type: 'student', party_id: b.student_id },
          ],
          sourceType: 'payment', sourceId: id, createdBy: req.user.id,
        });
      }
    }
  });

  const bal = balanceOf(b.student_id);
  if (bal.balance <= 0) {
    notify({ studentId: b.student_id, type: 'payment', title: 'Account settled',
      body: `Your payment of R${amount.toFixed(2)} was recorded. Your balance is now R${Math.max(0, bal.balance).toFixed(2)}.`, link: '/portal' });
  } else {
    notify({ studentId: b.student_id, type: 'payment', title: 'Payment received',
      body: `R${amount.toFixed(2)} recorded. Outstanding balance: R${bal.balance.toFixed(2)}.`, link: '/portal' });
  }
  notifyRoles(['super_admin', 'finance'], { type: 'payment', title: `Payment ${ref} recorded`,
    body: `${s.full_name} (${s.student_ref}) — R${amount.toFixed(2)} via ${(b.method || 'eft').toUpperCase()}`, link: '/finance' });
  audit({ userId: req.user.id, userEmail: req.user.email, action: 'payment.create',
    entityType: 'payment', entityId: id, summary: `Recorded ${ref}: R${amount.toFixed(2)} from ${s.full_name}`, details: { method: b.method, invoiceIds }, ip: req.ip });
  res.status(201).json({ ok: true, payment_ref: ref, balances: bal });
}));

financeRouter.get('/balances', requirePerm('finance.view'), ah(async (req, res) => {
  const rows = db.prepare(`
    SELECT s.id, s.student_ref, s.full_name, s.status, p.name AS property_name,
      COALESCE((SELECT SUM(total) FROM invoices i WHERE i.student_id = s.id AND i.status != 'void'), 0) AS invoiced,
      COALESCE((SELECT SUM(amount) FROM payments pm WHERE pm.student_id = s.id AND pm.status != 'void'), 0) AS paid
    FROM students s LEFT JOIN properties p ON p.id = s.property_id
    WHERE s.status IN ('active','registered')
    ORDER BY s.full_name
  `).all().map((r) => ({ ...r, balance: Math.round((r.invoiced - r.paid) * 100) / 100 }));
  const totalOutstanding = rows.reduce((s, r) => s + Math.max(0, r.balance), 0);
  res.json({ data: rows, total_outstanding: Math.round(totalOutstanding * 100) / 100 });
}));

// ------------------------------ expenses -----------------------------------

financeRouter.get('/expenses', requirePerm('finance.view'), ah(async (req, res) => {
  const { q, page, pageSize, offset, sort, dir } = listParams(req);
  const where = ['1=1']; const args = [];
  if (q) {
    where.push("(e.description LIKE ? ESCAPE '\\' OR e.category LIKE ? ESCAPE '\\' OR e.expense_ref LIKE ? ESCAPE '\\')");
    const t = likeTerm(q); args.push(t, t, t);
  }
  const status = String(req.query.status || '').trim();
  if (status) { where.push('e.status = ?'); args.push(status); }
  const propertyId = String(req.query.property_id || '').trim();
  if (propertyId) { where.push('e.property_id = ?'); args.push(propertyId); }
  const from = String(req.query.from || '').trim();
  if (from) { where.push('date(e.incurred_date) >= date(?)'); args.push(from); }
  const to = String(req.query.to || '').trim();
  if (to) { where.push('date(e.incurred_date) <= date(?)'); args.push(to); }
  const sortable = new Set(['expense_ref', 'incurred_date', 'amount', 'category', 'status']);
  const orderCol = sortable.has(sort) ? `e.${sort}` : 'e.incurred_date';
  const total = db.prepare(`SELECT COUNT(*) AS c FROM expenses e WHERE ${where.join(' AND ')}`).get(...args).c;
  const rows = db.prepare(`
    SELECT e.*, p.name AS property_name, sup.name AS supplier_name, u.full_name AS approver_name
    FROM expenses e LEFT JOIN properties p ON p.id = e.property_id
    LEFT JOIN suppliers sup ON sup.id = e.supplier_id LEFT JOIN users u ON u.id = e.approved_by
    WHERE ${where.join(' AND ')} ORDER BY ${orderCol} ${dir} LIMIT ? OFFSET ?
  `).all(...args, pageSize, offset);
  res.json(paginated(rows, total, page, pageSize));
}));

financeRouter.post('/expenses', requirePerm('finance.manage'), ah(async (req, res) => {
  const b = req.body || {};
  if (isBlank(b.description) || num(b.amount, 0) <= 0) return res.status(400).json({ error: 'Description and a positive amount are required.' });
  const id = newId();
  const ref = nextRef(db, 'FAR-EXP');
  const t = now();
  db.prepare(`
    INSERT INTO expenses (id, expense_ref, property_id, supplier_id, category, description, amount, incurred_date, status, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, ref, b.property_id || null, b.supplier_id || null, b.category || 'Other',
    b.description.trim(), num(b.amount, 0), b.incurred_date || todayISO(),
    b.auto_approve ? 'approved' : 'pending', req.user.id, t, t);
  audit({ userId: req.user.id, userEmail: req.user.email, action: 'expense.create',
    entityType: 'expense', entityId: id, summary: `Recorded expense ${ref}: R${num(b.amount, 0).toFixed(2)} — ${b.description}`, ip: req.ip });
  if (!b.auto_approve) notifyRoles(['super_admin', 'ceo'], { type: 'expense', title: 'Expense awaiting approval',
    body: `${ref} — R${num(b.amount, 0).toFixed(2)}: ${b.description}`, link: '/finance' });
  res.status(201).json(db.prepare('SELECT * FROM expenses WHERE id = ?').get(id));
}));

financeRouter.post('/expenses/:id/approve', requirePerm('finance.manage'), ah(async (req, res) => {
  const e = db.prepare('SELECT * FROM expenses WHERE id = ?').get(req.params.id);
  if (!e) return res.status(404).json({ error: 'Expense not found.' });
  const decision = req.body?.decision === 'reject' ? 'rejected' : 'approved';
  const t = now();
  tx(() => {
    db.prepare('UPDATE expenses SET status = ?, approved_by = ?, approved_at = ?, updated_at = ? WHERE id = ?')
      .run(decision, req.user.id, t, t, e.id);
    // Approval accrues the cost — it is NOT a payment. Dr expense / Cr payable.
    if (decision === 'approved') {
      const accountCode = EXPENSE_ACCOUNT_BY_CATEGORY[e.category] || '5190';
      const creditCode = e.supplier_id ? '2000' : '2150';
      createDraftJournal({
        description: `Expense ${e.expense_ref} approved — ${e.description}`,
        entryDate: String(e.incurred_date).slice(0, 10),
        lines: [
          { code: accountCode, debit: num(e.amount, 0), credit: 0, memo: e.description, property_id: e.property_id || null },
          { code: creditCode, debit: 0, credit: num(e.amount, 0), memo: e.supplier_id ? `Supplier ${e.expense_ref}` : `Accrual ${e.expense_ref}`, party_type: e.supplier_id ? 'supplier' : null, party_id: e.supplier_id || null },
        ],
        sourceType: 'expense', sourceId: e.id, createdBy: req.user.id,
      });
    }
  });
  audit({ userId: req.user.id, userEmail: req.user.email, action: `expense.${decision}`,
    entityType: 'expense', entityId: req.params.id, summary: `${decision === 'approved' ? 'Approved' : 'Rejected'} expense ${e.expense_ref}`, ip: req.ip });
  notifyRoles(['super_admin'], { type: 'expense', title: `Expense ${e.expense_ref} ${decision}`,
    body: e.description, link: '/finance' });
  res.json({ ok: true, status: decision });
}));

financeRouter.post('/expenses/:id/pay', requirePerm('finance.manage'), ah(async (req, res) => {
  const e = db.prepare('SELECT * FROM expenses WHERE id = ?').get(req.params.id);
  if (!e) return res.status(404).json({ error: 'Expense not found.' });
  if (e.status !== 'approved') return res.status(409).json({ error: 'Only approved expenses can be marked as paid.' });
  const t = now();
  tx(() => {
    db.prepare("UPDATE expenses SET status = 'paid', updated_at = ? WHERE id = ?").run(t, e.id);
    // Settlement: Dr payable / Cr bank
    const creditCode = e.supplier_id ? '2000' : '2150';
    createDraftJournal({
      description: `Expense ${e.expense_ref} paid`, entryDate: todayISO(),
      lines: [
        { code: creditCode, debit: num(e.amount, 0), credit: 0, memo: `Settled ${e.expense_ref}` },
        { code: '1000', debit: 0, credit: num(e.amount, 0), memo: e.description },
      ],
      sourceType: 'expense_payment', sourceId: e.id, createdBy: req.user.id,
    });
  });
  audit({ userId: req.user.id, userEmail: req.user.email, action: 'expense.paid',
    entityType: 'expense', entityId: req.params.id, summary: `Marked expense ${e.expense_ref} as paid`, ip: req.ip });
  res.json({ ok: true });
}));

// ------------------------------ suppliers ----------------------------------

financeRouter.get('/suppliers', requirePerm('finance.view'), ah(async (req, res) => {
  const { q, page, pageSize, offset } = listParams(req);
  const where = ['1=1']; const args = [];
  if (q) { where.push("(name LIKE ? ESCAPE '\\' OR category LIKE ? ESCAPE '\\')"); const t = likeTerm(q); args.push(t, t); }
  const total = db.prepare(`SELECT COUNT(*) AS c FROM suppliers WHERE ${where.join(' AND ')}`).get(...args).c;
  const rows = db.prepare(`SELECT * FROM suppliers WHERE ${where.join(' AND ')} ORDER BY name LIMIT ? OFFSET ?`).all(...args, pageSize, offset);
  res.json(paginated(rows, total, page, pageSize));
}));

financeRouter.post('/suppliers', requirePerm('finance.manage'), ah(async (req, res) => {
  const b = req.body || {};
  if (isBlank(b.name)) return res.status(400).json({ error: 'Supplier name is required.' });
  const id = newId();
  const ref = nextRef(db, 'FAR-SUP');
  db.prepare(`
    INSERT INTO suppliers (id, supplier_ref, name, contact_person, email, phone, category, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)
  `).run(id, ref, b.name.trim(), b.contact_person || null, b.email || null, b.phone || null, b.category || null, now());
  audit({ userId: req.user.id, userEmail: req.user.email, action: 'supplier.create',
    entityType: 'supplier', entityId: id, summary: `Added supplier ${ref} — ${b.name}`, ip: req.ip });
  res.status(201).json(db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id));
}));

financeRouter.patch('/suppliers/:id', requirePerm('finance.manage'), ah(async (req, res) => {
  const existing = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Supplier not found.' });
  const b = req.body || {};
  const sets = []; const args = [];
  for (const f of ['name', 'contact_person', 'email', 'phone', 'category', 'status']) {
    if (b[f] !== undefined) { sets.push(`${f} = ?`); args.push(b[f] === '' ? null : b[f]); }
  }
  if (!sets.length) return res.json(existing);
  args.push(req.params.id);
  db.prepare(`UPDATE suppliers SET ${sets.join(', ')} WHERE id = ?`).run(...args);
  res.json(db.prepare('SELECT * FROM suppliers WHERE id = ?').get(req.params.id));
}));

export { balanceOf };
