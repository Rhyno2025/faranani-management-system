// ---------------------------------------------------------------------------
// CALVIN — voice assistant backend (AI gateway).
//
// Design:
//   * The browser never talks to the AI provider. The client sends the spoken
//     transcript here; this server calls the configured OpenAI-compatible
//     endpoint with a tool list that is FILTERED BY THE CALLER'S PERMISSIONS.
//   * Every tool is a real backend function that reads or writes the live
//     database. Tool execution is audited.
//   * Write tools create DRAFT records only, require `ai.write`, and are
//     reported back honestly (including failures).
//   * Credentials come from server-side environment variables — never from
//     the browser.
//
// Required environment (set in .env / process environment):
//   CALVIN_AI_API_KEY   — provider API key
//   CALVIN_AI_BASE_URL  — default https://api.openai.com/v1
//   CALVIN_AI_MODEL     — default gpt-4o-mini
// ---------------------------------------------------------------------------
import { Router } from 'express';
import { db, newId, nextRef, now, tx, audit } from '../db.js';
import { requirePerm, can } from '../auth.js';
import { ah, isBlank, num, todayISO, getSetting } from '../util.js';
import { createDraftJournal, accountByCode, naturalBalance } from '../ledger.js';
import { providerChat, providerLabel } from '../ai.js';
import { decryptSecret } from '../crypto.js';

export const calvinRouter = Router();

// ---------------------------- provider resolution ---------------------------
// Priority: enabled primary AI configuration saved in Settings → API
// Configurations, then backup configurations, then legacy environment vars.
// The browser never receives any of these credentials.

function envConfig() {
  const key = process.env.CALVIN_AI_API_KEY || process.env.OPENAI_API_KEY || '';
  if (!key) return null;
  return {
    id: 'env',
    provider: 'openai',
    name: 'Environment configuration',
    base_url: process.env.CALVIN_AI_BASE_URL || 'https://api.openai.com/v1',
    api_key: key,
    model: process.env.CALVIN_AI_MODEL || 'gpt-4o-mini',
    timeout_ms: 45000,
    source: 'environment',
  };
}

function rowToConfig(row) {
  return {
    id: row.id,
    provider: row.provider,
    name: row.name,
    base_url: row.base_url,
    api_key: decryptSecret(row.api_key_enc),
    model: row.model,
    api_version: row.api_version,
    org_id: row.org_id,
    extra_headers: row.extra_headers,
    max_tokens: row.max_tokens,
    temperature: row.temperature,
    timeout_ms: row.timeout_ms,
    source: 'settings',
  };
}

/** Enabled AI providers in failover order. The primary is tried first. */
export function activeCalvinConfigs() {
  const rows = db.prepare(`
    SELECT * FROM api_configs
    WHERE kind = 'ai' AND enabled = 1
    ORDER BY is_primary DESC, is_backup DESC, created_at ASC
  `).all();
  const list = rows.map(rowToConfig).filter((c) => c.api_key && c.base_url);
  const env = envConfig();
  if (env) list.push(env);
  return list;
}

export function primaryCalvinConfig() {
  return activeCalvinConfigs()[0] || null;
}

