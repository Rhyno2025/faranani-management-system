import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Plus, Search, Wallet, Receipt, CreditCard, TrendingUp, TrendingDown, CheckCircle2, XCircle, Building2,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../auth';
import {
  PageHeader, Field, Input, Select, Textarea, FormGrid, FormActions, Modal,
  StatusPill, toast, Spinner, MiniStat, Tabs, ConfirmDialog, EmptyState, PanelHeader,
} from '../components/ui';
import { DataTable, Column, TableToolbar } from '../components/DataTable';
import { fmtDate, fmtDateTime, titleCase, zar, todayISO, monthStartISO, monthEndISO } from '../lib/format';
import type { Invoice, Payment, Expense, Supplier, Paginated, Student, Property } from '../lib/types';
import { FinanceDashboard } from './finance/FinanceDashboard';
import { Ledger } from './finance/Ledger';
import { Banking } from './finance/Banking';
import { Budgets } from './finance/Budgets';
import { Payables } from './finance/Payables';
import { FinanceReports } from './finance/FinanceReports';

const EXPENSE_CATEGORIES = ['Repairs & Maintenance', 'Cleaning Supplies', 'Utilities', 'Salaries & Wages', 'Security', 'Internet & Telecoms', 'Property Rates', 'Insurance', 'Office Expenses', 'Other'];
const METHODS = ['eft', 'cash', 'card', 'deposit', 'other'];

/** Tabs driven by their own components (dashboard, ledger, banking…). */
const EXTENDED = new Set(['dashboard', 'ledger', 'banking', 'budgets', 'payables', 'reports']);

type TabKey = 'dashboard' | 'invoices' | 'payments' | 'balances' | 'payables' | 'expenses' | 'suppliers' | 'ledger' | 'banking' | 'budgets' | 'reports';

