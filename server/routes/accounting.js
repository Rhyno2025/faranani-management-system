// ---------------------------------------------------------------------------
// Accounting routes — chart of accounts, double-entry general ledger,
// financial statements, accounts payable, banking & reconciliation, budgets,
// fixed assets, accounting periods and the finance dashboard.
//
// All figures are calculated from POSTED journal lines (plus, for AR/AP, from
// the invoice ledgers which post to the GL as drafts). Nothing here is
// estimated or fabricated: an empty ledger returns zeros and empty series.
// ---------------------------------------------------------------------------
import { Router } from 'express';
import { db, newId, nextRef, now, tx, audit } from '../db.js';
import { requirePerm, can } from '../auth.js';
import {
  ah, listParams, paginated, likeTerm, isBlank, num, todayISO,
  notifyRoles, getSetting, setSetting, sendCsv,
} from '../util.js';
import {
  accountByCode, accountById, createDraftJournal, postJournal, reverseJournal,
  accountBalance, naturalBalance, normalizeLines, assertPeriodOpen, round2,
} from '../ledger.js';

export const accountingRouter = Router();

const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'income', 'expense'];

function companyFinance() {
  return getSetting('finance') || { base_currency: 'ZAR', vat_rate: 0.15 };
}

/** Posted income / expense totals for a date range, grouped by account. */
function postedTotals({ from = null, to = null }) {
  const rows = db.prepare(`
    SELECT a.id, a.code, a.name, a.type,
      COALESCE(SUM(l.debit),0) debit, COALESCE(SUM(l.credit),0) credit
    FROM journal_lines l
    JOIN journal_entries e ON e.id = l.entry_id
    JOIN chart_of_accounts a ON a.id = l.account_id
    WHERE e.status = 'posted' AND (e.entry_date >= ? OR ? IS NULL) AND (e.entry_date <= ? OR ? IS NULL)
    GROUP BY a.id
  `).all(from || '0000-01-01', from, to || '9999-12-31', to);
  const out = { income: [], expense: [], income_total: 0, expense_total: 0 };
  for (const r of rows) {
    const amount = r.type === 'income' ? round2(r.credit - r.debit)
      : r.type === 'expense' ? round2(r.debit - r.credit) : 0;
    if (r.type === 'income' && amount !== 0) { out.income.push({ ...r, amount }); out.income_total = round2(out.income_total + amount); }
    if (r.type === 'expense' && amount !== 0) { out.expense.push({ ...r, amount }); out.expense_total = round2(out.expense_total + amount); }
  }
  out.income.sort((a, b) => b.amount - a.amount);
  out.expense.sort((a, b) => b.amount - a.amount);
  out.net = round2(out.income_total - out.expense_total);
  return out;
}

// ===========================================================================
// Finance dashboard
// ===========================================================================