// Rate limiting
const hitMap = new Map();
function rateLimited(userId) {
  const nowMs = Date.now();
  const win = 60_000;
  const list = (hitMap.get(userId) || []).filter((t) => nowMs - t < win);
  if (list.length >= 30) { hitMap.set(userId, list); return true; }
  list.push(nowMs); hitMap.set(userId, list);
  return false;
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Provider calls are handled by ../ai.js (OpenAI-compatible, Gemini, Anthropic).

// ============================== TOOLS ======================================
// Each tool: { name, description, parameters (JSON schema), permission, run }
// `run` receives (args, ctx) where ctx = { user, permissions }.

const TOOLS = [
  {
    name: 'system_overview',
    description: 'Headline record counts across the whole system (employees, students, properties, invoices, journals, suppliers). Use before answering "how many…" questions.',
    permission: null,
    parameters: { type: 'object', properties: {} },
    run: () => ({
      employees: db.prepare('SELECT COUNT(*) c FROM staff WHERE archived_at IS NULL').get().c,
      employees_active: db.prepare("SELECT COUNT(*) c FROM staff WHERE employment_status = 'active' AND archived_at IS NULL").get().c,
      students: db.prepare("SELECT COUNT(*) c FROM students WHERE status != 'archived'").get().c,
      properties: db.prepare('SELECT COUNT(*) c FROM properties').get().c,
      rooms: db.prepare('SELECT COUNT(*) c FROM rooms').get().c,
      suppliers: db.prepare('SELECT COUNT(*) c FROM suppliers').get().c,
      open_invoices: db.prepare("SELECT COUNT(*) c FROM invoices WHERE status NOT IN ('void','paid')").get().c,
      journals_posted: db.prepare("SELECT COUNT(*) c FROM journal_entries WHERE status = 'posted'").get().c,
      open_complaints: db.prepare("SELECT COUNT(*) c FROM complaints WHERE status NOT IN ('resolved','closed')").get().c,
      generated_at: now(),
    }),
  },
  {
    name: 'hr_employees',
    description: 'List or count employee records with optional status/department filters. Salary and banking fields are never returned.',
    permission: 'staff.view',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'active | on_leave | inactive | terminated' },
        department: { type: 'string' },
        limit: { type: 'number' },
      },
    },
    run: (a) => {
      const where = ['archived_at IS NULL']; const args = [];
      if (a.status) { where.push('employment_status = ?'); args.push(a.status); }
      if (a.department) { where.push('department = ?'); args.push(a.department); }
      const count = db.prepare(`SELECT COUNT(*) c FROM staff WHERE ${where.join(' AND ')}`).get(...args).c;
      const rows = db.prepare(`
        SELECT employee_ref, full_name, job_title, department, employment_status, hired_at, contract_end
        FROM staff WHERE ${where.join(' AND ')} ORDER BY full_name LIMIT ?
      `).all(...args, Math.min(50, num(a.limit, 20)));
      return { count, employees: rows };
    },
  },
  {
    name: 'hr_leave_requests',
    description: 'Leave applications with optional status filter, including employee name, type and dates.',
    permission: 'staff.view',
    parameters: { type: 'object', properties: { status: { type: 'string', description: 'pending | hr_pending | approved | rejected | cancelled' }, limit: { type: 'number' } } },
    run: (a) => {
      const where = ['1=1']; const args = [];
      if (a.status) { where.push('lr.status = ?'); args.push(a.status); }
      const count = db.prepare(`SELECT COUNT(*) c FROM leave_requests lr WHERE ${where.join(' AND ')}`).get(...args).c;
      const rows = db.prepare(`
        SELECT lr.leave_ref, s.full_name, lt.name AS leave_type, lr.start_date, lr.end_date, lr.days, lr.status
        FROM leave_requests lr JOIN staff s ON s.id = lr.staff_id JOIN leave_types lt ON lt.id = lr.leave_type_id
        WHERE ${where.join(' AND ')} ORDER BY lr.created_at DESC LIMIT ?
      `).all(...args, Math.min(50, num(a.limit, 25)));
      return { count, requests: rows };
    },
  },
  {
    name: 'hr_contract_expiries',
    description: 'Employees whose employment contract ends within N days (default 60), plus probation periods ending.',
    permission: 'staff.view',
    parameters: { type: 'object', properties: { days: { type: 'number' } } },
    run: (a) => {
      const days = Math.max(1, num(a.days, 60));
      const today = todayISO();
      const horizon = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
      return {
        contracts: db.prepare(`
          SELECT employee_ref, full_name, job_title, department, contract_end FROM staff
          WHERE archived_at IS NULL AND contract_end IS NOT NULL AND contract_end BETWEEN ? AND ?
          ORDER BY contract_end
        `).all(today, horizon),
        probation: db.prepare(`
          SELECT employee_ref, full_name, probation_end FROM staff
          WHERE archived_at IS NULL AND probation_end IS NOT NULL AND probation_end BETWEEN ? AND ?
          ORDER BY probation_end
        `).all(today, horizon),
        window_days: days,
      };
    },
  },
  {
    name: 'hr_attendance_summary',
    description: 'Attendance totals (present, late, absent, overtime hours) from recorded clock events for a date range.',
    permission: 'staff.view',
    parameters: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } } },
    run: (a) => {
      const from = a.from || `${todayISO().slice(0, 7)}-01`;
      const to = a.to || todayISO();
      const s = db.prepare(`
        SELECT COUNT(*) records,
          SUM(CASE WHEN clock_in IS NOT NULL THEN 1 ELSE 0 END) present,
          SUM(CASE WHEN late_minutes > 0 THEN 1 ELSE 0 END) late,
          SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) absent,
          COALESCE(SUM(worked_minutes),0) worked_minutes,
          COALESCE(SUM(overtime_minutes),0) overtime_minutes
        FROM attendance_records WHERE work_date BETWEEN ? AND ?
      `).get(from, to);
      return { from, to, ...s, worked_hours: round2(s.worked_minutes / 60), overtime_hours: round2(s.overtime_minutes / 60) };
    },
  },
  {
    name: 'hr_onboarding_status',
    description: 'Onboarding checklist tasks that are still outstanding, grouped per employee.',
    permission: 'staff.view',
    parameters: { type: 'object', properties: {} },
    run: () => ({
      outstanding: db.prepare(`
        SELECT ot.title, ot.due_date, ot.status, s.full_name, s.employee_ref
        FROM onboarding_tasks ot JOIN staff s ON s.id = ot.staff_id
        WHERE ot.status != 'completed' ORDER BY ot.due_date LIMIT 50
      `).all(),
      overdue: db.prepare("SELECT COUNT(*) c FROM onboarding_tasks WHERE status != 'completed' AND due_date < ?").get(todayISO()).c,
    }),
  },
  {
    name: 'hr_recruitment',
    description: 'Open vacancies and recruitment pipeline counts.',
    permission: 'staff.view',
    parameters: { type: 'object', properties: {} },
    run: () => ({
      vacancies: db.prepare("SELECT req_ref, title, department, status, vacancies, created_at FROM job_requisitions WHERE status = 'open' ORDER BY created_at DESC").all(),
      applicants: db.prepare('SELECT COUNT(*) c FROM job_applicants').get().c,
      applications_in_process: db.prepare("SELECT COUNT(*) c FROM job_applications WHERE status NOT IN ('hired','rejected','withdrawn')").get().c,
      interviews_scheduled: db.prepare("SELECT COUNT(*) c FROM interviews WHERE outcome = 'scheduled'").get().c,
    }),
  },
  {
    name: 'hr_cases',
    description: 'Employee relations cases (grievances, disciplinary, incidents). Confidential cases are only returned when the user may see them.',
    permission: 'hr.cases',
    parameters: { type: 'object', properties: { status: { type: 'string' } } },
    confidential: true,
    run: (a, ctx) => {
      const where = ctx.permissions.includes('hr.cases.confidential') ? ['1=1'] : ['c.confidential = 0'];
      const args = [];
      if (a.status) { where.push('c.status = ?'); args.push(a.status); }
      return {
        confidential_visible: ctx.permissions.includes('hr.cases.confidential'),
        cases: db.prepare(`
          SELECT c.case_ref, c.type, c.title, c.status, c.severity, c.confidential, s.full_name AS employee
          FROM hr_cases c LEFT JOIN staff s ON s.id = c.staff_id
          WHERE ${where.join(' AND ')} ORDER BY c.created_at DESC LIMIT 30
        `).all(...args),
      };
    },
  },
  {
    name: 'payroll_status',
    description: 'Payroll periods, their status and totals. Never claims payroll was paid — only what is recorded.',
    permission: 'hr.payroll.view',
    parameters: { type: 'object', properties: { limit: { type: 'number' } } },
    run: (a) => ({
      periods: db.prepare('SELECT period_key, label, status, employee_count, gross_total, deduction_total, net_total, paid_at FROM payroll_periods ORDER BY period_key DESC LIMIT ?')
        .all(Math.min(24, num(a.limit, 6))),
      statutory: db.prepare('SELECT code, label, rate, ceiling, effective_from, source FROM payroll_deductions_config WHERE active = 1').all(),
    }),
  },
  {
    name: 'finance_overview',
    description: 'Live finance dashboard: cash, receivables, payables, revenue, expenses, profit, liabilities and pending approvals.',
    permission: 'finance.view',
    parameters: { type: 'object', properties: {} },
    run: () => {
      const today = todayISO();
      const yearStart = `${today.slice(0, 4)}-01-01`;
      const ar = db.prepare(`
        SELECT COALESCE(SUM(CASE WHEN status != 'void' THEN total END),0) invoiced,
          COALESCE((SELECT SUM(pa.amount) FROM payment_allocations pa JOIN invoices i2 ON i2.id = pa.invoice_id WHERE i2.status != 'void'),0) paid
        FROM invoices`).get();
      const ap = db.prepare("SELECT COALESCE(SUM(total),0) total, COALESCE(SUM(amount_paid),0) paid FROM supplier_invoices WHERE status NOT IN ('void','draft')").get();
      const banks = db.prepare('SELECT * FROM bank_accounts WHERE active = 1').all().map((b) => ({
        name: b.name,
        balance: round2(b.opening_balance + db.prepare('SELECT COALESCE(SUM(amount),0) s FROM bank_transactions WHERE bank_account_id = ?').get(b.id).s),
      }));
      const incomeAccts = db.prepare("SELECT id FROM chart_of_accounts WHERE type = 'income'").all();
      const expenseAccts = db.prepare("SELECT id FROM chart_of_accounts WHERE type = 'expense'").all();
      const sumType = (list, type) => list.reduce((s, acc) => s + naturalBalance(acc, { from: yearStart }).balance, 0);
      return {
        cash_total: round2(banks.reduce((s, b) => s + b.balance, 0)),
        bank_accounts: banks,
        ar_outstanding: round2(ar.invoiced - ar.paid),
        ap_outstanding: round2(ap.total - ap.paid),
        revenue_year: round2(sumType(incomeAccts)),
        expenses_year: round2(sumType(expenseAccts)),
        profit_year: round2(sumType(incomeAccts) - sumType(expenseAccts)),
        overdue_invoices: db.prepare("SELECT COUNT(*) c FROM invoices WHERE status NOT IN ('void','paid') AND due_date < ?").get(today).c,
        unreconciled_bank_items: db.prepare("SELECT COUNT(*) c FROM bank_transactions WHERE status != 'reconciled'").get().c,
        pending_journals: db.prepare("SELECT COUNT(*) c FROM journal_entries WHERE status = 'draft'").get().c,
        period_status: db.prepare('SELECT period_key, status FROM accounting_periods WHERE period_key = ?').get(today.slice(0, 7)) || null,
      };
    },
  },
  {
    name: 'profit_and_loss',
    description: 'Profit and loss statement from POSTED journal entries for a date range (defaults to this year to date).',
    permission: 'finance.gl.view',
    parameters: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } } },
    run: (a) => {
      const from = a.from || `${todayISO().slice(0, 4)}-01-01`;
      const to = a.to || todayISO();
      const rows = db.prepare(`
        SELECT a.code, a.name, a.type, COALESCE(SUM(l.debit),0) debit, COALESCE(SUM(l.credit),0) credit
        FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN chart_of_accounts a ON a.id = l.account_id
        WHERE e.status = 'posted' AND e.entry_date BETWEEN ? AND ?
        GROUP BY a.id
      `).all(from, to);
      const income = rows.filter((r) => r.type === 'income').map((r) => ({ account: `${r.code} ${r.name}`, amount: round2(r.credit - r.debit) })).filter((r) => r.amount !== 0);
      const expense = rows.filter((r) => r.type === 'expense').map((r) => ({ account: `${r.code} ${r.name}`, amount: round2(r.debit - r.credit) })).filter((r) => r.amount !== 0);
      const inc = round2(income.reduce((s, r) => s + r.amount, 0));
      const exp = round2(expense.reduce((s, r) => s + r.amount, 0));
      return { from, to, income, expense, total_income: inc, total_expense: exp, net_profit: round2(inc - exp),
        note: 'Calculated from posted journal entries only. Draft journals are excluded.' };
    },
  },
  {
    name: 'trial_balance',
    description: 'Trial balance for a date range, with a debit/credit balance check.',
    permission: 'finance.gl.view',
    parameters: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } } },
    run: (a) => {
      const from = a.from || `${todayISO().slice(0, 4)}-01-01`;
      const to = a.to || todayISO();
      const rows = db.prepare(`
        SELECT a.code, a.name, COALESCE(SUM(l.debit),0) debit, COALESCE(SUM(l.credit),0) credit
        FROM chart_of_accounts a
        LEFT JOIN journal_lines l ON l.account_id = a.id
        LEFT JOIN journal_entries e ON e.id = l.entry_id AND e.status = 'posted' AND e.entry_date BETWEEN ? AND ?
        GROUP BY a.id HAVING COALESCE(SUM(l.debit),0) != 0 OR COALESCE(SUM(l.credit),0) != 0
        ORDER BY a.code
      `).all(from, to);
      const td = round2(rows.reduce((s, r) => s + r.debit, 0));
      const tc = round2(rows.reduce((s, r) => s + r.credit, 0));
      return { from, to, rows, total_debit: td, total_credit: tc, balanced: Math.abs(td - tc) < 0.01 };
    },
  },
  {
    name: 'receivable_aging',
    description: 'Outstanding tenant/student receivables with ageing buckets.',
    permission: 'finance.view',
    parameters: { type: 'object', properties: {} },
    run: () => {
      const rows = db.prepare(`
        SELECT i.invoice_ref, i.due_date, s.full_name, s.student_ref,
          (i.total - COALESCE((SELECT SUM(pa.amount) FROM payment_allocations pa WHERE pa.invoice_id = i.id),0)) AS due,
          CAST(julianday('now') - julianday(i.due_date) AS INTEGER) AS days_overdue
        FROM invoices i JOIN students s ON s.id = i.student_id
        WHERE i.status NOT IN ('void','paid')
          AND (i.total - COALESCE((SELECT SUM(pa.amount) FROM payment_allocations pa WHERE pa.invoice_id = i.id),0)) > 0.005
        ORDER BY i.due_date
      `).all();
      const buckets = { current: 0, '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
      for (const r of rows) {
        const d = Math.max(0, r.days_overdue || 0);
        const k = d <= 0 ? 'current' : d <= 30 ? '1-30' : d <= 60 ? '31-60' : d <= 90 ? '61-90' : '90+';
        buckets[k] = round2(buckets[k] + r.due);
      }
      return { buckets, total: round2(rows.reduce((s, r) => s + r.due, 0)), rows: rows.slice(0, 30) };
    },
  },
  {
    name: 'payable_aging',
    description: 'Outstanding supplier invoices with ageing buckets.',
    permission: 'finance.view',
    parameters: { type: 'object', properties: {} },
    run: () => {
      const rows = db.prepare(`
        SELECT si.ap_ref, si.invoice_number, si.due_date, sup.name AS supplier, (si.total - si.amount_paid) AS due,
          CAST(julianday('now') - julianday(si.due_date) AS INTEGER) AS days_overdue
        FROM supplier_invoices si JOIN suppliers sup ON sup.id = si.supplier_id
        WHERE si.status NOT IN ('void','draft') AND (si.total - si.amount_paid) > 0.005
        ORDER BY si.due_date
      `).all();
      const buckets = { current: 0, '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
      for (const r of rows) {
        const d = Math.max(0, r.days_overdue || 0);
        const k = d <= 0 ? 'current' : d <= 30 ? '1-30' : d <= 60 ? '31-60' : d <= 90 ? '61-90' : '90+';
        buckets[k] = round2(buckets[k] + r.due);
      }
      return { buckets, total: round2(rows.reduce((s, r) => s + r.due, 0)), rows };
    },
  },
  {
    name: 'budget_vs_actual',
    description: 'Approved budget versus posted actuals for a year.',
    permission: 'finance.view',
    parameters: { type: 'object', properties: { year: { type: 'number' } } },
    run: (a) => {
      const year = num(a.year, Number(todayISO().slice(0, 4)));
      const budgets = db.prepare("SELECT id FROM budgets WHERE fiscal_year = ? AND status = 'approved'").all(year);
      if (!budgets.length) return { year, rows: [], note: 'No approved budget exists for that year.' };
      const lines = db.prepare(`
        SELECT bl.account_id, a.code, a.name, a.type, SUM(bl.amount) budget
        FROM budget_lines bl JOIN chart_of_accounts a ON a.id = bl.account_id
        WHERE bl.budget_id IN (${budgets.map(() => '?').join(',')}) GROUP BY bl.account_id
      `).all(...budgets.map((b) => b.id));
      const rows = lines.map((l) => {
        const actual = naturalBalance({ id: l.account_id, type: l.type }, { from: `${year}-01-01`, to: `${year}-12-31` }).balance;
        return { account: `${l.code} ${l.name}`, budget: round2(l.budget), actual: round2(actual), variance: round2(l.budget - actual) };
      });
      return { year, rows, total_budget: round2(rows.reduce((s, r) => s + r.budget, 0)), total_actual: round2(rows.reduce((s, r) => s + r.actual, 0)) };
    },
  },
  {
    name: 'bank_reconciliation',
    description: 'Bank accounts with balances and unreconciled statement transactions.',
    permission: 'finance.banking',
    parameters: { type: 'object', properties: {} },
    run: () => ({
      accounts: db.prepare(`
        SELECT b.name, b.bank_name, b.account_number,
          ROUND(b.opening_balance + COALESCE((SELECT SUM(amount) FROM bank_transactions t WHERE t.bank_account_id = b.id),0),2) AS balance,
          (SELECT COUNT(*) FROM bank_transactions t WHERE t.bank_account_id = b.id AND t.status != 'reconciled') AS unreconciled
        FROM bank_accounts b WHERE b.active = 1
      `).all(),
      unmatched: db.prepare(`
        SELECT t.txn_date, t.description, t.reference, t.amount, b.name AS account
        FROM bank_transactions t JOIN bank_accounts b ON b.id = t.bank_account_id
        WHERE t.status != 'reconciled' ORDER BY t.txn_date DESC LIMIT 25
      `).all(),
    }),
  },
  {
    name: 'property_occupancy',
    description: 'Property / room occupancy and rental income per property from live records.',
    permission: 'properties.view',
    parameters: { type: 'object', properties: {} },
    run: () => db.prepare(`
      SELECT p.name AS property,
        (SELECT COUNT(*) FROM buildings b WHERE b.property_id = p.id) AS buildings,
        (SELECT COUNT(*) FROM rooms r JOIN buildings b ON b.id = r.building_id WHERE b.property_id = p.id) AS rooms,
        (SELECT COUNT(*) FROM beds bd JOIN rooms r ON r.id = bd.room_id JOIN buildings b ON b.id = r.building_id
           WHERE b.property_id = p.id AND bd.status = 'occupied') AS beds_occupied,
        (SELECT COUNT(*) FROM students s WHERE s.property_id = p.id AND s.status IN ('active','registered')) AS tenants
      FROM properties p WHERE p.status = 'active' ORDER BY p.name
    `).all(),
  },
  {
    name: 'navigate',
    description: 'Open a page in the application for the user. Returns the route; the client navigates there.',
    permission: null,
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'e.g. /hr, /finance?tab=ledger, /reports, /settings' } },
      required: ['path'],
    },
    run: (a) => ({ path: String(a.path || '/') }),
  },
  {
    name: 'create_job_requisition',
    description: 'Create a DRAFT job vacancy requisition. Requires HR recruitment permission. Reports success or failure honestly.',
    permission: 'hr.recruitment',
    write: true,
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        department: { type: 'string' },
        vacancies: { type: 'number' },
        employment_type: { type: 'string' },
        description: { type: 'string' },
        requirements: { type: 'string' },
      },
      required: ['title'],
    },
    run: (a, ctx) => {
      if (isBlank(a.title)) return { error: 'Job title is required.' };
      const id = newId();
      const ref = nextRef(db, 'FAR-VAC');
      const t = now();
      db.prepare(`
        INSERT INTO job_requisitions (id, req_ref, title, department, vacancies, employment_type, description,
          requirements, status, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)
      `).run(id, ref, a.title, a.department || null, num(a.vacancies, 1), a.employment_type || 'permanent',
        a.description || null, a.requirements || null, ctx.user.id, t, t);
      audit({ userId: ctx.user.id, userEmail: ctx.user.email, action: 'calvin.requisition.create',
        entityType: 'requisition', entityId: id, summary: `CALVIN created draft vacancy ${ref} — ${a.title}`, ip: ctx.ip });
      return { ok: true, req_ref: ref, id, status: 'draft', message: `Draft vacancy ${ref} created for "${a.title}". Review it under HR → Recruitment before publishing.` };
    },
  },
  {
    name: 'create_draft_journal',
    description: 'Create a balanced DRAFT journal entry. It is NOT posted. Requires general-ledger posting permission.',
    permission: 'finance.gl.post',
    write: true,
    parameters: {
      type: 'object',
      properties: {
        description: { type: 'string' },
        entry_date: { type: 'string' },
        lines: {
          type: 'array',
          items: {
            type: 'object',
            properties: { code: { type: 'string' }, debit: { type: 'number' }, credit: { type: 'number' }, memo: { type: 'string' } },
            required: ['code'],
          },
        },
      },
      required: ['description', 'entry_date', 'lines'],
    },
    run: (a, ctx) => {
      try {
        const j = createDraftJournal({
          description: a.description, entryDate: a.entry_date, lines: a.lines,
          sourceType: 'manual', createdBy: ctx.user.id,
        });
        audit({ userId: ctx.user.id, userEmail: ctx.user.email, action: 'calvin.journal.create',
          entityType: 'journal', entityId: j.id, summary: `CALVIN created draft journal ${j.journal_ref} — ${a.description}`, ip: ctx.ip });
        return { ok: true, journal_ref: j.journal_ref, id: j.id, status: 'draft',
          message: `Draft journal ${j.journal_ref} created (R${j.total_debit.toFixed(2)}). It is not posted — a poster must approve it in Finance → Ledger.` };
      } catch (e) {
        return { error: e.message };
      }
    },
  },
  {
    name: 'remember_fact',
    description: 'Store a durable fact the signed-in employee asks CALVIN to remember, such as their name, preferred language or role. Scoped to that employee only.',
    permission: null,
    write: true,
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Short label, e.g. "preferred name" or "department"' },
        value: { type: 'string', description: 'The fact to remember' },
        scope: { type: 'string', description: 'user (this employee) or department (shared; administrators only)' },
      },
      required: ['key', 'value'],
    },
    run: (a, ctx) => {
      const settings = { enabled: true, retention_days: 365, max_entries_per_user: 100, ...(getSetting('calvin_memory') || {}) };
      if (settings.enabled === false) return { error: 'Memory is disabled by the administrator.' };
      const key = String(a.key || '').trim().slice(0, 80);
      const value = String(a.value || '').trim().slice(0, 500);
      if (!key || !value) return { error: 'Both a memory key and a value are required.' };
      const wantsDepartment = String(a.scope || 'user') === 'department';
      if (wantsDepartment && (!settings.department_memory || !ctx.permissions.includes('settings.manage'))) {
        return { error: 'Department memory is not enabled for your account.' };
      }
      const scope = wantsDepartment ? 'department' : 'user';
      const ownerId = wantsDepartment ? 'department' : ctx.user.id;
      const t = now();
      const existing = db.prepare(
        'SELECT id FROM calvin_memory WHERE user_id = ? AND scope = ? AND memory_key = ?'
      ).get(ownerId, scope, key);
      if (existing) {
        db.prepare('UPDATE calvin_memory SET content = ?, updated_at = ? WHERE id = ?')
          .run(value, t, existing.id);
      } else {
        const used = db.prepare('SELECT COUNT(*) c FROM calvin_memory WHERE user_id = ? AND scope = ?')
          .get(ownerId, scope).c;
        if (used >= settings.max_entries_per_user) {
          return { error: `Memory limit reached (${settings.max_entries_per_user} facts). Remove an entry in Settings first.` };
        }
        db.prepare(
          'INSERT INTO calvin_memory (id, user_id, scope, memory_key, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).run(newId(), ownerId, scope, key, value, t, t);
      }
      // Retention: drop entries older than the configured window.
      const cutoff = new Date(Date.now() - settings.retention_days * 86400000).toISOString();
      db.prepare('DELETE FROM calvin_memory WHERE user_id = ? AND updated_at < ?').run(ownerId, cutoff);
      return {
        ok: true, key, scope,
        message: wantsDepartment
          ? `Remembered ${key} for the department.`
          : `Remembered ${key} for ${ctx.user.full_name}.`,
      };
    },
  },
];