export default function Finance() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<TabKey>(() => {
    const t = (params.get('tab') as TabKey) || 'dashboard';
    return t;
  });
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 15, total: 0, totalPages: 1 });
  const [filters, setFilters] = useState({ status: '', from: monthStartISO(), to: monthEndISO() });

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [balances, setBalances] = useState<{ data: any[]; total_outstanding: number } | null>(null);
  const [properties, setProperties] = useState<Property[]>([]);
  const [students, setStudents] = useState<Student[]>([]);

  const [invOpen, setInvOpen] = useState(false);
  const [invForm, setInvForm] = useState({ student_id: '', issue_date: todayISO(), due_date: todayISO(), notes: '', items: [{ description: 'Accommodation', category: 'Accommodation', quantity: 1, unit_price: 4800 }] });
  const [payOpen, setPayOpen] = useState(false);
  const [payForm, setPayForm] = useState({ student_id: '', amount: 0, method: 'eft', reference: '', paid_at: todayISO(), notes: '', allocate: true });
  const [expOpen, setExpOpen] = useState(false);
  const [expForm, setExpForm] = useState({ category: 'Repairs & Maintenance', description: '', amount: 0, incurred_date: todayISO(), property_id: '', supplier_id: '', auto_approve: false });
  const [supOpen, setSupOpen] = useState(false);
  const [supForm, setSupForm] = useState({ name: '', contact_person: '', email: '', phone: '', category: '' });
  const [detail, setDetail] = useState<(Invoice & any) | null>(null);
  const [voidTarget, setVoidTarget] = useState<Invoice | null>(null);

  const load = useCallback(async () => {
    if (EXTENDED.has(tab)) { setLoading(false); return; }
    setLoading(true);
    try {
      const base = new URLSearchParams({ page: String(page), pageSize: '15' });
      if (q) base.set('q', q);
      if (filters.status) base.set('status', filters.status);
      if (filters.from) base.set('from', filters.from);
      if (filters.to) base.set('to', filters.to);
      if (tab === 'invoices') {
        const r = await api.get<Paginated<Invoice>>(`/invoices?${base.toString()}`); setInvoices(r.data); setPagination(r.pagination);
      } else if (tab === 'payments') {
        const r = await api.get<Paginated<Payment>>(`/payments?${base.toString()}`); setPayments(r.data); setPagination(r.pagination);
      } else if (tab === 'expenses') {
        const r = await api.get<Paginated<Expense>>(`/expenses?${base.toString()}`); setExpenses(r.data); setPagination(r.pagination);
      } else if (tab === 'suppliers') {
        const r = await api.get<Paginated<Supplier>>(`/suppliers?${base.toString()}`); setSuppliers(r.data); setPagination(r.pagination);
      } else {
        const r = await api.get<{ data: any[]; total_outstanding: number }>('/balances'); setBalances(r);
        setPagination((p) => ({ ...p, total: r.data.length, totalPages: 1 }));
      }
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  }, [tab, page, q, filters]);

  useEffect(() => { const t = setTimeout(load, q ? 300 : 0); return () => clearTimeout(t); }, [load, q]);
  useEffect(() => {
    api.get<Paginated<Property>>('/properties?pageSize=100').then((r) => setProperties(r.data)).catch(() => {});
  }, []);

  const loadStudents = async () => {
    try {
      const r = await api.get<Paginated<Student>>('/students?pageSize=500');
      setStudents(r.data);
    } catch { setStudents([]); }
  };

  const submitInvoice = async () => {
    if (!invForm.student_id) { toast('Select a student', 'error'); return; }
    const items = invForm.items.filter((i) => i.description.trim());
    if (!items.length) { toast('Add at least one invoice line', 'error'); return; }
    try {
      const r = await api.post<Invoice>('/invoices', invForm);
      toast(`Invoice ${r.invoice_ref} issued`);
      setInvOpen(false); load();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const submitPayment = async () => {
    if (!payForm.student_id || payForm.amount <= 0) { toast('Student and a positive amount are required', 'error'); return; }
    try {
      const r = await api.post<{ payment_ref: string }>('/payments', payForm);
      toast(`Payment ${r.payment_ref} recorded`);
      setPayOpen(false); load();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const submitExpense = async () => {
    if (!expForm.description.trim() || expForm.amount <= 0) { toast('Description and amount are required', 'error'); return; }
    try {
      const r = await api.post<Expense>('/expenses', expForm);
      toast(`Expense ${r.expense_ref} recorded`);
      setExpOpen(false); load();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const submitSupplier = async () => {
    if (!supForm.name.trim()) { toast('Supplier name is required', 'error'); return; }
    try {
      const r = await api.post<Supplier>('/suppliers', supForm);
      toast(`Supplier ${r.supplier_ref} added`);
      setSupOpen(false); setSupForm({ name: '', contact_person: '', email: '', phone: '', category: '' }); load();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const expenseAction = async (e: Expense, action: 'approve' | 'reject' | 'pay') => {
    try {
      if (action === 'pay') await api.post(`/expenses/${e.id}/pay`);
      else await api.post(`/expenses/${e.id}/approve`, { decision: action === 'approve' ? 'approve' : 'reject' });
      toast(action === 'approve' ? 'Approved' : action === 'reject' ? 'Rejected' : 'Marked paid');
      load();
    } catch (err: any) { toast(err.message, 'error'); }
  };

  const voidInvoice = async () => {
    if (!voidTarget) return;
    try { await api.post(`/invoices/${voidTarget.id}/void`); toast('Invoice voided'); setVoidTarget(null); load(); } catch (e: any) { toast(e.message, 'error'); }
  };

  const openDetail = async (id: string) => {
    try { setDetail(await api.get<Invoice & any>(`/invoices/${id}`)); } catch (e: any) { toast(e.message, 'error'); }
  };

  const invCols: Column<Invoice>[] = [
    { key: 'invoice_ref', header: 'Invoice', render: (i) => <span className="font-mono text-xs font-bold text-gold-dark">{i.invoice_ref}</span> },
    { key: 'student', header: 'Student', render: (i) => <span className="text-xs font-medium text-neutral-700">{i.student_name} <span className="text-neutral-400">({i.student_ref})</span></span> },
    { key: 'issue_date', header: 'Issued', render: (i) => <span className="whitespace-nowrap text-xs">{fmtDate(i.issue_date)}</span> },
    { key: 'due_date', header: 'Due', render: (i) => <span className={`whitespace-nowrap text-xs ${i.status === 'overdue' ? 'font-semibold text-red-600' : ''}`}>{fmtDate(i.due_date)}</span> },
    { key: 'total', header: 'Total', render: (i) => <span className="text-xs font-semibold">{zar(i.total, 2)}</span> },
    { key: 'paid', header: 'Paid', render: (i) => <span className="text-xs text-emerald-600">{zar(i.paid, 2)}</span> },
    { key: 'due', header: 'Balance', render: (i) => <span className="text-xs font-semibold text-red-600">{zar(i.due, 2)}</span> },
    { key: 'status', header: 'Status', render: (i) => <StatusPill value={i.status} /> },
  ];

  const payCols: Column<Payment>[] = [
    { key: 'payment_ref', header: 'Payment', render: (p) => <span className="font-mono text-xs font-bold text-gold-dark">{p.payment_ref}</span> },
    { key: 'student', header: 'Student', render: (p) => <span className="text-xs font-medium text-neutral-700">{p.student_name} <span className="text-neutral-400">({p.student_ref})</span></span> },
    { key: 'amount', header: 'Amount', render: (p) => <span className="text-xs font-semibold text-emerald-600">{zar(p.amount, 2)}</span> },
    { key: 'method', header: 'Method', render: (p) => <span className="pill bg-neutral-100 uppercase text-neutral-600">{p.method}</span> },
    { key: 'reference', header: 'Reference', render: (p) => <span className="text-xs text-neutral-600">{p.reference || '—'}</span> },
    { key: 'paid_at', header: 'Date', render: (p) => <span className="whitespace-nowrap text-xs">{fmtDateTime(p.paid_at)}</span> },
    { key: 'recorded_by', header: 'Recorded by', render: (p) => <span className="text-xs text-neutral-600">{p.recorded_by_name || '—'}</span> },
    { key: 'status', header: 'Status', render: (p) => <StatusPill value={p.status} /> },
  ];

  const expCols: Column<Expense>[] = [
    { key: 'expense_ref', header: 'Ref', render: (e) => <span className="font-mono text-xs font-bold text-gold-dark">{e.expense_ref}</span> },
    { key: 'description', header: 'Description', render: (e) => <span className="text-xs font-medium text-neutral-700">{e.description}</span> },
    { key: 'category', header: 'Category', render: (e) => <span className="text-xs text-neutral-600">{e.category}</span> },
    { key: 'property', header: 'Property', render: (e) => <span className="text-xs text-neutral-600">{e.property_name || '—'}</span> },
    { key: 'supplier', header: 'Supplier', render: (e) => <span className="text-xs text-neutral-600">{e.supplier_name || '—'}</span> },
    { key: 'incurred_date', header: 'Date', render: (e) => <span className="whitespace-nowrap text-xs">{fmtDate(e.incurred_date)}</span> },
    { key: 'amount', header: 'Amount', render: (e) => <span className="text-xs font-semibold">{zar(e.amount, 2)}</span> },
    { key: 'status', header: 'Status', render: (e) => <StatusPill value={e.status} /> },
    {
      key: 'actions', header: '', className: 'text-right',
      render: (e) => can('finance.manage') && e.status === 'pending' && (
        <div className="flex justify-end gap-1">
          <button className="btn-ghost !py-1 text-[11px]" onClick={(ev) => { ev.stopPropagation(); expenseAction(e, 'approve'); }}>Approve</button>
          <button className="btn-ghost !py-1 text-[11px] hover:!text-red-600" onClick={(ev) => { ev.stopPropagation(); expenseAction(e, 'reject'); }}>Reject</button>
        </div>
      ),
    },
  ];

  const supCols: Column<Supplier>[] = [
    { key: 'supplier_ref', header: 'Ref', render: (s) => <span className="font-mono text-xs font-bold text-gold-dark">{s.supplier_ref}</span> },
    { key: 'name', header: 'Supplier', render: (s) => <span className="text-xs font-medium text-neutral-800">{s.name}</span> },
    { key: 'contact_person', header: 'Contact', render: (s) => <span className="text-xs text-neutral-600">{s.contact_person || '—'}</span> },
    { key: 'email', header: 'Email', render: (s) => <span className="text-xs text-neutral-600">{s.email || '—'}</span> },
    { key: 'phone', header: 'Phone', render: (s) => <span className="text-xs text-neutral-600">{s.phone || '—'}</span> },
    { key: 'category', header: 'Category', render: (s) => <span className="text-xs text-neutral-600">{s.category || '—'}</span> },
    { key: 'status', header: 'Status', render: (s) => <StatusPill value={s.status} /> },
  ];

  const balCols: Column<any>[] = [
    { key: 'student_ref', header: 'Student', render: (b) => <span className="text-xs font-medium text-neutral-700">{b.full_name} <span className="text-neutral-400">({b.student_ref})</span></span> },
    { key: 'property', header: 'Property', render: (b) => <span className="text-xs text-neutral-600">{b.property_name || '—'}</span> },
    { key: 'invoiced', header: 'Invoiced', render: (b) => <span className="text-xs">{zar(b.invoiced, 2)}</span> },
    { key: 'paid', header: 'Paid', render: (b) => <span className="text-xs text-emerald-600">{zar(b.paid, 2)}</span> },
    {
      key: 'balance', header: 'Balance',
      render: (b) => <span className={`text-xs font-bold ${b.balance > 0 ? 'text-red-600' : b.balance < 0 ? 'text-sky-600' : 'text-emerald-600'}`}>{zar(b.balance, 2)}</span>,
    },
    { key: 'status', header: 'Status', render: (b) => <StatusPill value={b.balance > 0 ? 'overdue' : b.balance < 0 ? 'draft' : 'paid'} label={b.balance > 0 ? 'Outstanding' : b.balance < 0 ? 'Credit' : 'Settled'} /> },
  ];

  const summary = useMemo(() => {
    const paid = (payments || []).reduce((s, p) => s + Number(p.amount || 0), 0);
    const spent = (expenses || []).filter((e) => e.status !== 'rejected').reduce((s, e) => s + Number(e.amount || 0), 0);
    return { paid, spent };
  }, [payments, expenses]);

  const rows = tab === 'invoices' ? invoices : tab === 'payments' ? payments : tab === 'expenses' ? expenses : tab === 'suppliers' ? suppliers : (balances?.data || []);

  return (
    <div>
      <PageHeader
        title="Finance & Accounting"
        subtitle="Double-entry ledger, receivables, payables, banking, budgets and financial reporting — every figure traceable to posted records."
        actions={!EXTENDED.has(tab) && can('finance.manage') && (
          <>
            <button className="btn-ghost inline-flex items-center gap-1.5" onClick={() => { setPayOpen(true); loadStudents(); }}>
              <CreditCard size={14} /> Record Payment
            </button>
            <button className="btn-gold inline-flex items-center gap-1.5" onClick={() => { setInvOpen(true); loadStudents(); }}>
              <Plus size={15} /> New Invoice
            </button>
          </>
        )}
      />

      {!EXTENDED.has(tab) && (
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MiniStat label="Invoiced (period)" value={zar(invoices.reduce((s, i) => s + Number(i.total || 0), 0), 2)} tone="gold" />
        <MiniStat label="Payments (period)" value={zar(summary.paid, 2)} tone="green" />
        <MiniStat label="Expenses (period)" value={zar(summary.spent, 2)} tone="red" />
        <MiniStat label="Outstanding" value={zar(balances?.total_outstanding || 0, 2)} tone="red" />
      </div>
      )}

      <div className="panel overflow-hidden">
        <div className="border-b border-line px-4 pt-2">
          <Tabs active={tab} onChange={(k) => { setTab(k as any); setPage(1); }} tabs={[
            { key: 'dashboard', label: 'Dashboard' },
            { key: 'invoices', label: 'Invoices (AR)', count: pagination.total },
            { key: 'payments', label: 'Payments' },
            { key: 'balances', label: 'Student Balances' },
            { key: 'payables', label: 'Payables (AP)' },
            { key: 'expenses', label: 'Expenses' },
            { key: 'suppliers', label: 'Suppliers' },
            { key: 'ledger', label: 'Ledger' },
            { key: 'banking', label: 'Banking' },
            { key: 'budgets', label: 'Budgets' },
            { key: 'reports', label: 'Reports' },
          ]} />
        </div>

        {EXTENDED.has(tab) && (
          <div className="pt-4">
            {tab === 'dashboard' && <FinanceDashboard />}
            {tab === 'ledger' && <Ledger />}
            {tab === 'banking' && <Banking />}
            {tab === 'budgets' && <Budgets />}
            {tab === 'payables' && <Payables />}
            {tab === 'reports' && <FinanceReports />}
          </div>
        )}

        {!EXTENDED.has(tab) && (
        <>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
          {tab !== 'balances' && (
            <div className="relative min-w-[180px] flex-1">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
              <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search…" aria-label="Search" className="field !py-1.5 !pl-9 text-xs" />
            </div>
          )}
          {(tab === 'invoices' || tab === 'payments' || tab === 'expenses') && (
            <>
              <input type="date" aria-label="From date" className="field !w-auto !py-1.5 text-xs" value={filters.from} onChange={(e) => { setFilters({ ...filters, from: e.target.value }); setPage(1); }} />
              <input type="date" aria-label="To date" className="field !w-auto !py-1.5 text-xs" value={filters.to} onChange={(e) => { setFilters({ ...filters, to: e.target.value }); setPage(1); }} />
            </>
          )}
          {tab === 'invoices' && (
            <select aria-label="Status" className="field !w-auto !py-1.5 text-xs" value={filters.status} onChange={(e) => { setFilters({ ...filters, status: e.target.value }); setPage(1); }}>
              <option value="">All Statuses</option>
              {['issued', 'partially_paid', 'paid', 'overdue', 'void'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
            </select>
          )}
          {tab === 'expenses' && (
            <>
              <select aria-label="Status" className="field !w-auto !py-1.5 text-xs" value={filters.status} onChange={(e) => { setFilters({ ...filters, status: e.target.value }); setPage(1); }}>
                <option value="">All Statuses</option>
                {['pending', 'approved', 'rejected', 'paid'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
              </select>
              {can('finance.manage') && (
                <button className="btn-ghost !py-1.5 text-xs" onClick={() => setExpOpen(true)}>+ Expense</button>
              )}
            </>
          )}
          {tab === 'suppliers' && can('finance.manage') && (
            <button className="btn-ghost !py-1.5 text-xs" onClick={() => setSupOpen(true)}>+ Supplier</button>
          )}
        </div>

        {tab === 'invoices' && (
          <DataTable rows={invoices} columns={invCols} loading={loading} rowKey={(i) => i.id} onRowClick={(i) => openDetail(i.id)}
            page={pagination.page} pageSize={pagination.pageSize} total={pagination.total} totalPages={pagination.totalPages} onPageChange={setPage}
            emptyTitle="No invoices in this period" emptyHint="Issue an invoice to start tracking student balances." />
        )}
        {tab === 'payments' && (
          <DataTable rows={payments} columns={payCols} loading={loading} rowKey={(p) => p.id}
            page={pagination.page} pageSize={pagination.pageSize} total={pagination.total} totalPages={pagination.totalPages} onPageChange={setPage}
            emptyTitle="No payments recorded" emptyHint="Record a payment (EFT, cash, card) to allocate it against invoices." />
        )}
        {tab === 'expenses' && (
          <DataTable rows={expenses} columns={expCols} loading={loading} rowKey={(e) => e.id}
            page={pagination.page} pageSize={pagination.pageSize} total={pagination.total} totalPages={pagination.totalPages} onPageChange={setPage}
            emptyTitle="No expenses recorded" emptyHint="Track operating expenses and route them for approval." />
        )}
        {tab === 'suppliers' && (
          <DataTable rows={suppliers} columns={supCols} loading={loading} rowKey={(s) => s.id}
            page={pagination.page} pageSize={pagination.pageSize} total={pagination.total} totalPages={pagination.totalPages} onPageChange={setPage}
            emptyTitle="No suppliers yet" emptyHint="Add suppliers to link them against expenses." />
        )}
        {tab === 'balances' && (
          <DataTable rows={balances?.data || []} columns={balCols} loading={loading} rowKey={(b) => b.id}
            emptyTitle="No student accounts" emptyHint="Balances appear once invoices are issued." />
        )}
        </>
        )}
      </div>

      {/* invoice detail */}
      <Modal open={Boolean(detail)} onClose={() => setDetail(null)} title={detail ? `${detail.invoice_ref} — ${detail.student_name}` : ''} width="max-w-2xl">
        {detail && (
          <div>
            <div className="mb-3.5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <MiniStat label="Status" value={<StatusPill value={detail.status} />} />
              <MiniStat label="Issued" value={fmtDate(detail.issue_date)} />
              <MiniStat label="Due" value={fmtDate(detail.due_date)} />
              <MiniStat label="Total" value={zar(detail.total, 2)} tone="gold" />
            </div>
            <table className="data-table">
              <thead><tr><th>Line</th><th>Category</th><th className="text-right">Qty</th><th className="text-right">Unit</th><th className="text-right">Amount</th></tr></thead>
              <tbody>
                {(detail.items || []).map((it: any) => (
                  <tr key={it.id}>
                    <td className="text-xs">{it.description}</td>
                    <td className="text-xs text-neutral-500">{it.category}</td>
                    <td className="text-right text-xs">{it.quantity}</td>
                    <td className="text-right text-xs">{zar(it.unit_price, 2)}</td>
                    <td className="text-right text-xs font-semibold">{zar(it.amount, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-3 rounded-lg border border-line px-3.5 py-2.5 text-sm">
              <div className="flex justify-between"><span className="text-neutral-500">Subtotal</span><span className="font-semibold">{zar(detail.subtotal, 2)}</span></div>
              <div className="flex justify-between"><span className="text-neutral-500">Paid</span><span className="font-semibold text-emerald-600">{zar(detail.paid, 2)}</span></div>
              <div className="flex justify-between"><span className="text-neutral-500">Balance due</span><span className="font-bold text-red-600">{zar(detail.due, 2)}</span></div>
            </div>
            {(detail.allocations || []).length > 0 && (
              <div className="mt-3 rounded-lg border border-line">
                <p className="border-b border-line px-3.5 py-2 text-xs font-bold uppercase tracking-wide text-neutral-500">Payments allocated</p>
                {detail.allocations.map((a: any) => (
                  <div key={a.id} className="flex items-center justify-between px-3.5 py-1.5 text-xs">
                    <span className="text-neutral-600">{a.payment_ref} · {a.method} · {fmtDate(a.paid_at)}</span>
                    <span className="font-semibold">{zar(a.amount, 2)}</span>
                  </div>
                ))}
              </div>
            )}
            <FormActions>
              <button className="btn-ghost" onClick={() => setDetail(null)}>Close</button>
              {can('finance.manage') && detail.status !== 'void' && (
                <button className="btn-ghost !text-red-600" onClick={() => { setVoidTarget(detail); setDetail(null); }}>Void Invoice</button>
              )}
            </FormActions>
          </div>
        )}
      </Modal>

      {/* new invoice */}
      <Modal open={invOpen} onClose={() => setInvOpen(false)} title="New invoice" width="max-w-3xl">
        <FormGrid>
          <Field label="Student" required>
            <Select value={invForm.student_id} onChange={(e) => setInvForm({ ...invForm, student_id: e.target.value })}>
              <option value="">Select student…</option>
              {students.map((s) => <option key={s.id} value={s.id}>{s.student_ref} — {s.full_name}</option>)}
            </Select>
          </Field>
          <div />
          <Field label="Issue date"><Input type="date" value={invForm.issue_date} onChange={(e) => setInvForm({ ...invForm, issue_date: e.target.value })} /></Field>
          <Field label="Due date"><Input type="date" value={invForm.due_date} onChange={(e) => setInvForm({ ...invForm, due_date: e.target.value })} /></Field>
        </FormGrid>

        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-wide text-neutral-500">Invoice lines</p>
            <button className="btn-ghost !py-1 text-xs" onClick={() => setInvForm({ ...invForm, items: [...invForm.items, { description: '', category: 'Accommodation', quantity: 1, unit_price: 0 }] })}>
              <Plus size={12} className="mr-1 inline" />Add Line
            </button>
          </div>
          <div className="space-y-2">
            {invForm.items.map((it, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2">
                <input className="field col-span-5 !py-1.5 text-xs" placeholder="Description" value={it.description}
                  onChange={(e) => { const items = [...invForm.items]; items[idx] = { ...it, description: e.target.value }; setInvForm({ ...invForm, items }); }} />
                <select className="field col-span-3 !py-1.5 text-xs" value={it.category}
                  onChange={(e) => { const items = [...invForm.items]; items[idx] = { ...it, category: e.target.value }; setInvForm({ ...invForm, items }); }}>
                  {['Accommodation', 'Registration', 'Utilities', 'Laundry', 'Damage', 'Other'].map((c) => <option key={c}>{c}</option>)}
                </select>
                <input type="number" min={1} className="field col-span-1 !py-1.5 text-xs" value={it.quantity}
                  onChange={(e) => { const items = [...invForm.items]; items[idx] = { ...it, quantity: Number(e.target.value) }; setInvForm({ ...invForm, items }); }} />
                <input type="number" min={0} step={0.01} className="field col-span-2 !py-1.5 text-xs" value={it.unit_price}
                  onChange={(e) => { const items = [...invForm.items]; items[idx] = { ...it, unit_price: Number(e.target.value) }; setInvForm({ ...invForm, items }); }} />
                <button className="col-span-1 rounded p-1.5 text-neutral-400 hover:text-red-600" aria-label="Remove line"
                  onClick={() => setInvForm({ ...invForm, items: invForm.items.filter((_, i) => i !== idx) })}>
                  <XCircle size={14} />
                </button>
              </div>
            ))}
          </div>
          <p className="mt-2 text-right text-sm font-bold text-neutral-800">
            Total: {zar(invForm.items.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.unit_price) || 0), 0), 2)}
          </p>
        </div>

        <div className="mt-3.5">
          <Field label="Notes"><Textarea value={invForm.notes} onChange={(e) => setInvForm({ ...invForm, notes: e.target.value })} className="!min-h-16" /></Field>
        </div>
        <FormActions>
          <button className="btn-ghost" onClick={() => setInvOpen(false)}>Cancel</button>
          <button className="btn-gold" onClick={submitInvoice}>Issue Invoice</button>
        </FormActions>
      </Modal>

      {/* record payment */}
      <Modal open={payOpen} onClose={() => setPayOpen(false)} title="Record payment" width="max-w-lg">
        <FormGrid>
          <div className="sm:col-span-2">
            <Field label="Student" required>
              <Select value={payForm.student_id} onChange={(e) => setPayForm({ ...payForm, student_id: e.target.value })}>
                <option value="">Select student…</option>
                {students.map((s) => <option key={s.id} value={s.id}>{s.student_ref} — {s.full_name}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Amount (ZAR)" required>
            <Input type="number" min={0} step={0.01} value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: Number(e.target.value) })} />
          </Field>
          <Field label="Method">
            <Select value={payForm.method} onChange={(e) => setPayForm({ ...payForm, method: e.target.value })}>
              {METHODS.map((m) => <option key={m} value={m}>{m.toUpperCase()}</option>)}
            </Select>
          </Field>
          <Field label="Bank reference"><Input value={payForm.reference} onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })} /></Field>
          <Field label="Date"><Input type="date" value={payForm.paid_at} onChange={(e) => setPayForm({ ...payForm, paid_at: e.target.value })} /></Field>
        </FormGrid>
        <label className="mt-3 flex items-center gap-2 text-xs text-neutral-600">
          <input type="checkbox" checked={payForm.allocate} onChange={(e) => setPayForm({ ...payForm, allocate: e.target.checked })} className="accent-[#B8860B]" />
          Allocate automatically to the oldest outstanding invoices (FIFO)
        </label>
        <FormActions>
          <button className="btn-ghost" onClick={() => setPayOpen(false)}>Cancel</button>
          <button className="btn-gold" onClick={submitPayment}>Record Payment</button>
        </FormActions>
      </Modal>

      {/* expense */}
      <Modal open={expOpen} onClose={() => setExpOpen(false)} title="Record expense" width="max-w-xl">
        <FormGrid>
          <div className="sm:col-span-2">
            <Field label="Description" required>
              <Input value={expForm.description} onChange={(e) => setExpForm({ ...expForm, description: e.target.value })} placeholder="Plumbing repairs — Block B" autoFocus />
            </Field>
          </div>
          <Field label="Category">
            <Select value={expForm.category} onChange={(e) => setExpForm({ ...expForm, category: e.target.value })}>
              {EXPENSE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </Select>
          </Field>
          <Field label="Amount (ZAR)" required>
            <Input type="number" min={0} step={0.01} value={expForm.amount} onChange={(e) => setExpForm({ ...expForm, amount: Number(e.target.value) })} />
          </Field>
          <Field label="Date"><Input type="date" value={expForm.incurred_date} onChange={(e) => setExpForm({ ...expForm, incurred_date: e.target.value })} /></Field>
          <Field label="Property">
            <Select value={expForm.property_id} onChange={(e) => setExpForm({ ...expForm, property_id: e.target.value })}>
              <option value="">Company-wide</option>
              {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
        </FormGrid>
        <label className="mt-3 flex items-center gap-2 text-xs text-neutral-600">
          <input type="checkbox" checked={expForm.auto_approve} onChange={(e) => setExpForm({ ...expForm, auto_approve: e.target.checked })} className="accent-[#B8860B]" />
          Record as pre-approved (finance officer only)
        </label>
        <FormActions>
          <button className="btn-ghost" onClick={() => setExpOpen(false)}>Cancel</button>
          <button className="btn-gold" onClick={submitExpense}>Record Expense</button>
        </FormActions>
      </Modal>

      {/* supplier */}
      <Modal open={supOpen} onClose={() => setSupOpen(false)} title="Add supplier" width="max-w-lg">
        <FormGrid>
          <div className="sm:col-span-2"><Field label="Name" required><Input value={supForm.name} onChange={(e) => setSupForm({ ...supForm, name: e.target.value })} autoFocus /></Field></div>
          <Field label="Contact person"><Input value={supForm.contact_person} onChange={(e) => setSupForm({ ...supForm, contact_person: e.target.value })} /></Field>
          <Field label="Category"><Input value={supForm.category} onChange={(e) => setSupForm({ ...supForm, category: e.target.value })} placeholder="Plumbing supplies" /></Field>
          <Field label="Email"><Input type="email" value={supForm.email} onChange={(e) => setSupForm({ ...supForm, email: e.target.value })} /></Field>
          <Field label="Phone"><Input value={supForm.phone} onChange={(e) => setSupForm({ ...supForm, phone: e.target.value })} /></Field>
        </FormGrid>
        <FormActions>
          <button className="btn-ghost" onClick={() => setSupOpen(false)}>Cancel</button>
          <button className="btn-gold" onClick={submitSupplier}>Add Supplier</button>
        </FormActions>
      </Modal>

      <ConfirmDialog open={Boolean(voidTarget)} onClose={() => setVoidTarget(null)} onConfirm={voidInvoice}
        title="Void invoice?" message={`This voids ${voidTarget?.invoice_ref}. Any allocations stay recorded but the invoice no longer counts toward balances.`} confirmLabel="Void Invoice" />
    </div>
  );
}