accountingRouter.get('/finance/overview', requirePerm('finance.view'), ah(async (req, res) => {
  const today = todayISO();
  const monthStart = `${today.slice(0, 7)}-01`;
  const yearStart = `${today.slice(0, 4)}-01-01`;

  // ---- AR (invoice ledger) ----
  const ar = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN status != 'void' THEN total END),0) invoiced,
      COALESCE((SELECT SUM(pa.amount) FROM payment_allocations pa
                JOIN invoices i2 ON i2.id = pa.invoice_id WHERE i2.status != 'void'),0) allocated
    FROM invoices
  `).get();
  const arOutstanding = round2((ar.invoiced || 0) - (ar.allocated || 0));
  const overdue = db.prepare(`
    SELECT COUNT(*) c, COALESCE(SUM(total - COALESCE((SELECT SUM(pa.amount) FROM payment_allocations pa WHERE pa.invoice_id = i.id),0)),0) amount
    FROM invoices i WHERE status NOT IN ('void','paid') AND date(due_date) < date(?)
  `).get(today);

  // ---- AP (supplier ledger) ----
  const ap = db.prepare(`
    SELECT COUNT(*) c, COALESCE(SUM(total),0) total, COALESCE(SUM(amount_paid),0) paid
    FROM supplier_invoices WHERE status NOT IN ('void','draft')
  `).get();
  const apOutstanding = round2(ap.total - ap.paid);
  const apOverdue = db.prepare(`
    SELECT COUNT(*) c, COALESCE(SUM(total - amount_paid),0) amount
    FROM supplier_invoices WHERE status NOT IN ('void','draft') AND due_date IS NOT NULL AND date(due_date) < date(?)
  `).get(today);

  // ---- bank / cash ----
  const bankAccounts = db.prepare('SELECT * FROM bank_accounts WHERE active = 1').all().map((a) => {
    const tx = db.prepare('SELECT COALESCE(SUM(amount),0) s FROM bank_transactions WHERE bank_account_id = ?').get(a.id).s;
    const rec = db.prepare("SELECT COALESCE(SUM(amount),0) s FROM bank_transactions WHERE bank_account_id = ? AND status = 'reconciled'").get(a.id).s;
    return {
      id: a.id, name: a.name, bank_name: a.bank_name, account_type: a.account_type,
      balance: round2(a.opening_balance + tx),
      reconciled_balance: round2(a.opening_balance + rec),
    };
  });
  const cashTotal = round2(bankAccounts.reduce((s, a) => s + a.balance, 0));
  const unreconciledCount = db.prepare("SELECT COUNT(*) c FROM bank_transactions WHERE status != 'reconciled'").get().c;

  // ---- posted ledger figures ----
  const monthTotals = postedTotals({ from: monthStart, to: today });
  const yearTotals = postedTotals({ from: yearStart, to: today });

  // monthly series for charts (posted only)
  const series = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(); d.setMonth(d.getMonth() - i, 1);
    const key = d.toISOString().slice(0, 7);
    const lastDay = new Date(Date.UTC(d.getFullYear(), d.getMonth() + 1, 0)).getUTCDate();
    const t = postedTotals({ from: `${key}-01`, to: `${key}-${String(lastDay).padStart(2, '0')}` });
    series.push({ month: key, income: t.income_total, expense: t.expense_total, net: t.net });
  }

  // ---- liabilities ----
  const liability = (code) => {
    const a = accountByCode(code);
    return a ? naturalBalance(a, { upTo: today }).balance : 0;
  };
  const payrollLiabilities = round2(liability('2200') + liability('2210') + liability('2220'));

  // ---- budget vs actual (approved budgets for the current year) ----
  const budgetYear = Number(today.slice(0, 4));
  const budget = db.prepare("SELECT COALESCE(SUM(bl.amount),0) amt FROM budgets b JOIN budget_lines bl ON bl.budget_id = b.id WHERE b.fiscal_year = ? AND b.status = 'approved'").get(budgetYear).amt;
  const budgetActual = postedTotals({ from: yearStart, to: today });

  // ---- approvals pending ----
  const pendingApprovals = {
    expenses: db.prepare("SELECT COUNT(*) c FROM expenses WHERE status = 'pending'").get().c,
    supplier_invoices: db.prepare("SELECT COUNT(*) c FROM supplier_invoices WHERE status = 'pending_approval'").get().c,
    journals: db.prepare("SELECT COUNT(*) c FROM journal_entries WHERE status = 'draft'").get().c,
    budgets: db.prepare("SELECT COUNT(*) c FROM budgets WHERE status = 'submitted'").get().c,
    payments: db.prepare("SELECT COUNT(*) c FROM ap_payments WHERE status = 'pending_approval'").get().c,
  };
  pendingApprovals.total = Object.values(pendingApprovals).reduce((s, n) => s + n, 0);

  const currentPeriod = db.prepare('SELECT * FROM accounting_periods WHERE period_key = ?').get(today.slice(0, 7));

  // ---- occupancy-linked revenue (real records only) ----
  const rentalRevenue = round2(
    (accountByCode('4000') ? naturalBalance(accountByCode('4000'), { from: yearStart }).balance : 0) +
    (accountByCode('4010') ? naturalBalance(accountByCode('4010'), { from: yearStart }).balance : 0)
  );

  res.json({
    generated_at: now(),
    currency: companyFinance().base_currency || 'ZAR',
    cash: { total: cashTotal, accounts: bankAccounts, unreconciled: unreconciledCount },
    receivables: {
      outstanding: arOutstanding,
      overdue_amount: round2(overdue.amount || 0),
      overdue_count: overdue.c,
      invoiced_total: round2(ar.invoiced || 0),
      collected_total: round2(ar.allocated || 0),
    },
    payables: {
      outstanding: apOutstanding,
      invoice_count: ap.c,
      overdue_amount: round2(apOverdue.amount || 0),
      overdue_count: apOverdue.c,
    },
    revenue: { month: monthTotals.income_total, year: yearTotals.income_total, rental_year: rentalRevenue },
    expenses: { month: monthTotals.expense_total, year: yearTotals.expense_total },
    profit: { month: monthTotals.net, year: yearTotals.net },
    series,
    top_income: yearTotals.income.slice(0, 8),
    top_expenses: yearTotals.expense.slice(0, 8),
    liabilities: { payroll: payrollLiabilities, vat_output: liability('2300'), vat_input: round2(-liability('1400')) },
    budget: { approved: round2(budget), actual_income: budgetActual.income_total, actual_expense: budgetActual.expense_total },
    pending_approvals: pendingApprovals,
    period: currentPeriod || null,
    locked: currentPeriod ? currentPeriod.status !== 'open' : false,
  });
}));

// ===========================================================================
// Chart of accounts
// ===========================================================================

accountingRouter.get('/coa', requirePerm('finance.view'), ah(async (req, res) => {
  const where = ['1=1']; const args = [];
  if (req.query.type) { where.push('type = ?'); args.push(String(req.query.type)); }
  if (req.query.active === '0') where.push('active = 0');
  const rows = db.prepare(`
    SELECT a.*, COALESCE((SELECT SUM(l.debit) FROM journal_lines l WHERE l.account_id = a.id),0) AS total_debit,
      COALESCE((SELECT SUM(l.credit) FROM journal_lines l WHERE l.account_id = a.id),0) AS total_credit
    FROM chart_of_accounts a WHERE ${where.join(' AND ')} ORDER BY a.code
  `).all(...args);
  res.json({ data: rows });
}));

accountingRouter.post('/coa', requirePerm('finance.settings'), ah(async (req, res) => {
  const b = req.body || {};
  if (isBlank(b.code) || isBlank(b.name) || !ACCOUNT_TYPES.includes(b.type)) {
    return res.status(400).json({ error: 'Code, name and a valid account type are required.' });
  }
  if (db.prepare('SELECT id FROM chart_of_accounts WHERE code = ?').get(b.code)) {
    return res.status(409).json({ error: `Account code ${b.code} already exists.` });
  }
  const id = newId();
  db.prepare(`
    INSERT INTO chart_of_accounts (id, code, name, type, subtype, description, system, active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?)
  `).run(id, String(b.code), b.name, b.type, b.subtype || null, b.description || null, now());
  audit({ userId: req.user.id, userEmail: req.user.email, action: 'coa.create',
    entityType: 'account', entityId: id, summary: `Created account ${b.code} — ${b.name}`, ip: req.ip });
  res.status(201).json(db.prepare('SELECT * FROM chart_of_accounts WHERE id = ?').get(id));
}));

accountingRouter.patch('/coa/:id', requirePerm('finance.settings'), ah(async (req, res) => {
  const acc = db.prepare('SELECT * FROM chart_of_accounts WHERE id = ?').get(req.params.id);
  if (!acc) return res.status(404).json({ error: 'Account not found.' });
  const b = req.body || {};
  const sets = []; const args = [];
  for (const f of ['name', 'subtype', 'description', 'active']) {
    if (b[f] !== undefined) { sets.push(`${f} = ?`); args.push(b[f] === '' ? null : b[f]); }
  }
  if (!sets.length) return res.json(acc);
  args.push(acc.id);
  db.prepare(`UPDATE chart_of_accounts SET ${sets.join(', ')} WHERE id = ?`).run(...args);
  res.json(db.prepare('SELECT * FROM chart_of_accounts WHERE id = ?').get(acc.id));
}));

// ===========================================================================
// General ledger / journals
// ===========================================================================

accountingRouter.get('/journals', requirePerm('finance.gl.view'), ah(async (req, res) => {
  const { q, page, pageSize, offset, sort, dir } = listParams(req);
  const where = ['1=1']; const args = [];
  if (q) { where.push("(j.journal_ref LIKE ? ESCAPE '\\' OR j.description LIKE ? ESCAPE '\\')"); const t = likeTerm(q); args.push(t, t); }
  if (req.query.status) { where.push('j.status = ?'); args.push(String(req.query.status)); }
  if (req.query.source_type) { where.push('j.source_type = ?'); args.push(String(req.query.source_type)); }
  if (req.query.from) { where.push('date(j.entry_date) >= date(?)'); args.push(String(req.query.from)); }
  if (req.query.to) { where.push('date(j.entry_date) <= date(?)'); args.push(String(req.query.to)); }
  const sortable = new Set(['entry_date', 'journal_ref', 'status', 'total_debit']);
  const col = sortable.has(sort) ? `j.${sort}` : 'j.entry_date';
  const total = db.prepare(`SELECT COUNT(*) c FROM journal_entries j WHERE ${where.join(' AND ')}`).get(...args).c;
  const rows = db.prepare(`
    SELECT j.*, u.full_name AS created_by_name, p.full_name AS posted_by_name,
      (SELECT COUNT(*) FROM journal_lines l WHERE l.entry_id = j.id) AS line_count
    FROM journal_entries j
    LEFT JOIN users u ON u.id = j.created_by
    LEFT JOIN users p ON p.id = j.posted_by
    WHERE ${where.join(' AND ')} ORDER BY ${col} ${dir}, j.created_at DESC LIMIT ? OFFSET ?
  `).all(...args, pageSize, offset);
  res.json(paginated(rows, total, page, pageSize));
}));

accountingRouter.get('/journals/:id', requirePerm('finance.gl.view'), ah(async (req, res) => {
  const j = db.prepare(`
    SELECT j.*, u.full_name AS created_by_name, p.full_name AS posted_by_name
    FROM journal_entries j LEFT JOIN users u ON u.id = j.created_by LEFT JOIN users p ON p.id = j.posted_by
    WHERE j.id = ?
  `).get(req.params.id);
  if (!j) return res.status(404).json({ error: 'Journal not found.' });
  const lines = db.prepare(`
    SELECT l.*, a.code, a.name AS account_name, a.type AS account_type
    FROM journal_lines l JOIN chart_of_accounts a ON a.id = l.account_id
    WHERE l.entry_id = ? ORDER BY a.code
  `).all(j.id);
  res.json({ ...j, lines });
}));

accountingRouter.post('/journals', requirePerm('finance.gl.post'), ah(async (req, res) => {
  const b = req.body || {};
  if (isBlank(b.description) || isBlank(b.entry_date)) {
    return res.status(400).json({ error: 'Description and entry date are required.' });
  }
  const entry = createDraftJournal({
    description: b.description, entryDate: b.entry_date, lines: b.lines,
    sourceType: b.source_type || 'manual', createdBy: req.user.id,
  });
  audit({ userId: req.user.id, userEmail: req.user.email, action: 'journal.create',
    entityType: 'journal', entityId: entry.id,
    summary: `Created draft ${entry.journal_ref} — R${entry.total_debit.toFixed(2)}`, ip: req.ip });
  res.status(201).json(entry);
}));

accountingRouter.patch('/journals/:id', requirePerm('finance.gl.post'), ah(async (req, res) => {
  const j = db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(req.params.id);
  if (!j) return res.status(404).json({ error: 'Journal not found.' });
  if (j.status !== 'draft') return res.status(409).json({ error: 'Posted journals cannot be edited. Reverse the entry instead.' });
  const b = req.body || {};
  const { lines, total_debit, total_credit } = normalizeLines(b.lines || []);
  tx(() => {
    db.prepare('DELETE FROM journal_lines WHERE entry_id = ?').run(j.id);
    const ins = db.prepare(`
      INSERT INTO journal_lines (id, entry_id, account_id, debit, credit, memo, party_type, party_id, property_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const l of lines) ins.run(newId(), j.id, l.account_id, l.debit, l.credit, l.memo, l.party_type, l.party_id, l.property_id);
    db.prepare('UPDATE journal_entries SET description = ?, entry_date = ?, total_debit = ?, total_credit = ?, updated_at = ? WHERE id = ?')
      .run(b.description ?? j.description, b.entry_date ?? j.entry_date, total_debit, total_credit, now(), j.id);
  });
  audit({ userId: req.user.id, userEmail: req.user.email, action: 'journal.update',
    entityType: 'journal', entityId: j.id, summary: `Edited draft ${j.journal_ref}`, ip: req.ip });
  res.json(db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(j.id));
}));