// ============================ status / config ==============================

calvinRouter.get('/calvin/status', requirePerm('ai.use'), ah(async (req, res) => {
  const company = getSetting('company') || {};
  const cfg = primaryCalvinConfig();
  res.json({
    configured: Boolean(cfg),
    provider: cfg ? providerLabel(cfg.provider) : null,
    provider_key: cfg?.provider || null,
    model: cfg?.model || null,
    source: cfg?.source || null,
    key_set: Boolean(cfg?.api_key),
    tools: TOOLS.length,
    available_tools: TOOLS.filter((t) => !t.permission || can(req, t.permission)).length,
    can_write: can(req, 'ai.write'),
    company_name: company.name || null,
    voice: getSetting('calvin_voice') || {},
    memory: getSetting('calvin_memory') || {},
    instructions: cfg
      ? null
      : 'Open Settings → CALVIN AI and add an AI provider (API URL, key and model), or set CALVIN_AI_API_KEY in the server environment.',
  });
}));

// ============================== conversation ==============================

const SYSTEM_PROMPT = (ctx, memories = []) => `You are CALVIN, the professional voice assistant built into the Faranani Property Group Management System.
You speak with a calm, confident, professional Southern African English tone. You are concise because your replies are read aloud.

Rules you must never break:
- Use the provided tools to get facts. Never invent employees, tenants, invoices, balances, dates or transactions.
- If a tool returns no records, say plainly that no matching records exist yet.
- You act with the signed-in user's permissions. If a tool reports that permission is denied, explain that access must be granted — never claim the action succeeded.
- Write tools only create DRAFT records. Never say a record was posted, paid, sent or approved unless the tool result says so.
- Never reveal secrets, API keys, password hashes or raw database access. Never attempt to bypass permissions.
- Never disclose another department's confidential records. If asked for data outside your permission set, refuse plainly.
- Keep replies to 3 short sentences or fewer plus any numbers the user needs. No markdown headings.
- Current user: ${ctx.user.full_name} (${ctx.user.role})${ctx.user.department ? `, ${ctx.user.department}` : ''}. Today's date: ${todayISO()}.
${memories.length
  ? `\nFacts this operator asked you to remember:\n${memories.map((m) => `- ${m.memory_key}: ${m.content}`).join('\n')}`
  : '\nYou have no stored facts about this operator yet. If they ask you to remember something, use remember_fact.'}`;

