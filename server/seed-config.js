// ---------------------------------------------------------------------------
// Configuration seed — idempotent, runs at every server start.
//
// This file contains CONFIGURATION ONLY: the chart of accounts, leave policy
// definitions, statutory payroll rules and accounting settings. It never
// creates employees, tenants, suppliers, invoices, payments, journals or any
// other business record. Those come exclusively from real data entered in the
// application.
// Statutory rates below are transcribed from published SARS / RSL sources and
// each row carries its source and effective date.
// ---------------------------------------------------------------------------
import { db, newId, now, tx } from './db.js';
import { getSetting, setSetting } from './util.js';

const SOURCES = {
  sarsIndividuals: 'https://www.sars.gov.za/tax-rates/income-tax/rates-of-tax-for-individuals/',
  sarsUif: 'https://www.sars.gov.za/tax-rates/other-taxes/',
  sarsSdl: 'https://www.sars.gov.za/tax-rates/other-taxes/',
  rsl: 'https://www.rsl.org.ls/PAYE%20Tax%20Calculator',
};

/** Standard chart of accounts for a property / student accommodation business. */
const CHART = [
  // code, name, type, subtype
  ['1000', 'Bank — Operating Account', 'asset', 'bank'],
  ['1005', 'Bank — Savings Account', 'asset', 'bank'],
  ['1010', 'Petty Cash', 'asset', 'cash'],
  ['1100', 'Accounts Receivable (control)', 'asset', 'receivable'],
  ['1150', 'Allowance for Doubtful Accounts', 'asset', 'contra'],
  ['1300', 'Property, Plant & Equipment', 'asset', 'fixed_asset'],
  ['1310', 'Accumulated Depreciation', 'asset', 'contra'],
  ['1400', 'VAT Input (Art 8(1))', 'asset', 'tax'],
  ['1450', 'Prepayments', 'asset', 'current'],
  ['2000', 'Accounts Payable (control)', 'liability', 'payable'],
  ['2100', 'Tenant Deposits Held (refundable)', 'liability', 'deposit'],
  ['2150', 'Accrued Expenses', 'liability', 'current'],
  ['2200', 'PAYE Payable', 'liability', 'statutory'],
  ['2210', 'UIF Payable', 'liability', 'statutory'],
  ['2220', 'SDL Payable', 'liability', 'statutory'],
  ['2300', 'VAT Output (Art 7(1))', 'liability', 'tax'],
  ['2350', 'Income Tax Payable', 'liability', 'statutory'],
  ['3000', 'Owner’s Capital', 'equity', 'capital'],
  ['3100', 'Retained Income', 'equity', 'retained'],
  ['4000', 'Rental Income', 'income', 'operating'],
  ['4010', 'Student Accommodation Income', 'income', 'operating'],
  ['4020', 'Utility Recoveries', 'income', 'operating'],
  ['4030', 'Other Property Income', 'income', 'operating'],
  ['4040', 'Interest & Miscellaneous Income', 'income', 'other'],
  ['5000', 'Salaries & Wages', 'expense', 'payroll'],
  ['5010', 'Employer UIF Contribution', 'expense', 'payroll'],
  ['5020', 'Employer SDL Contribution', 'expense', 'payroll'],
  ['5030', 'Repairs & Maintenance', 'expense', 'property'],
  ['5040', 'Cleaning & Housekeeping', 'expense', 'property'],
  ['5050', 'Utilities — Electricity & Water', 'expense', 'property'],
  ['5060', 'Security', 'expense', 'property'],
  ['5070', 'Internet & Telecommunications', 'expense', 'property'],
  ['5080', 'Property Rates & Taxes', 'expense', 'property'],
  ['5090', 'Insurance', 'expense', 'property'],
  ['5100', 'Office & Administrative Expenses', 'expense', 'admin'],
  ['5110', 'Bank Charges', 'expense', 'admin'],
  ['5120', 'Interest Expense', 'expense', 'finance'],
  ['5130', 'Depreciation', 'expense', 'non_cash'],
  ['5140', 'Marketing & Letting', 'expense', 'admin'],
  ['5150', 'Professional & Legal Fees', 'expense', 'admin'],
  ['5190', 'Miscellaneous Expense', 'expense', 'other'],
];

/** Default leave policy — company-configurable; days are NOT legal advice. */
const LEAVE_TYPES = [
  ['Annual Leave', 'AL', 1, 21, 0, 'Default company entitlement (working days). Adjust to your approved leave policy.', 1],
  ['Sick Leave', 'SL', 1, 30, 1, 'Full-pay sick leave per cycle. Supporting document required by policy.', 2],
  ['Family Responsibility Leave', 'FRL', 1, 3, 1, 'Default 3 days per 12-month cycle — confirm against your policy.', 3],
  ['Maternity Leave', 'ML', 0, 120, 1, 'Unpaid company leave; UIF maternity benefit may be claimed by the employee.', 4],
  ['Parental Leave', 'PL', 0, 10, 1, 'Unpaid company leave — configure to your policy.', 5],
  ['Unpaid Leave', 'UL', 0, 0, 0, 'Deduction from pay is handled by payroll.', 6],
  ['Study Leave', 'STL', 1, 5, 1, 'Company-approved study leave.', 7],
  ['Compassionate Leave', 'CL', 1, 3, 0, 'Bereavement / compassionate leave.', 8],
  ['Other Leave', 'OTH', 0, 0, 0, 'Catch-all category approved case by case.', 9],
];