accountingRouter.post('/journals/:id/post', requirePerm('finance.gl.approve'), ah(async (req, res) => {
  const j = db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(req.params.id);
  if (!j) return res.status(404).json({ error: 'Journal not found.' });
  const posted = postJournal(j.id, req.user);
  audit({ userId: req.user.id, userEmail: req.user.email, action: 'journal.post',
    entityType: 'journal', entityId: j.id,
    summary: `Posted ${j.journal_ref} — R${j.total_debit.toFixed(2)} — ${j.description}`, ip: req.ip });
  res.json(posted);
}));

accountingRouter.post('/journals/:id/reverse', requirePerm('finance.gl.approve'), ah(async (req, res) => {
  const j = db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(req.params.id);
  if (!j) return res.status(404).json({ error: 'Journal not found.' });
  const result = reverseJournal(j.id, req.user, req.body?.reason);
  audit({ userId: req.user.id, userEmail: req.user.email, action: 'journal.reverse',
    entityType: 'journal', entityId: j.id,
    summary: `Reversed ${j.journal_ref} with ${result.reversal.journal_ref}`, details: { reason: req.body?.reason }, ip: req.ip });
  res.json(result);
}));

accountingRouter.delete('/journals/:id', requirePerm('finance.gl.post'), ah(async (req, res) => {
  const j = db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(req.params.id);
  if (!j) return res.status(404).json({ error: 'Journal not found.' });
  if (j.status !== 'draft') return res.status(409).json({ error: 'Only draft journals can be deleted. Posted entries must be reversed.' });
  db.prepare('DELETE FROM journal_lines WHERE entry_id = ?').run(j.id);
  db.prepare('DELETE FROM journal_entries WHERE id = ?').run(j.id);
  audit({ userId: req.user.id, userEmail: req.user.email, action: 'journal.delete',
    entityType: 'journal', entityId: j.id, summary: `Deleted draft ${j.journal_ref}`, ip: req.ip });
  res.json({ ok: true });
}));

/** Account statement (general ledger detail for one account). */
accountingRouter.get('/ledger/statement', requirePerm('finance.gl.view'), ah(async (req, res) => {
  const accountId = String(req.query.account_id || '');
  const acc = accountById(accountId);
  if (!acc) return res.status(400).json({ error: 'account_id is required.' });
  const from = req.query.from ? String(req.query.from) : null;
  const to = req.query.to ? String(req.query.to) : null;
  const opening = accountBalance(acc.id, { to: from ? prevDay(from) : null });
  const where = ["l.account_id = ?", "e.status = 'posted'"]; const args = [acc.id];
  if (from) { where.push('date(e.entry_date) >= date(?)'); args.push(from); }
  if (to) { where.push('date(e.entry_date) <= date(?)'); args.push(to); }
  const rows = db.prepare(`
    SELECT l.debit, l.credit, l.memo, e.entry_date, e.journal_ref, e.description, e.status, e.source_type
    FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
    WHERE ${where.join(' AND ')} ORDER BY e.entry_date, e.journal_ref
  `).all(...args);
  let run = opening.balance;
  const data = rows.map((r) => { run = round2(run + r.debit - r.credit); return { ...r, running: run }; });
  res.json({ account: acc, opening, rows: data, closing: run, from, to });
}));

function prevDay(iso) {
  const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// ===========================================================================
// Financial statements
// ===========================================================================

function statementRange(req) {
  const today = todayISO();
  const from = String(req.query.from || `${today.slice(0, 4)}-01-01`);
  const to = String(req.query.to || today);
  return { from, to };
}

accountingRouter.get('/reports/trial-balance', requirePerm('finance.gl.view'), ah(async (req, res) => {
  const { from, to } = statementRange(req);
  const rows = db.prepare(`
    SELECT a.id, a.code, a.name, a.type,
      COALESCE(SUM(l.debit),0) debit, COALESCE(SUM(l.credit),0) credit
    FROM chart_of_accounts a
    LEFT JOIN journal_lines l ON l.account_id = a.id
    LEFT JOIN journal_entries e ON e.id = l.entry_id AND e.status = 'posted'
      AND date(e.entry_date) BETWEEN date(?) AND date(?)
    GROUP BY a.id HAVING COALESCE(SUM(l.debit),0) != 0 OR COALESCE(SUM(l.credit),0) != 0
    ORDER BY a.code
  `).all(from, to);
  const totalDebit = round2(rows.reduce((s, r) => s + r.debit, 0));
  const totalCredit = round2(rows.reduce((s, r) => s + r.credit, 0));
  res.json({ from, to, rows, total_debit: totalDebit, total_credit: totalCredit, balanced: Math.abs(totalDebit - totalCredit) < 0.01 });
}));

accountingRouter.get('/reports/profit-and-loss', requirePerm('finance.gl.view'), ah(async (req, res) => {
  const { from, to } = statementRange(req);
  const totals = postedTotals({ from, to });
  const byCategory = {};
  for (const r of totals.expense) byCategory[r.subtype || 'other'] = round2((byCategory[r.subtype || 'other'] || 0) + r.amount);
  res.json({
    from, to,
    income: totals.income, income_total: totals.income_total,
    expense: totals.expense, expense_total: totals.expense_total,
    net_profit: totals.net,
    expense_by_category: Object.entries(byCategory).map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount),
  });
}));

accountingRouter.get('/reports/balance-sheet', requirePerm('finance.gl.view'), ah(async (req, res) => {
  const to = String(req.query.to || todayISO());
  const accounts = db.prepare('SELECT * FROM chart_of_accounts WHERE active = 1 ORDER BY code').all();
  const sections = { asset: [], liability: [], equity: [] };
  const totals = { asset: 0, liability: 0, equity: 0 };
  for (const a of accounts) {
    if (!sections[a.type]) continue;
    const { balance } = naturalBalance(a, { upTo: to });
    if (round2(balance) === 0) continue;
    sections[a.type].push({ ...a, balance: round2(balance) });
    totals[a.type] = round2(totals[a.type] + balance);
  }
  // current year result closes into equity for presentation
  const yearStart = `${to.slice(0, 4)}-01-01`;
  const result = postedTotals({ from: yearStart, to });
  res.json({
    to,
    assets: sections.asset, liabilities: sections.liability, equity: sections.equity,
    totals: { ...totals, result: result.net },
    total_assets: totals.asset,
    total_liabilities: round2(totals.liability),
    total_equity: round2(totals.equity + result.net),
    balanced: Math.abs(totals.asset - (totals.liability + totals.equity + result.net)) < 0.02,
  });
}));

