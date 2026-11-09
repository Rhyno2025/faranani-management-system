import { useCallback, useEffect, useState } from 'react';
import { Plus, Search, Check, Banknote } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../auth';
import {
  Field, Input, Select, Textarea, FormGrid, FormActions, Modal, StatusPill, toast, MiniStat, EmptyState,
} from '../../components/ui';
import { DataTable, Column, TableToolbar } from '../../components/DataTable';
import { fmtDate, zar, todayISO } from '../../lib/format';
import type { Paginated, Supplier } from '../../lib/types';

export function Payables() {
  const { can } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 25, total: 0, totalPages: 1 });
  const [selected, setSelected] = useState<string[]>([]);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ supplier_id: '', invoice_number: '', invoice_date: todayISO(), due_date: '', description: '', subtotal: 0, tax: 0 });
  const [payOpen, setPayOpen] = useState(false);
  const [payForm, setPayForm] = useState({ amount: 0, bank_account_id: '', reference: '', paid_at: todayISO() });
  const [accounts, setAccounts] = useState<any[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ page: String(page), pageSize: '25' });
      if (q) p.set('q', q);
      if (status) p.set('status', status);
      const r = await api.get<Paginated<any>>(`/ap/invoices?${p.toString()}`);
      setRows(r.data); setPagination(r.pagination);
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  }, [page, q, status]);

  useEffect(() => { const t = setTimeout(load, q ? 300 : 0); return () => clearTimeout(t); }, [load, q]);
  useEffect(() => {
    api.get<Paginated<Supplier>>('/suppliers?pageSize=300').then((r) => setSuppliers(r.data)).catch(() => {});
    api.get<any>('/bank/accounts').then((r) => setAccounts(r.data)).catch(() => {});
  }, []);

  const openForm = async () => {
    if (!suppliers.length) toast('Add a supplier first (Finance → Suppliers)', 'info');
    setOpen(true);
  };

  const create = async () => {
    if (!form.supplier_id || !form.invoice_number.trim()) { toast('Supplier and invoice number are required', 'error'); return; }
    try {
      const r = await api.post<any>('/ap/invoices', form);
      toast(`Supplier invoice ${r.ap_ref} recorded`); setOpen(false); load();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const approve = async (id: string) => {
    try { const r = await api.post<any>(`/ap/invoices/${id}/approve`); toast(`Approved — draft journal ${r.journal_ref ? '' : ''}created`); load(); }
    catch (e: any) { toast(e.message, 'error'); }
  };

  const openPay = async () => {
    const chosen = rows.filter((r) => selected.includes(r.id));
    if (!chosen.length) { toast('Select invoices to pay', 'error'); return; }
    if (!accounts.length) { toast('Configure a bank account in Finance → Banking first', 'error'); return; }
    const due = chosen.reduce((s, r) => s + (r.total - r.amount_paid), 0);
    setPayForm({ amount: Math.round(due * 100) / 100, bank_account_id: accounts[0].id, reference: '', paid_at: todayISO() });
    setPayOpen(true);
  };

  const pay = async () => {
    try {
      const r = await api.post<any>('/ap/payments', { invoice_ids: selected, ...payForm });
      toast(`Payment ${r.payment_ref} recorded`); setPayOpen(false); setSelected([]); load();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const cols: Column<any>[] = [
    {
      key: 'select', header: '', className: 'w-8',
      render: (r) => ['approved', 'partially_paid'].includes(r.status) && can('finance.approve') ? (
        <input type="checkbox" className="accent-[#B8860B]" aria-label={`Select ${r.ap_ref}`}
          checked={selected.includes(r.id)}
          onChange={(e) => setSelected(e.target.checked ? [...selected, r.id] : selected.filter((x) => x !== r.id))}
          onClick={(e) => e.stopPropagation()} />
      ) : null,
    },
    { key: 'ap_ref', header: 'Ref', render: (r) => <span className="font-mono text-xs font-bold text-gold-dark">{r.ap_ref}</span> },
    { key: 'supplier_name', header: 'Supplier', render: (r) => (
      <div>
        <p className="text-xs font-semibold text-neutral-800">{r.supplier_name}</p>
        <p className="text-[11px] text-neutral-400">{r.invoice_number}</p>
      </div>
    ) },
    { key: 'invoice_date', header: 'Date', render: (r) => <span className="whitespace-nowrap text-xs">{fmtDate(r.invoice_date)}</span> },
    { key: 'due_date', header: 'Due', render: (r) => <span className="whitespace-nowrap text-xs">{fmtDate(r.due_date)}</span> },
    { key: 'total', header: 'Total', render: (r) => <span className="text-xs font-semibold">{zar(r.total, 2)}</span> },
    { key: 'outstanding', header: 'Outstanding', render: (r) => <span className="text-xs text-red-600">{zar(r.total - r.amount_paid, 2)}</span> },
    { key: 'status', header: 'Status', render: (r) => <StatusPill value={r.status} /> },
    {
      key: 'actions', header: '', className: 'text-right',
      render: (r) => can('finance.approve') && r.status === 'pending_approval' ? (
        <button className="btn-ghost !py-1 text-[11px] !text-emerald-600" onClick={(e) => { e.stopPropagation(); approve(r.id); }}>
          <Check size={12} className="mr-0.5 inline" />Approve
        </button>
      ) : null,
    },
  ];

  const outstanding = rows.reduce((s, r) => s + (r.total - r.amount_paid), 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MiniStat label="Supplier invoices" value={pagination.total} />
        <MiniStat label="Awaiting approval" value={rows.filter((r) => r.status === 'pending_approval').length} tone="gold" />
        <MiniStat label="Outstanding (page)" value={zar(outstanding, 2)} tone="red" />
        <MiniStat label="Selected to pay" value={selected.length} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-neutral-500">Segregation of duties: the person who records an invoice cannot approve it or release its payment.</p>
        <div className="flex gap-2">
          {can('finance.approve') && (
            <button className="btn-gold inline-flex items-center gap-1.5" onClick={openPay}><Banknote size={14} /> Pay selected</button>
          )}
          {can('finance.ap') && (
            <button className="btn-ghost inline-flex items-center gap-1.5" onClick={openForm}><Plus size={15} /> Supplier invoice</button>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-line">
        <DataTable
          rows={rows} columns={cols} loading={loading} rowKey={(r) => r.id}
          page={pagination.page} pageSize={pagination.pageSize} total={pagination.total} totalPages={pagination.totalPages}
          onPageChange={setPage}
          emptyTitle="No supplier invoices" emptyHint="Record supplier invoices, approve them (draft journal created), then schedule payment."
          toolbar={
            <TableToolbar>
              <div className="relative min-w-[180px] flex-1">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search supplier or invoice number…" aria-label="Search payables" className="field !py-1.5 !pl-9 text-xs" />
              </div>
              <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status" className="field !w-auto !py-1.5 text-xs">
                <option value="">All statuses</option>
                {['pending_approval', 'approved', 'partially_paid', 'paid', 'void'].map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
              </select>
            </TableToolbar>
          }
        />
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Record supplier invoice" width="max-w-2xl">
        <FormGrid>
          <div className="sm:col-span-2">
            <Field label="Supplier" required>
              <Select value={form.supplier_id} onChange={(e) => setForm({ ...form, supplier_id: e.target.value })}>
                <option value="">Select supplier…</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.supplier_ref} — {s.name}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Supplier invoice number" required><Input value={form.invoice_number} onChange={(e) => setForm({ ...form, invoice_number: e.target.value })} /></Field>
          <Field label="Invoice date"><Input type="date" value={form.invoice_date} onChange={(e) => setForm({ ...form, invoice_date: e.target.value })} /></Field>
          <Field label="Due date"><Input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></Field>
          <div />
          <Field label="Subtotal (excl. VAT)"><Input type="number" step="0.01" value={form.subtotal} onChange={(e) => setForm({ ...form, subtotal: Number(e.target.value) })} /></Field>
          <Field label="VAT"><Input type="number" step="0.01" value={form.tax} onChange={(e) => setForm({ ...form, tax: Number(e.target.value) })} /></Field>
          <div className="sm:col-span-2"><Field label="Description"><Textarea className="!min-h-16" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field></div>
        </FormGrid>
        <p className="mt-2 text-xs font-bold text-neutral-800">Total: {zar(form.subtotal + form.tax, 2)}</p>
        <p className="text-[11px] text-neutral-400">Duplicate invoice numbers for the same supplier are rejected by the database.</p>
        <FormActions>
          <button className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
          <button className="btn-gold" onClick={create}>Record Invoice</button>
        </FormActions>
      </Modal>

      <Modal open={payOpen} onClose={() => setPayOpen(false)} title="Pay selected supplier invoices" width="max-w-lg">
        <FormGrid>
          <Field label="Amount" required><Input type="number" step="0.01" value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: Number(e.target.value) })} /></Field>
          <Field label="Payment date"><Input type="date" value={payForm.paid_at} onChange={(e) => setPayForm({ ...payForm, paid_at: e.target.value })} /></Field>
          <div className="sm:col-span-2">
            <Field label="Bank account" required>
              <Select value={payForm.bank_account_id} onChange={(e) => setPayForm({ ...payForm, bank_account_id: e.target.value })}>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </Select>
            </Field>
          </div>
          <div className="sm:col-span-2"><Field label="Payment reference"><Input value={payForm.reference} onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })} /></Field></div>
        </FormGrid>
        <p className="mt-2 text-[11px] text-neutral-400">Records the payment against the selected invoices and creates a draft journal for posting. It does not initiate a bank transfer.</p>
        <FormActions>
          <button className="btn-ghost" onClick={() => setPayOpen(false)}>Cancel</button>
          <button className="btn-gold" onClick={pay}>Record Payment</button>
        </FormActions>
      </Modal>
    </div>
  );
}