/**
 * South African statutory payroll rules, 2027 tax year (1 Mar 2026 – 28 Feb 2027),
 * per SARS published tables. Stored with sources and effective dates so the
 * figures can be audited and updated.
 */
function seedPayrollConfig() {
  const existing = db.prepare('SELECT COUNT(*) AS c FROM payroll_deductions_config').get().c;
  if (existing > 0) return;

  const insert = db.prepare(`
    INSERT INTO payroll_deductions_config
      (code, label, kind, rate, threshold, ceiling, employer_rate, active, jurisdiction, effective_from, source, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insert.run('UIF_EMPLOYEE', 'UIF employee contribution', 'statutory', 1, 0, 17712, 1, 1, 'ZA',
    '2021-06-01', SOURCES.sarsUif,
    '1% of remuneration up to a monthly ceiling of R17,712 (max R177.12/month). Employer contributes a matching 1%.');
  insert.run('UIF_EMPLOYER', 'UIF employer contribution', 'employer', 1, 0, 17712, 1, 1, 'ZA',
    '2021-06-01', SOURCES.sarsUif, 'Employer matching 1% up to the same R17,712 monthly ceiling.');
  insert.run('SDL', 'Skills Development Levy', 'employer', 1, 500000, 0, 1, 1, 'ZA',
    '2020-04-01', SOURCES.sarsSdl,
    '1% of total remuneration. Employers paying less than R500,000 annual remuneration are exempt.');
  insert.run('PAYE', 'PAYE — employee tax', 'statutory', 0, 0, 0, 0, 1, 'ZA',
    '2026-03-01', SOURCES.sarsIndividuals,
    'Progressive annual brackets with primary rebate; withheld monthly using the SARS annual-equivalent method. Bracket detail is stored in system_settings.payroll_tax.');
}

function seedPayrollTaxSettings() {
  const current = getSetting('payroll_tax');
  if (current) return;
  // 2027 tax year (1 March 2026 – 28 February 2027) — SARS published rates.
  setSetting('payroll_tax', {
    jurisdiction: 'ZA',
    tax_year: '2027',
    effective_from: '2026-03-01',
    source: SOURCES.sarsIndividuals,
    method: 'annual_equivalent',
    brackets: [
      { up_to: 245100, base: 0, rate: 0.18 },
      { up_to: 383100, base: 44118, rate: 0.26 },
      { up_to: 530200, base: 79998, rate: 0.31 },
      { up_to: 695800, base: 125599, rate: 0.36 },
      { up_to: 887000, base: 185215, rate: 0.39 },
      { up_to: 1878600, base: 259783, rate: 0.41 },
      { up_to: null, base: 666339, rate: 0.45 },
    ],
    rebates: { primary: 17820, secondary: 9765, tertiary: 3249 },
    thresholds: { under65: 99000, age65to74: 153250, age75plus: 171300 },
  });
}

function seedFinanceSettings() {
  if (!getSetting('finance')) {
    setSetting('finance', {
      base_currency: 'ZAR',
      currency_symbol: 'R',
      fiscal_year_start_month: 1, // month 1 = January; change to match the company financial year
      vat_registered: true,
      vat_rate: 0.15,
      vat_number: '',
      tax_number: '',
      company_registration: '',
      approval_thresholds: { expense: 10000, payment: 10000, journal: 50000 },
      invoice_prefix: 'FAR-INV',
      journal_prefix: 'JV',
      ar_terms_days: 30,
      ap_terms_days: 30,
      notes: 'Configure company tax numbers and approval thresholds before use.',
    });
  }
  if (!getSetting('accounting_periods_seeded')) {
    // Open periods for the current calendar year — configuration, not business data.
    const year = new Date().getFullYear();
    for (let m = 1; m <= 12; m++) {
      const key = `${year}-${String(m).padStart(2, '0')}`;
      const start = `${key}-01`;
      const lastDay = new Date(Date.UTC(year, m, 0)).getUTCDate();
      const end = `${key}-${String(lastDay).padStart(2, '0')}`;
      db.prepare('INSERT OR IGNORE INTO accounting_periods (id, period_key, label, start_date, end_date, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(newId(), key, new Date(Date.UTC(year, m - 1, 1)).toLocaleString('en-ZA', { month: 'long', year: 'numeric', timeZone: 'UTC' }), start, end, 'open', now());
    }
    setSetting('accounting_periods_seeded', year, null);
  }
}

export function seedConfig() {
  tx(() => {
    // chart of accounts
    const hasCoa = db.prepare('SELECT COUNT(*) AS c FROM chart_of_accounts').get().c;
    if (hasCoa === 0) {
      const stmt = db.prepare(`
        INSERT INTO chart_of_accounts (id, code, name, type, subtype, system, active, created_at)
        VALUES (?, ?, ?, ?, ?, 1, 1, ?)
      `);
      for (const [code, name, type, subtype] of CHART) stmt.run(newId(), code, name, type, subtype, now());
    }
    // leave policies
    const hasLeave = db.prepare('SELECT COUNT(*) AS c FROM leave_types').get().c;
    if (hasLeave === 0) {
      const stmt = db.prepare(`
        INSERT INTO leave_types (id, name, code, paid, days_per_year, requires_document, description, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const [name, code, paid, days, doc, desc, sort] of LEAVE_TYPES) {
        stmt.run(newId(), name, code, paid, days, doc, desc, sort);
      }
    }
    seedPayrollConfig();
    seedPayrollTaxSettings();
    seedFinanceSettings();
  });
}