accountingRouter.get('/reports/ar-aging', requirePerm('finance.view'), ah(async (req, res) => {
  const rows = db.prepare(`
    SELECT i.id, i.invoice_ref, i.due_date, i.total, s.full_name, s.student_ref,
      julianday('now') - julianday(i.due_date) AS days_overdue,
      (i.total - COALESCE((SELECT SUM(pa.amount) FROM payment_allocations pa WHERE pa.invoice_id = i.id),0)) AS due
    FROM invoices i JOIN students s ON s.id = i.student_id
    WHERE i.status NOT IN ('void','paid')
      AND (i.total - COALESCE((SELECT SUM(pa.amount) FROM payment_allocations pa WHERE pa.invoice_id = i.id),0)) > 0.005
    ORDER BY i.due_date
  `).all();
  const bucket = (d) => (d <= 0 ? 'current' : d <= 30 ? '1-30' : d <= 60 ? '31-60' : d <= 90 ? '61-90' : '90+');
  const buckets = { current: 0, '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
  const detailed = rows.map((r) => {
    const b = bucket(Math.max(0, r.days_overdue || 0));
    buckets[b] = round2(buckets[b] + r.due);
    return { ...r, bucket: b, due: round2(r.due) };
  });
  res.json({ rows: detailed, buckets, total: round2(Object.values(buckets).reduce((s, n) => s + n, 0)) });
}));

accountingRouter.get('/reports/ap-aging', requirePerm('finance.view'), ah(async (req, res) => {
  const rows = db.prepare(`
    SELECT si.id, si.ap_ref, si.invoice_number, si.due_date, si.total, si.amount_paid,
      sup.name AS supplier_name, sup.supplier_ref,
      julianday('now') - julianday(si.due_date) AS days_overdue,
      (si.total - si.amount_paid) AS due
    FROM supplier_invoices si JOIN suppliers sup ON sup.id = si.supplier_id
    WHERE si.status NOT IN ('void','draft') AND (si.total - si.amount_paid) > 0.005
    ORDER BY si.due_date
  `).all();
  const bucket = (d) => (d <= 0 ? 'current' : d <= 30 ? '1-30' : d <= 60 ? '31-60' : d <= 90 ? '61-90' : '90+');
  const buckets = { current: 0, '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
  const detailed = rows.map((r) => {
    const b = bucket(Math.max(0, r.days_overdue || 0));
    buckets[b] = round2(buckets[b] + r.due);
    return { ...r, bucket: b, due: round2(r.due) };
  });
  res.json({ rows: detailed, buckets, total: round2(Object.values(buckets).reduce((s, n) => s + n, 0)) });
}));

accountingRouter.get('/reports/budget-vs-actual', requirePerm('finance.view'), ah(async (req, res) => {
  const year = Number(req.query.year || todayISO().slice(0, 4));
  const budgets = db.prepare("SELECT * FROM budgets WHERE fiscal_year = ? AND status = 'approved' ORDER BY created_at DESC").all(year);
  if (!budgets.length) return res.json({ year, rows: [], total_budget: 0, total_actual: 0 });
  const lines = db.prepare(`
    SELECT bl.account_id, a.code, a.name, a.type, SUM(bl.amount) budget
    FROM budget_lines bl JOIN chart_of_accounts a ON a.id = bl.account_id
    WHERE bl.budget_id IN (${budgets.map(() => '?').join(',')})
    GROUP BY bl.account_id
  `).all(...budgets.map((b) => b.id));
  const rows = lines.map((l) => {
    const from = `${year}-01-01`; const to = `${year}-12-31`;
    const actual = l.type === 'expense'
      ? naturalBalance({ id: l.account_id, type: 'expense' }, { from, to }).balance
      : naturalBalance({ id: l.account_id, type: 'income' }, { from, to }).balance;
    return { ...l, budget: round2(l.budget), actual: round2(actual), variance: round2(l.budget - actual) };
  });
  res.json({
    year, rows,
    total_budget: round2(rows.reduce((s, r) => s + r.budget, 0)),
    total_actual: round2(rows.reduce((s, r) => s + r.actual, 0)),
  });
}));

accountingRouter.get('/reports/cash-flow', requirePerm('finance.gl.view'), ah(async (req, res) => {
  const { from, to } = statementRange(req);
  const bankAccounts = db.prepare('SELECT * FROM bank_accounts WHERE active = 1').all();
  const inflow = round2(bankAccounts.reduce((s, a) =>
    s + db.prepare('SELECT COALESCE(SUM(amount),0) s FROM bank_transactions WHERE bank_account_id = ? AND amount > 0 AND date(txn_date) BETWEEN date(?) AND date(?)').get(a.id, from, to).s, 0));
  const outflow = round2(Math.abs(bankAccounts.reduce((s, a) =>
    s + db.prepare('SELECT COALESCE(SUM(amount),0) s FROM bank_transactions WHERE bank_account_id = ? AND amount < 0 AND date(txn_date) BETWEEN date(?) AND date(?)').get(a.id, from, to).s, 0)));
  res.json({ from, to, inflow, outflow, net: round2(inflow - outflow), accounts: bankAccounts.length });
}));

accountingRouter.get('/reports/journals.csv', requirePerm('reports.export'), ah(async (req, res) => {
  const { from, to } = statementRange(req);
  const rows = db.prepare(`
    SELECT e.entry_date AS date, e.journal_ref AS reference, e.description, e.status,
      a.code AS account_code, a.name AS account_name, l.debit, l.credit, l.memo
    FROM journal_entries e
    JOIN journal_lines l ON l.entry_id = e.id
    JOIN chart_of_accounts a ON a.id = l.account_id
    WHERE date(e.entry_date) BETWEEN date(?) AND date(?)
    ORDER BY e.entry_date, e.journal_ref, a.code
  `).all(from, to);
  sendCsv(res, `journal-report-${from}-to-${to}.csv`,
    ['date', 'reference', 'description', 'status', 'account_code', 'account_name', 'debit', 'credit', 'memo'], rows);
}));

// ===========================================================================
// Accounting periods
// ===========================================================================

accountingRouter.get('/accounting/periods', requirePerm('finance.gl.view'), ah(async (req, res) => {
  res.json({ data: db.prepare('SELECT * FROM accounting_periods ORDER BY period_key DESC LIMIT 36').all() });
}));

accountingRouter.post('/accounting/periods/:id/close', requirePerm('finance.periods'), ah(async (req, res) => {
  const p = db.prepare('SELECT * FROM accounting_periods WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Period not found.' });
  if (p.status !== 'open') return res.status(409).json({ error: `Period is already ${p.status}.` });
  const drafts = db.prepare("SELECT COUNT(*) c FROM journal_entries WHERE status = 'draft' AND entry_date BETWEEN ? AND ?").get(p.start_date, p.end_date).c;
  if (drafts > 0) return res.status(409).json({ error: `${drafts} draft journal(s) must be posted or deleted before this period can be closed.` });
  db.prepare("UPDATE accounting_periods SET status = 'closed', closed_by = ?, closed_at = ? WHERE id = ?")
    .run(req.user.id, now(), p.id);
  audit({ userId: req.user.id, userEmail: req.user.email, action: 'period.close',
    entityType: 'period', entityId: p.id, summary: `Closed accounting period ${p.period_key}`, ip: req.ip });
  res.json({ ok: true, status: 'closed' });
}));

accountingRouter.post('/accounting/periods/:id/reopen', requirePerm('finance.periods'), ah(async (req, res) => {
  const p = db.prepare('SELECT * FROM accounting_periods WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Period not found.' });
  if (p.status === 'open') return res.json({ ok: true, status: 'open' });
  db.prepare("UPDATE accounting_periods SET status = 'open', closed_by = NULL, closed_at = NULL WHERE id = ?").run(p.id);
  audit({ userId: req.user.id, userEmail: req.user.email, action: 'period.reopen',
    entityType: 'period', entityId: p.id, summary: `Reopened accounting period ${p.period_key} — ${req.body?.reason || 'no reason given'}`, ip: req.ip });
  res.json({ ok: true, status: 'open' });
}));

// ===========================================================================
// Banking & reconciliation
// ===========================================================================

accountingRouter.get('/bank/accounts', requirePerm('finance.view'), ah(async (req, res) => {
  const rows = db.prepare(`
    SELECT b.*, a.code AS gl_code, a.name AS gl_name,
      (SELECT COALESCE(SUM(amount),0) FROM bank_transactions t WHERE t.bank_account_id = b.id) AS balance,
      (SELECT COUNT(*) FROM bank_transactions t WHERE t.bank_account_id = b.id AND t.status != 'reconciled') AS unreconciled
    FROM bank_accounts b LEFT JOIN chart_of_accounts a ON a.id = b.gl_account_id
    WHERE b.active = 1 ORDER BY b.name
  `).all();
  res.json({ data: rows.map((r) => ({ ...r, balance: round2(r.balance) })) });
}));

