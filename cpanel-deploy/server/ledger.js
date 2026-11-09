// ---------------------------------------------------------------------------
// Ledger service — the single place where journal entries are created.
//
// Rules enforced here:
//   * every journal must balance (total debits === total credits) before it can
//     be saved, even in draft;
//   * entries are created as DRAFT and only become part of the financial
//     statements when a user with posting permission posts them;
//   * posted entries are never edited — corrections happen by reversal;
//   * postings to a closed accounting period are rejected.
// ---------------------------------------------------------------------------
import { db, newId, nextRef, now } from './db.js';
import { getSetting } from './util.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export function accountByCode(code) {
  return db.prepare('SELECT * FROM chart_of_accounts WHERE code = ?').get(String(code)) || null;
}

export function accountById(id) {
  return db.prepare('SELECT * FROM chart_of_accounts WHERE id = ?').get(id) || null;
}

export function periodForKey(key) {
  return db.prepare('SELECT * FROM accounting_periods WHERE period_key = ?').get(String(key)) || null;
}

export function assertPeriodOpen(entryDate) {
  const key = String(entryDate).slice(0, 7);
  const period = periodForKey(key);
  if (period && period.status !== 'open') {
    const err = new Error(`Accounting period ${key} is ${period.status}. Postings are only allowed in open periods.`);
    err.status = 409;
    throw err;
  }
  return period;
}

/**
 * Validate and normalise journal lines.
 * lines: [{ account_id | code, debit, credit, memo?, party_type?, party_id?, property_id? }]
 */
export function normalizeLines(lines) {
  if (!Array.isArray(lines) || lines.length < 2) {
    const err = new Error('A journal needs at least two lines.');
    err.status = 400;
    throw err;
  }
  let debit = 0; let credit = 0;
  const out = [];
  for (const l of lines) {
    const account = l.account_id ? accountById(l.account_id) : (l.code ? accountByCode(l.code) : null);
    if (!account) {
      const err = new Error(`Unknown account: ${l.account_id || l.code || '(missing)'}`);
      err.status = 400;
      throw err;
    }
    const d = round2(l.debit); const c = round2(l.credit);
    if (d < 0 || c < 0) {
      const err = new Error('Debits and credits must be positive amounts.');
      err.status = 400;
      throw err;
    }
    if (d === 0 && c === 0) continue;
    if (d > 0 && c > 0) {
      const err = new Error('A journal line cannot be both a debit and a credit.');
      err.status = 400;
      throw err;
    }
    debit = round2(debit + d); credit = round2(credit + c);
    out.push({
      account_id: account.id, debit: d, credit: c, memo: l.memo || null,
      party_type: l.party_type || null, party_id: l.party_id || null, property_id: l.property_id || null,
    });
  }
  if (out.length < 2) {
    const err = new Error('A journal needs at least two non-zero lines.');
    err.status = 400;
    throw err;
  }
  if (Math.abs(debit - credit) > 0.005) {
    const err = new Error(`Journal does not balance: debits R${debit.toFixed(2)} vs credits R${credit.toFixed(2)}.`);
    err.status = 400;
    throw err;
  }
  return { lines: out, total_debit: debit, total_credit: credit };
}