calvinRouter.post('/calvin', requirePerm('ai.use'), ah(async (req, res) => {
  const message = String(req.body?.message || '').trim();
  if (!message) return res.status(400).json({ error: 'No message received.' });
  if (message.length > 2000) return res.status(400).json({ error: 'Message too long.' });
  if (rateLimited(req.user.id)) return res.status(429).json({ error: 'Too many requests — please wait a moment.' });

  const ctx = { user: req.user, permissions: req.permissions || [], ip: req.ip };
  const allowedTools = TOOLS.filter((t) => !t.permission || ctx.permissions.includes(t.permission));
  const configs = activeCalvinConfigs();

  if (!configs.length) {
    return res.json({
      configured: false,
      reply: 'CALVIN is not connected to an AI provider yet. A Super Administrator can add one under Settings → CALVIN AI.',
      tools_used: [],
    });
  }

  const memorySettings = { enabled: true, retention_days: 365, ...(getSetting('calvin_memory') || {}) };
  let memories = [];
  if (memorySettings.enabled !== false) {
    if (memorySettings.department_memory) {
      memories = db.prepare(`
        SELECT memory_key, content, scope FROM calvin_memory
        WHERE (user_id = ? AND scope = 'user') OR (scope = 'department' AND user_id = 'department')
        ORDER BY scope, updated_at DESC LIMIT 40
      `).all(req.user.id);
    } else {
      memories = db.prepare(
        "SELECT memory_key, content, scope FROM calvin_memory WHERE user_id = ? AND scope = 'user' ORDER BY updated_at DESC LIMIT 30"
      ).all(req.user.id);
    }
  }

  const baseMessages = [
    { role: 'system', content: SYSTEM_PROMPT(ctx, memories) },
    ...(Array.isArray(req.body?.history)
      ? req.body.history.slice(-10).map((h) => ({
        role: h.role === 'assistant' ? 'assistant' : 'user',
        content: String(h.content || '').slice(0, 2000),
      }))
      : []),
    { role: 'user', content: message },
  ];

  const toolsUsed = [];
  let navigatedTo = null;
  let reply = '';
  let lastError = '';
  let usedProvider = null;

  for (const config of configs) {
    usedProvider = config;
    const convo = baseMessages.slice();
    let providerFailed = false;

    for (let turn = 0; turn < 4; turn++) {
      const completion = await providerChat(config, {
        messages: convo,
        tools: allowedTools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })),
        temperature: config.temperature,
      });

      if (completion.error) {
        lastError = `${providerLabel(config.provider)}: ${completion.error.message}`;
        console.warn('[calvin] provider failed:', lastError);
        providerFailed = true;
        break;
      }

      if (completion.toolCalls?.length) {
        convo.push({
          role: 'assistant',
          content: completion.text || '',
          toolCalls: completion.toolCalls,
        });
        for (const call of completion.toolCalls) {
          const tool = allowedTools.find((t) => t.name === call.name);
          let result;
          if (!tool) {
            result = { error: `Tool ${call.name} is not available to your role.` };
          } else {
            try {
              result = tool.run(call.args || {}, ctx);
              if (result && typeof result.then === 'function') result = await result;
            } catch (e) {
              result = { error: e.message };
            }
          }
          toolsUsed.push({ name: call.name, args: call.args || {}, ok: !(result && result.error), error: result?.error || null });
          if (tool) {
            audit({
              userId: req.user.id, userEmail: req.user.email, action: 'calvin.tool',
              entityType: 'calvin', entityId: call.name,
              summary: `CALVIN ran ${call.name}(${JSON.stringify(call.args || {}).slice(0, 180)})${result?.error ? ` → ${result.error}` : ''}`,
              ip: req.ip,
            });
          }
          if (tool?.name === 'navigate' && result?.path) navigatedTo = result.path;
          convo.push({
            role: 'tool',
            toolCallId: call.id,
            name: call.name,
            content: JSON.stringify(result).slice(0, 12000),
          });
        }
        if (completion.text) reply = completion.text;
        continue;
      }

      reply = completion.text || '';
      break;
    }

    if (reply) break;
    // A provider that already executed tools must not be retried elsewhere —
    // that would run the same write twice. Report honestly instead.
    if (toolsUsed.length > 0 || providerFailed) break;
  }

  if (!reply) {
    reply = toolsUsed.length > 0
      ? 'I carried out the requested action but could not compose a summary. Please check the relevant module.'
      : `CALVIN could not reach an AI provider. ${lastError ? `Provider said: ${lastError.slice(0, 160)}.` : ''} An administrator can test the connection under Settings → CALVIN AI.`;
    if (!lastError && toolsUsed.length === 0) {
      reply = 'CALVIN could not produce a response for that request. Please rephrase it.';
    }
  }

  audit({
    userId: req.user.id, userEmail: req.user.email, action: 'calvin.query',
    entityType: 'calvin', summary: `CALVIN: "${message.slice(0, 120)}"`,
    details: { tools: toolsUsed.map((t) => t.name), provider: usedProvider ? providerLabel(usedProvider.provider) : null },
    ip: req.ip,
  });

  res.json({
    configured: true,
    reply,
    tools_used: toolsUsed,
    navigate_to: navigatedTo,
    provider: usedProvider ? providerLabel(usedProvider.provider) : null,
  });
}));