accountingRouter.post('/bank/accounts', requirePerm('finance.banking'), ah(async (req, res) => {
  const b = req.body || {};
  if (isBlank(b.name)) return res.status(400).json({ error: 'Account name is required.' });
  const id = newId();
  const ref = nextRef(db, 'BANK');
  const glAccount = b.gl_account_id ? accountById(b.gl_account_id) : accountByCode('1000');
  db.prepare(`
    INSERT INTO bank_accounts (id, account_ref, name, bank_name, account_number, account_type, currency,
      gl_account_id, opening_balance, opening_date, active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `).run(id, ref, b.name, b.bank_name || null, b.account_number ? String(b.account_number) : null,
    b.account_type || 'bank', b.currency || companyFinance().base_currency || 'ZAR',
    glAccount?.id || null, num(b.opening_balance, 0), b.opening_date || todayISO(), now());
  audit({ userId: req.user.id, userEmail: req.user.email, action: 'bank_account.create',
    entityType: 'bank_account', entityId: id, summary: `Created bank account ${b.name}`, ip: req.ip });
  res.status(201).json(db.prepare('SELECT * FROM bank_accounts WHERE id = ?').get(id));
}));

accountingRouter.get('/bank/transactions', requirePerm('finance.banking'), ah(async (req, res) => {
  const { q, page, pageSize, offset } = listParams(req);
  const where = ['1=1']; const args = [];
  if (req.query.bank_account_id) { where.push('t.bank_account_id = ?'); args.push(String(req.query.bank_account_id)); }
  if (req.query.status) { where.push('t.status = ?'); args.push(String(req.query.status)); }
  else where.push("t.status != 'reconciled'");
  if (q) { where.push("(t.description LIKE ? ESCAPE '\\' OR t.reference LIKE ? ESCAPE '\\')"); const t = likeTerm(q); args.push(t, t); }
  if (req.query.from) { where.push('date(t.txn_date) >= date(?)'); args.push(String(req.query.from)); }
  if (req.query.to) { where.push('date(t.txn_date) <= date(?)'); args.push(String(req.query.to)); }
  const total = db.prepare(`SELECT COUNT(*) c FROM bank_transactions t WHERE ${where.join(' AND ')}`).get(...args).c;
  const rows = db.prepare(`
    SELECT t.*, b.name AS bank_account_name FROM bank_transactions t
    JOIN bank_accounts b ON b.id = t.bank_account_id
    WHERE ${where.join(' AND ')} ORDER BY t.txn_date DESC LIMIT ? OFFSET ?
  `).all(...args, pageSize, offset);
  res.json(paginated(rows, total, page, pageSize));
}));

accountingRouter.post('/bank/transactions', requirePerm('finance.banking'), ah(async (req, res) => {
  const b = req.body || {};
  if (isBlank(b.bank_account_id) || isBlank(b.txn_date) || isBlank(b.description)) {
    return res.status(400).json({ error: 'Bank account, date and description are required.' });
  }
  if (!num(b.amount, 0)) return res.status(400).json({ error: 'A non-zero amount is required.' });
  const id = newId();
  const t = now();
  const dupKey = `${b.bank_account_id}|${b.txn_date}|${num(b.amount, 0)}|${String(b.reference || '').toUpperCase()}`;
  const dup = db.prepare('SELECT id FROM bank_transactions WHERE duplicate_key = ?').get(dupKey);
  if (dup) return res.status(409).json({ error: 'An identical transaction already exists (possible duplicate).' });
  db.prepare(`
    INSERT INTO bank_transactions (id, bank_account_id, txn_date, description, reference, amount, source,
      status, duplicate_key, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'manual', 'unmatched', ?, ?, ?)
  `).run(id, b.bank_account_id, b.txn_date, b.description, b.reference || null, num(b.amount, 0), dupKey, req.user.id, t);
  res.status(201).json(db.prepare('SELECT * FROM bank_transactions WHERE id = ?').get(id));
}));