/** Create a DRAFT journal entry. Caller must be inside a transaction if it is part of a larger operation. */
export function createDraftJournal({ description, entryDate, lines, sourceType = null, sourceId = null, createdBy = null, status = 'draft' }) {
  const cfg = getSetting('finance') || {};
  const { lines: normalized, total_debit, total_credit } = normalizeLines(lines);
  const period = assertPeriodOpen(entryDate);
  const id = newId();
  const ref = nextRef(db, cfg.journal_prefix || 'JV');
  const t = now();
  db.prepare(`
    INSERT INTO journal_entries (id, journal_ref, period_id, entry_date, description, source_type, source_id,
      total_debit, total_credit, status, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, ref, period?.id || null, entryDate, description, sourceType, sourceId,
    total_debit, total_credit, status, createdBy, t, t);
  const ins = db.prepare(`
    INSERT INTO journal_lines (id, entry_id, account_id, debit, credit, memo, party_type, party_id, property_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const l of normalized) ins.run(newId(), id, l.account_id, l.debit, l.credit, l.memo, l.party_type, l.party_id, l.property_id);
  return db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(id);
}

/** Post a draft journal (requires the caller's permission check upstream). */
export function postJournal(journalId, user) {
  const j = db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(journalId);
  if (!j) { const e = new Error('Journal not found.'); e.status = 404; throw e; }
  if (j.status === 'posted') { const e = new Error('This journal is already posted.'); e.status = 409; throw e; }
  if (j.status === 'reversed') { const e = new Error('A reversed journal cannot be posted again.'); e.status = 409; throw e; }
  // re-verify balance from stored lines (authoritative)
  const sums = db.prepare('SELECT ROUND(SUM(debit),2) d, ROUND(SUM(credit),2) c FROM journal_lines WHERE entry_id = ?').get(j.id);
  if (Math.abs((sums.d || 0) - (sums.c || 0)) > 0.005) {
    const e = new Error('Journal does not balance and cannot be posted.');
    e.status = 400; throw e;
  }
  assertPeriodOpen(j.entry_date);
  const t = now();
  db.prepare("UPDATE journal_entries SET status = 'posted', posted_by = ?, posted_at = ?, updated_at = ? WHERE id = ?")
    .run(user?.id || null, t, t, j.id);
  return db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(j.id);
}

/** Reverse a posted journal with a mirror-image entry (audit trail preserved). */
export function reverseJournal(journalId, user, reason) {
  const j = db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(journalId);
  if (!j) { const e = new Error('Journal not found.'); e.status = 404; throw e; }
  if (j.status !== 'posted') { const e = new Error('Only posted journals can be reversed.'); e.status = 409; throw e; }
  if (j.reversed_by) { const e = new Error('This journal has already been reversed.'); e.status = 409; throw e; }

  const srcLines = db.prepare('SELECT * FROM journal_lines WHERE entry_id = ?').all(j.id);
  const reversal = createDraftJournal({
    description: `Reversal of ${j.journal_ref} — ${reason || j.description}`,
    entryDate: new Date().toISOString().slice(0, 10),
    lines: srcLines.map((l) => ({ account_id: l.account_id, debit: l.credit, credit: l.debit, memo: l.memo, party_type: l.party_type, party_id: l.party_id, property_id: l.property_id })),
    sourceType: 'reversal',
    sourceId: j.id,
    createdBy: user?.id || null,
  });
  postJournal(reversal.id, user);
  db.prepare("UPDATE journal_entries SET status = 'reversed', reversed_by = ?, updated_at = ? WHERE id = ?")
    .run(reversal.id, now(), j.id);
  return {
    original: db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(j.id),
    reversal: db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(reversal.id),
  };
}

/** Sum of posted journal lines for an account, optionally within a date range. */
export function accountBalance(accountId, { from = null, to = null, upTo = null } = {}) {
  const where = ["l.account_id = ?", "e.status = 'posted'"];
  const args = [accountId];
  if (from) { where.push('date(e.entry_date) >= date(?)'); args.push(from); }
  if (to) { where.push('date(e.entry_date) <= date(?)'); args.push(to); }
  if (upTo) { where.push('date(e.entry_date) <= date(?)'); args.push(upTo); }
  const row = db.prepare(`
    SELECT COALESCE(SUM(l.debit),0) debit, COALESCE(SUM(l.credit),0) credit
    FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
    WHERE ${where.join(' AND ')}
  `).get(...args);
  return { debit: round2(row.debit), credit: round2(row.credit), balance: round2(row.debit - row.credit) };
}

/** Signed balance in "natural" direction: assets/expenses = debit, others = credit. */
export function naturalBalance(account, opts) {
  const { debit, credit } = accountBalance(account.id, opts);
  const debitNature = account.type === 'asset' || account.type === 'expense';
  return { debit: round2(debit), credit: round2(credit), balance: round2(debitNature ? debit - credit : credit - debit) };
}

export { round2 };