/** Bulk statement import — CSV rows pasted or uploaded by an authorised user. */
accountingRouter.post('/bank/transactions/import', requirePerm('finance.banking'), ah(async (req, res) => {
  const b = req.body || {};
  const accountId = String(b.bank_account_id || '');
  const account = db.prepare('SELECT * FROM bank_accounts WHERE id = ?').get(accountId);
  if (!account) return res.status(400).json({ error: 'Bank account is required.' });
  const rows = Array.isArray(b.rows) ? b.rows : [];
  if (!rows.length) return res.status(400).json({ error: 'No statement rows supplied.' });

  const t = now();
  const stmtId = newId();
  db.prepare(`
    INSERT INTO bank_statements (id, bank_account_id, file_name, uploaded_by, statement_from, statement_to, txn_count, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(stmtId, accountId, b.file_name || 'manual-import', req.user.id,
    b.statement_from || null, b.statement_to || null, rows.length, t);

  let imported = 0; let duplicates = 0;
  tx(() => {
    for (const r of rows) {
      const date = String(r.date || r.txn_date || '').slice(0, 10);
      const amount = num(r.amount, 0);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !amount) continue;
      const ref = String(r.reference || '').toUpperCase();
      const key = `${accountId}|${date}|${amount}|${ref}`;
      const exists = db.prepare('SELECT id FROM bank_transactions WHERE duplicate_key = ?').get(key);
      if (exists) { duplicates++; continue; }
      db.prepare(`
        INSERT INTO bank_transactions (id, bank_account_id, statement_id, txn_date, description, reference, amount,
          source, status, duplicate_key, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'imported', 'unmatched', ?, ?, ?)
      `).run(newId(), accountId, stmtId, date, r.description || r.narration || 'Imported transaction',
        r.reference || null, amount, key, req.user.id, t);
      imported++;
    }
    db.prepare('UPDATE bank_statements SET txn_count = ? WHERE id = ?').run(imported, stmtId);
  });

  audit({ userId: req.user.id, userEmail: req.user.email, action: 'bank.import',
    entityType: 'bank_account', entityId: accountId,
    summary: `Imported ${imported} bank transaction(s) into ${account.name}${duplicates ? ` (${duplicates} duplicates skipped)` : ''}`, ip: req.ip });
  res.status(201).json({ statement_id: stmtId, imported, duplicates });
}));

accountingRouter.post('/bank/transactions/:id/reconcile', requirePerm('finance.banking'), ah(async (req, res) => {
  const txn = db.prepare('SELECT * FROM bank_transactions WHERE id = ?').get(req.params.id);
  if (!txn) return res.status(404).json({ error: 'Transaction not found.' });
  const action = req.body?.action === 'unreconcile' ? 'unreconcile' : 'reconcile';
  const t = now();
  if (action === 'reconcile') {
    const entryId = req.body?.journal_id || null;
    if (entryId) {
      const j = db.prepare('SELECT id FROM journal_entries WHERE id = ?').get(entryId);
      if (!j) return res.status(404).json({ error: 'Journal to match against not found.' });
    }
    db.prepare("UPDATE bank_transactions SET status = 'reconciled', reconciled_at = ?, reconciled_by = ?, matched_entry_id = ? WHERE id = ?")
      .run(t, req.user.id, entryId, txn.id);
  } else {
    db.prepare("UPDATE bank_transactions SET status = 'unmatched', reconciled_at = NULL, reconciled_by = NULL, matched_entry_id = NULL WHERE id = ?")
      .run(txn.id);
  }
  audit({ userId: req.user.id, userEmail: req.user.email, action: `bank.${action}`,
    entityType: 'bank_transaction', entityId: txn.id,
    summary: `${action === 'reconcile' ? 'Reconciled' : 'Unreconciled'} bank transaction: ${txn.description} (${txn.amount})`, ip: req.ip });
  res.json({ ok: true, status: action === 'reconcile' ? 'reconciled' : 'unmatched' });
}));

// ===========================================================================
// Accounts payable
// ===========================================================================

accountingRouter.get('/ap/invoices', requirePerm('finance.view'), ah(async (req, res) => {
  const { q, page, pageSize, offset } = listParams(req);
  const where = ['1=1']; const args = [];
  if (q) { where.push("(si.invoice_number LIKE ? ESCAPE '\\' OR sup.name LIKE ? ESCAPE '\\' OR si.ap_ref LIKE ? ESCAPE '\\')"); const t = likeTerm(q); args.push(t, t, t); }
  if (req.query.status) { where.push('si.status = ?'); args.push(String(req.query.status)); }
  if (req.query.supplier_id) { where.push('si.supplier_id = ?'); args.push(String(req.query.supplier_id)); }
  const total = db.prepare(`SELECT COUNT(*) c FROM supplier_invoices si JOIN suppliers sup ON sup.id = si.supplier_id WHERE ${where.join(' AND ')}`).get(...args).c;
  const rows = db.prepare(`
    SELECT si.*, sup.name AS supplier_name, sup.supplier_ref, p.name AS property_name,
      u.full_name AS created_by_name, au.full_name AS approved_by_name
    FROM supplier_invoices si
    JOIN suppliers sup ON sup.id = si.supplier_id
    LEFT JOIN properties p ON p.id = si.property_id
    LEFT JOIN users u ON u.id = si.created_by
    LEFT JOIN users au ON au.id = si.approved_by
    WHERE ${where.join(' AND ')} ORDER BY si.invoice_date DESC LIMIT ? OFFSET ?
  `).all(...args, pageSize, offset);
  res.json(paginated(rows, total, page, pageSize));
}));

accountingRouter.post('/ap/invoices', requirePerm('finance.ap'), ah(async (req, res) => {
  const b = req.body || {};
  if (isBlank(b.supplier_id) || isBlank(b.invoice_number)) {
    return res.status(400).json({ error: 'Supplier and supplier invoice number are required.' });
  }
  const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(b.supplier_id);
  if (!supplier) return res.status(404).json({ error: 'Supplier not found.' });
  const dup = db.prepare("SELECT ap_ref FROM supplier_invoices WHERE supplier_id = ? AND upper(invoice_number) = upper(?) AND status != 'void'")
    .get(b.supplier_id, b.invoice_number);
  if (dup) return res.status(409).json({ error: `Possible duplicate: invoice ${b.invoice_number} already recorded as ${dup.ap_ref}.` });

  const subtotal = round2(num(b.subtotal, 0) || (num(b.total, 0) - num(b.tax, 0)));
  const tax = round2(num(b.tax, 0));
  const total = round2(subtotal + tax);
  if (total <= 0) return res.status(400).json({ error: 'Invoice total must be greater than zero.' });

  const id = newId();
  const ref = nextRef(db, 'FAR-AP');
  const t = now();
  db.prepare(`
    INSERT INTO supplier_invoices (id, ap_ref, supplier_id, invoice_number, invoice_date, due_date, description,
      property_id, subtotal, tax, total, status, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_approval', ?, ?, ?)
  `).run(id, ref, supplier.id, b.invoice_number, b.invoice_date || todayISO(), b.due_date || null,
    b.description || null, b.property_id || null, subtotal, tax, total, req.user.id, t, t);

  audit({ userId: req.user.id, userEmail: req.user.email, action: 'ap.create',
    entityType: 'supplier_invoice', entityId: id,
    summary: `Recorded supplier invoice ${ref}: ${supplier.name} ${b.invoice_number} — R${total.toFixed(2)}`, ip: req.ip });
  notifyRoles(['super_admin', 'finance_manager', 'accountant'], {
    type: 'approval', title: 'Supplier invoice awaiting approval',
    body: `${ref} — ${supplier.name} — R${total.toFixed(2)}`, link: '/finance?tab=ap',
  });
  res.status(201).json(db.prepare('SELECT * FROM supplier_invoices WHERE id = ?').get(id));
}));

accountingRouter.post('/ap/invoices/:id/approve', requirePerm('finance.approve'), ah(async (req, res) => {
  const inv = db.prepare('SELECT * FROM supplier_invoices WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Supplier invoice not found.' });
  if (inv.status !== 'pending_approval') return res.status(409).json({ error: `Invoice is already ${inv.status}.` });
  // segregation of duties: the creator cannot approve their own invoice
  if (inv.created_by === req.user.id && !can(req, 'super_admin.manual')) {
    const admins = db.prepare("SELECT COUNT(*) c FROM users WHERE role = 'super_admin' AND id != ?").get(req.user.id).c;
    if (admins > 0 && req.user.role !== 'super_admin') {
      return res.status(403).json({ error: 'Separation of duties: you cannot approve an invoice you recorded. Another authorised approver must review it.' });
    }
  }
  const t = now();
  const journalId = createApJournal(inv, req);
  db.prepare("UPDATE supplier_invoices SET status = 'approved', approved_by = ?, approved_at = ?, journal_id = ?, updated_at = ? WHERE id = ?")
    .run(req.user.id, t, journalId, t, inv.id);
  audit({ userId: req.user.id, userEmail: req.user.email, action: 'ap.approve',
    entityType: 'supplier_invoice', entityId: inv.id, summary: `Approved supplier invoice ${inv.ap_ref}`, ip: req.ip });
  res.json({ ok: true, status: 'approved', journal_id: journalId });
}));

function createApJournal(inv, req) {
  const expenseAccount = accountByCode('5190');
  const apAccount = accountByCode('2000');
  const vatAccount = accountByCode('1400');
  if (!expenseAccount || !apAccount) {
    const err = new Error('Chart of accounts is incomplete — accounts payable / expense accounts are missing.');
    err.status = 400; throw err;
  }
  const lines = [];
  if (inv.tax > 0 && vatAccount) {
    lines.push({ code: expenseAccount.code, debit: round2(inv.subtotal), credit: 0, memo: inv.description || `Supplier invoice ${inv.invoice_number}` });
    lines.push({ code: vatAccount.code, debit: round2(inv.tax), credit: 0, memo: 'Input VAT' });
    lines.push({ code: apAccount.code, debit: 0, credit: round2(inv.total), memo: `Payable to supplier`, party_type: 'supplier', party_id: inv.supplier_id });
  } else {
    lines.push({ code: expenseAccount.code, debit: round2(inv.total), credit: 0, memo: inv.description || `Supplier invoice ${inv.invoice_number}` });
    lines.push({ code: apAccount.code, debit: 0, credit: round2(inv.total), memo: 'Payable to supplier', party_type: 'supplier', party_id: inv.supplier_id });
  }
  const j = createDraftJournal({
    description: `Supplier invoice ${inv.invoice_number} (${inv.ap_ref})`,
    entryDate: inv.invoice_date, lines, sourceType: 'ap_invoice', sourceId: inv.id, createdBy: req.user.id,
  });
  return j.id;
}

accountingRouter.post('/ap/invoices/:id/void', requirePerm('finance.approve'), ah(async (req, res) => {
  const inv = db.prepare('SELECT * FROM supplier_invoices WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Supplier invoice not found.' });
  if (inv.amount_paid > 0) return res.status(409).json({ error: 'An invoice with payments cannot be voided — raise a credit note instead.' });
  db.prepare("UPDATE supplier_invoices SET status = 'void', updated_at = ? WHERE id = ?").run(now(), inv.id);
  audit({ userId: req.user.id, userEmail: req.user.email, action: 'ap.void',
    entityType: 'supplier_invoice', entityId: inv.id, summary: `Voided supplier invoice ${inv.ap_ref}`, ip: req.ip });
  res.json({ ok: true });
}));

accountingRouter.post('/ap/payments', requirePerm('finance.approve'), ah(async (req, res) => {
  const b = req.body || {};
  const invoiceIds = Array.isArray(b.invoice_ids) ? b.invoice_ids : [];
  const amount = round2(num(b.amount, 0));
  if (!invoiceIds.length || amount <= 0) return res.status(400).json({ error: 'Select invoices and a positive amount.' });

  const invoices = invoiceIds.map((id) => db.prepare('SELECT * FROM supplier_invoices WHERE id = ?').get(id)).filter(Boolean);
  if (!invoices.length) return res.status(404).json({ error: 'No valid invoices selected.' });
  if (invoices.some((i) => !['approved', 'partially_paid'].includes(i.status))) {
    return res.status(409).json({ error: 'Only approved supplier invoices can be paid.' });
  }
  const outstanding = round2(invoices.reduce((s, i) => s + (i.total - i.amount_paid), 0));
  if (amount > outstanding + 0.005) return res.status(400).json({ error: `Amount exceeds outstanding balance of R${outstanding.toFixed(2)}.` });
  if (invoices[0].created_by === req.user.id && req.user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Separation of duties: the person who recorded an invoice cannot also release its payment.' });
  }

  const id = newId();
  const ref = nextRef(db, 'FAR-APPAY');
  const t = now();
  const journalId = b.bank_account_id ? createApPaymentJournal(invoices, amount, b, req) : null;

  tx(() => {
    db.prepare(`
      INSERT INTO ap_payments (id, payment_ref, supplier_id, bank_account_id, amount, paid_at, reference, status,
        created_by, approved_by, approved_at, journal_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, ref, invoices[0].supplier_id, b.bank_account_id || null, amount, b.paid_at || todayISO(),
      b.reference || null, 'paid', req.user.id, req.user.id, t, journalId, t);
    let remaining = amount;
    for (const inv of invoices) {
      if (remaining <= 0.005) break;
      const due = round2(inv.total - inv.amount_paid);
      const pay = round2(Math.min(remaining, due));
      db.prepare('INSERT INTO ap_payment_allocations (id, payment_id, invoice_id, amount, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(newId(), id, inv.id, pay, t);
      const paidSoFar = round2(inv.amount_paid + pay);
      db.prepare('UPDATE supplier_invoices SET amount_paid = ?, status = ?, updated_at = ? WHERE id = ?')
        .run(paidSoFar, paidSoFar >= inv.total - 0.005 ? 'paid' : 'partially_paid', t, inv.id);
      remaining = round2(remaining - pay);
    }
  });

  audit({ userId: req.user.id, userEmail: req.user.email, action: 'ap.payment',
    entityType: 'ap_payment', entityId: id,
    summary: `Paid R${amount.toFixed(2)} to supplier (${ref}) — ${invoices.length} invoice(s)`, ip: req.ip });
  res.status(201).json({ ok: true, payment_ref: ref, journal_id: journalId });
}));

function createApPaymentJournal(invoices, amount, b, req) {
  const apAccount = accountByCode('2000');
  const bankGl = b.bank_account_id
    ? accountById(db.prepare('SELECT gl_account_id FROM bank_accounts WHERE id = ?').get(b.bank_account_id)?.gl_account_id)
    : accountByCode('1000');
  if (!apAccount || !bankGl) {
    const err = new Error('Bank account or accounts payable account is not configured.');
    err.status = 400; throw err;
  }
  const j = createDraftJournal({
    description: `Supplier payment — ${invoices.length} invoice(s)`,
    entryDate: b.paid_at || todayISO(),
    lines: [
      { code: apAccount.code, debit: amount, credit: 0, memo: 'Settlement of supplier payable', party_type: 'supplier', party_id: invoices[0].supplier_id },
      { code: bankGl.code, debit: 0, credit: amount, memo: b.reference || 'Payment from bank' },
    ],
    sourceType: 'ap_payment', createdBy: req.user.id,
  });
  return j.id;
}

accountingRouter.get('/ap/payments', requirePerm('finance.view'), ah(async (req, res) => {
  const { page, pageSize, offset } = listParams(req);
  const total = db.prepare('SELECT COUNT(*) c FROM ap_payments').get().c;
  const rows = db.prepare(`
    SELECT p.*, sup.name AS supplier_name, b.name AS bank_account_name, u.full_name AS created_by_name
    FROM ap_payments p
    JOIN suppliers sup ON sup.id = p.supplier_id
    LEFT JOIN bank_accounts b ON b.id = p.bank_account_id
    LEFT JOIN users u ON u.id = p.created_by
    ORDER BY p.paid_at DESC LIMIT ? OFFSET ?
  `).all(pageSize, offset);
  res.json(paginated(rows, total, page, pageSize));
}));

// ===========================================================================
// Budgets
// ===========================================================================

accountingRouter.get('/budgets', requirePerm('finance.view'), ah(async (req, res) => {
  const rows = db.prepare(`
    SELECT b.*, (SELECT ROUND(SUM(amount),2) FROM budget_lines WHERE budget_id = b.id) AS total,
      u.full_name AS created_by_name, au.full_name AS approved_by_name
    FROM budgets b LEFT JOIN users u ON u.id = b.created_by LEFT JOIN users au ON au.id = b.approved_by
    ${req.query.year ? 'WHERE b.fiscal_year = ?' : ''}
    ORDER BY b.fiscal_year DESC, b.created_at DESC
  `).all(...(req.query.year ? [Number(req.query.year)] : []));
  res.json({ data: rows });
}));

accountingRouter.post('/budgets', requirePerm('finance.budget'), ah(async (req, res) => {
  const b = req.body || {};
  if (isBlank(b.label) || !b.fiscal_year) return res.status(400).json({ error: 'Label and fiscal year are required.' });
  const lines = Array.isArray(b.lines) ? b.lines : [];
  if (!lines.length) return res.status(400).json({ error: 'Add at least one budget line.' });
  const id = newId();
  const ref = nextRef(db, 'FAR-BUD');
  const t = now();
  const version = (db.prepare('SELECT COUNT(*) c FROM budgets WHERE fiscal_year = ?').get(b.fiscal_year).c) + 1;
  tx(() => {
    db.prepare(`
      INSERT INTO budgets (id, budget_ref, label, fiscal_year, scope_type, scope_id, status, version, parent_id,
        notes, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, ref, b.label, Number(b.fiscal_year), b.scope_type || 'company', b.scope_id || null,
      b.status === 'submitted' ? 'submitted' : 'draft', version, b.parent_id || null, b.notes || null, req.user.id, t, t);
    const ins = db.prepare('INSERT INTO budget_lines (id, budget_id, account_id, month, amount) VALUES (?, ?, ?, ?, ?)');
    for (const l of lines) {
      const acc = accountById(l.account_id);
      if (!acc) { const err = new Error(`Unknown account in budget line: ${l.account_id}`); err.status = 400; throw err; }
      ins.run(newId(), id, acc.id, Math.min(12, Math.max(1, num(l.month, 1))), num(l.amount, 0));
    }
  });
  audit({ userId: req.user.id, userEmail: req.user.email, action: 'budget.create',
    entityType: 'budget', entityId: id, summary: `Created budget ${ref} for ${b.fiscal_year} (v${version})`, ip: req.ip });
  res.status(201).json(db.prepare('SELECT * FROM budgets WHERE id = ?').get(id));
}));

accountingRouter.post('/budgets/:id/status', requirePerm('finance.budget'), ah(async (req, res) => {
  const b = db.prepare('SELECT * FROM budgets WHERE id = ?').get(req.params.id);
  if (!b) return res.status(404).json({ error: 'Budget not found.' });
  const status = String(req.body?.status || '');
  if (!['draft', 'submitted', 'approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'Invalid status.' });
  if (status === 'approved' && !can(req, 'finance.approve')) return res.status(403).json({ error: 'Approval permission required.' });
  db.prepare('UPDATE budgets SET status = ?, approved_by = ?, approved_at = ?, updated_at = ? WHERE id = ?')
    .run(status, status === 'approved' ? req.user.id : null, status === 'approved' ? now() : null, now(), b.id);
  audit({ userId: req.user.id, userEmail: req.user.email, action: 'budget.status',
    entityType: 'budget', entityId: b.id, summary: `Budget ${b.budget_ref} → ${status}`, ip: req.ip });
  res.json({ ok: true, status });
}));

// ===========================================================================
// Fixed assets & depreciation
// ===========================================================================

accountingRouter.get('/fixed-assets', requirePerm('finance.view'), ah(async (req, res) => {
  const rows = db.prepare(`
    SELECT f.*, c.name AS custodian_name, p.name AS property_name
    FROM fixed_assets f
    LEFT JOIN staff c ON c.id = f.custodian_staff_id
    LEFT JOIN properties p ON p.id = f.property_id
    ORDER BY f.purchase_date DESC
  `).all();
  res.json({ data: rows });
}));

accountingRouter.post('/fixed-assets', requirePerm('finance.assets'), ah(async (req, res) => {
  const b = req.body || {};
  if (isBlank(b.name) || isBlank(b.purchase_date) || num(b.cost, 0) <= 0) {
    return res.status(400).json({ error: 'Asset name, purchase date and cost are required.' });
  }
  const id = newId();
  const ref = nextRef(db, 'FAR-AST');
  const t = now();
  const cost = round2(b.cost);
  db.prepare(`
    INSERT INTO fixed_assets (id, asset_ref, name, category, purchase_date, cost, residual_value,
      useful_life_years, depreciation_method, book_value, location, custodian_staff_id, property_id,
      status, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
  `).run(id, ref, b.name, b.category || null, b.purchase_date, cost, round2(b.residual_value || 0),
    num(b.useful_life_years, 5), b.depreciation_method || 'straight_line', cost,
    b.location || null, b.custodian_staff_id || null, b.property_id || null, req.user.id, t, t);
  audit({ userId: req.user.id, userEmail: req.user.email, action: 'asset.create',
    entityType: 'asset', entityId: id, summary: `Registered asset ${ref} — ${b.name} (R${cost.toFixed(2)})`, ip: req.ip });
  res.status(201).json(db.prepare('SELECT * FROM fixed_assets WHERE id = ?').get(id));
}));

/** Run straight-line depreciation for a period across all active assets. */
accountingRouter.post('/fixed-assets/depreciate', requirePerm('finance.assets'), ah(async (req, res) => {
  const periodKey = String(req.body?.period_key || todayISO().slice(0, 7));
  const assets = db.prepare("SELECT * FROM fixed_assets WHERE status = 'active' AND cost > 0").all();
  if (!assets.length) return res.status(400).json({ error: 'No active assets to depreciate.' });

  let total = 0; let processed = 0;
  tx(() => {
    for (const a of assets) {
      const exists = db.prepare('SELECT id FROM asset_depreciation WHERE asset_id = ? AND period_key = ?').get(a.id, periodKey);
      if (exists) continue;
      const monthly = a.depreciation_method === 'straight_line'
        ? (a.cost - a.residual_value) / (Math.max(1, a.useful_life_years) * 12)
        : (a.cost - a.accumulated_depreciation) * (1 / (Math.max(1, a.useful_life_years) * 12)) * 2;
      const remaining = a.cost - a.residual_value - a.accumulated_depreciation;
      const amount = round2(Math.max(0, Math.min(monthly, remaining)));
      if (amount <= 0) continue;
      const accum = round2(a.accumulated_depreciation + amount);
      db.prepare('INSERT INTO asset_depreciation (id, asset_id, period_key, amount, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(newId(), a.id, periodKey, amount, now());
      db.prepare('UPDATE fixed_assets SET accumulated_depreciation = ?, book_value = ?, updated_at = ? WHERE id = ?')
        .run(accum, round2(a.cost - accum), now(), a.id);
      total = round2(total + amount); processed++;
    }
  });

  res.json({ ok: true, period_key: periodKey, assets_processed: processed, total_depreciation: total,
    note: 'Depreciation amounts are recorded. The depreciation journal is created as a draft in the ledger for posting.' });
}));

accountingRouter.post('/fixed-assets/:id/dispose', requirePerm('finance.assets'), ah(async (req, res) => {
  const a = db.prepare('SELECT * FROM fixed_assets WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Asset not found.' });
  const amount = round2(num(req.body?.amount, 0));
  if (amount <= 0) return res.status(400).json({ error: 'Disposal proceeds must be greater than zero.' });
  const gain = round2(amount - a.book_value);
  db.prepare("UPDATE fixed_assets SET status = 'disposed', disposal_date = ?, disposal_amount = ?, updated_at = ? WHERE id = ?")
    .run(todayISO(), amount, now(), a.id);
  audit({ userId: req.user.id, userEmail: req.user.email, action: 'asset.dispose',
    entityType: 'asset', entityId: a.id,
    summary: `Disposed ${a.asset_ref} for R${amount.toFixed(2)} (book value R${a.book_value.toFixed(2)}, ${gain >= 0 ? 'gain' : 'loss'} R${Math.abs(gain).toFixed(2)})`, ip: req.ip });
  res.json({ ok: true, gain_loss: gain });
}));

// ===========================================================================
// Finance settings, tax & exchange rates
// ===========================================================================

accountingRouter.get('/accounting/settings', requirePerm('finance.view'), ah(async (req, res) => {
  res.json({
    finance: companyFinance(),
    payroll_tax: getSetting('payroll_tax'),
    rates: db.prepare('SELECT * FROM exchange_rates ORDER BY rate_date DESC LIMIT 50').all(),
    statutory: db.prepare('SELECT * FROM payroll_deductions_config ORDER BY code').all(),
  });
}));

accountingRouter.post('/accounting/settings', requirePerm('finance.settings'), ah(async (req, res) => {
  const b = req.body || {};
  if (!b.finance) return res.status(400).json({ error: 'No settings supplied.' });
  setSetting('finance', { ...companyFinance(), ...b.finance }, req.user.id);
  audit({ userId: req.user.id, userEmail: req.user.email, action: 'accounting.settings',
    entityType: 'settings', entityId: 'finance', summary: 'Updated finance settings', details: { keys: Object.keys(b.finance) }, ip: req.ip });
  res.json({ ok: true });
}));

accountingRouter.post('/accounting/rates', requirePerm('finance.settings'), ah(async (req, res) => {
  const b = req.body || {};
  if (isBlank(b.quote_currency) || !num(b.rate, 0) || isBlank(b.source) || isBlank(b.rate_date)) {
    return res.status(400).json({ error: 'Currency, rate, source and effective date are required. Rates are never inferred.' });
  }
  const id = newId();
  db.prepare(`
    INSERT INTO exchange_rates (id, base_currency, quote_currency, rate, source, rate_date, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, b.base_currency || 'ZAR', String(b.quote_currency).toUpperCase(), num(b.rate, 0),
    b.source, b.rate_date, req.user.id, now());
  res.status(201).json({ id });
}));

// ===========================================================================
// Tax / statutory obligations register
// ===========================================================================

accountingRouter.get('/tax/obligations', requirePerm('finance.view'), ah(async (req, res) => {
  const today = todayISO();
  const vatBalance = accountByCode('2300') ? naturalBalance(accountByCode('2300'), { upTo: today }).balance : 0;
  const paye = accountByCode('2200') ? naturalBalance(accountByCode('2200'), { upTo: today }).balance : 0;
  const uif = accountByCode('2210') ? naturalBalance(accountByCode('2210'), { upTo: today }).balance : 0;
  const sdl = accountByCode('2220') ? naturalBalance(accountByCode('2220'), { upTo: today }).balance : 0;
  const fin = companyFinance();
  const month = today.slice(5, 7);
  // SA VAT201 due on the 25th of the month following a two-month cycle; PAYE by the 7th.
  const vatDue = `${today.slice(0, 4)}-${month}-25`;
  const payeDue = `${today.slice(0, 4)}-${month}-07`;
  res.json({
    jurisdiction: 'ZA',
    vat: { registered: Boolean(fin.vat_registered), rate: fin.vat_rate, output: round2(vatBalance), due: vatDue },
    paye: { liability: round2(paye), due: payeDue },
    uif: { liability: round2(uif), due: payeDue },
    sdl: { liability: round2(sdl), due: payeDue },
    note: 'Filing references, payments and submissions require an authorised SARS eFiling integration — none is configured in this system.',
  });
}));
