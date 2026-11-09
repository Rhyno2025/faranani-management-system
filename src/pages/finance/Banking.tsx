import { useCallback, useEffect, useState } from 'react';
import { Plus, Search, Check, Upload, Undo2 } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../auth';
import {
  Field, Input, Select, Textarea, FormGrid, FormActions, Modal, StatusPill, toast, MiniStat, EmptyState,
} from '../../components/ui';
import { DataTable, Column, TableToolbar } from '../../components/DataTable';
import { fmtDate, zar, titleCase } from '../../lib/format';
import type { Paginated } from '../../lib/types';

export function Banking() {
  const { can } = useAuth();
  const [accounts, setAccounts] = useState<any[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 25, total: 0, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [accountId, setAccountId] = useState('');
  const [showAll, setShowAll] = useState(false);

  const [acctOpen, setAcctOpen] = useState(false);
  const [acctForm, setAcctForm] = useState({ name: '', bank_name: '', account_number: '', account_type: 'bank', opening_balance: 0, opening_date: new Date().toISOString().slice(0, 10) });
  const [txnOpen, setTxnOpen] = useState(false);
  const [txnForm, setTxnForm] = useState({ bank_account_id: '', txn_date: new Date().toISOString().slice(0, 10), description: '', reference: '', amount: 0 });
  const [importOpen, setImportOpen] = useState(false);
  const [importForm, setImportForm] = useState({ bank_account_id: '', text: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setAccounts((await api.get<any>('/bank/accounts')).data);
      const p = new URLSearchParams({ page: String(page), pageSize: '25' });
      if (q) p.set('q', q);
      if (accountId) p.set('bank_account_id', accountId);
      if (!showAll) p.set('status', 'unmatched');
      const r = await api.get<Paginated<any>>(`/bank/transactions?${p.toString()}`);
      setRows(r.data); setPagination(r.pagination);
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  }, [page, q, accountId, showAll]);

  useEffect(() => { const t = setTimeout(load, q ? 300 : 0); return () => clearTimeout(t); }, [load, q]);

  const saveAccount = async () => {
    if (!acctForm.name.trim()) { toast('Account name is required', 'error'); return; }
    try { await api.post('/bank/accounts', acctForm); toast('Bank account added'); setAcctOpen(false); load(); }
    catch (e: any) { toast(e.message, 'error'); }
  };

  const saveTxn = async () => {
    if (!txnForm.bank_account_id || !txnForm.description) { toast('Account and description are required', 'error'); return; }
    try { await api.post('/bank/transactions', txnForm); toast('Transaction recorded'); setTxnOpen(false); load(); }
    catch (e: any) { toast(e.message, 'error'); }
  };

  const runImport = async () => {
    if (!importForm.bank_account_id) { toast('Select a bank account', 'error'); return; }
    const lines = importForm.text.split('\n').map((l) => l.trim()).filter(Boolean);
    const parsed = lines.map((line) => {
      const [date, description, reference, amount] = line.split(',').map((s) => (s || '').trim());
      return { date, description, reference, amount: Number(String(amount || '').replace(/[^0-9.-]/g, '')) };
    }).filter((r) => r.date && Number.isFinite(r.amount));
    if (!parsed.length) { toast('No valid rows. Use: YYYY-MM-DD, description, reference, amount', 'error'); return; }
    try {
      const r = await api.post<any>('/bank/transactions/import', { bank_account_id: importForm.bank_account_id, rows: parsed, file_name: 'pasted-statement' });
      toast(`Imported ${r.imported} transaction(s), skipped ${r.duplicates} duplicate(s)`);
      setImportOpen(false); setImportForm({ bank_account_id: '', text: '' }); load();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const reconcile = async (id: string, action: 'reconcile' | 'unreconcile') => {
    try { await api.post(`/bank/transactions/${id}/reconcile`, { action }); toast(action === 'reconcile' ? 'Marked reconciled' : 'Moved back to unmatched'); load(); }
    catch (e: any) { toast(e.message, 'error'); }
  };

  const cols: Column<any>[] = [
    { key: 'txn_date', header: 'Date', render: (t) => <span className="whitespace-nowrap text-xs">{fmtDate(t.txn_date)}</span> },
    { key: 'description', header: 'Description', render: (t) => (
      <div>
        <p className="text-xs font-medium text-neutral-800">{t.description}</p>
        <p className="text-[11px] text-neutral-400">{t.bank_account_name}{t.reference ? ` · ${t.reference}` : ''}</p>
      </div>
    ) },
    { key: 'amount', header: 'Amount', render: (t) => (
      <span className={`text-xs font-semibold ${t.amount >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{zar(t.amount, 2)}</span>
    ) },
    { key: 'source', header: 'Source', render: (t) => <span className="pill bg-neutral-100 text-neutral-600">{titleCase(t.source)}</span> },
    { key: 'status', header: 'Status', render: (t) => <StatusPill value={t.status === 'reconciled' ? 'reconciled' : 'pending'} label={titleCase(t.status)} /> },
    {
      key: 'actions', header: '', className: 'text-right',
      render: (t) => can('finance.banking') && (
        t.status === 'reconciled'
          ? <button className="btn-ghost !py-1 text-[11px]" onClick={(e) => { e.stopPropagation(); reconcile(t.id, 'unreconcile'); }}><Undo2 size={12} className="mr-0.5 inline" />Undo</button>
          : <button className="btn-ghost !py-1 text-[11px] !text-emerald-600" onClick={(e) => { e.stopPropagation(); reconcile(t.id, 'reconcile'); }}><Check size={12} className="mr-0.5 inline" />Reconcile</button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {accounts.map((a) => (
          <div key={a.id} className={`rounded-xl border p-3.5 ${accountId === a.id ? 'border-gold bg-gold-soft/40' : 'border-line bg-white'}`}>
            <button className="w-full text-left" onClick={() => setAccountId(accountId === a.id ? '' : a.id)}>
              <p className="text-xs font-bold text-neutral-800">{a.name}</p>
              <p className="text-[11px] text-neutral-400">{a.bank_name || a.account_type} {a.account_number ? `· ${a.account_number}` : ''}</p>
              <p className="mt-1.5 text-lg font-bold text-neutral-900">{zar(a.balance, 2)}</p>
              <p className={`text-[11px] ${a.unreconciled ? 'text-amber-600' : 'text-emerald-600'}`}>
                {a.unreconciled ? `${a.unreconciled} unreconciled` : 'All reconciled'}
              </p>
            </button>
          </div>
        ))}
        {accounts.length === 0 && (
          <div className="sm:col-span-2 lg:col-span-4">
            <EmptyState
              title="No bank accounts configured"
              hint="Add your company bank and cash accounts to record and reconcile statement transactions."
              action={can('finance.banking') && <button className="btn-gold" onClick={() => setAcctOpen(true)}>Add bank account</button>}
            />
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-neutral-500">{pagination.total} transaction(s) {showAll ? 'in range' : 'awaiting reconciliation'}</p>
        {can('finance.banking') && (
          <div className="flex gap-2">
            <button className="btn-ghost inline-flex items-center gap-1.5" onClick={() => { setImportForm({ ...importForm, bank_account_id: accounts[0]?.id || '' }); setImportOpen(true); }}>
              <Upload size={14} /> Import statement
            </button>
            <button className="btn-ghost inline-flex items-center gap-1.5" onClick={() => { setTxnForm({ ...txnForm, bank_account_id: accounts[0]?.id || '' }); setTxnOpen(true); }}>
              <Plus size={14} /> Manual entry
            </button>
            <button className="btn-gold inline-flex items-center gap-1.5" onClick={() => setAcctOpen(true)}><Plus size={15} /> Bank account</button>
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-line">
        <DataTable
          rows={rows} columns={cols} loading={loading} rowKey={(t) => t.id}
          page={pagination.page} pageSize={pagination.pageSize} total={pagination.total} totalPages={pagination.totalPages}
          onPageChange={setPage}
          emptyTitle={showAll ? 'No bank transactions' : 'Nothing to reconcile'}
          emptyHint="Import a statement or record a manual transaction to begin reconciliation. Direct bank access is not configured — all rows here are imported or manually entered."
          toolbar={
            <TableToolbar>
              <div className="relative min-w-[180px] flex-1">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search description or reference…" aria-label="Search transactions" className="field !py-1.5 !pl-9 text-xs" />
              </div>
              <label className="flex items-center gap-1.5 text-[11px] text-neutral-500">
                <input type="checkbox" checked={showAll} onChange={(e) => { setShowAll(e.target.checked); setPage(1); }} className="accent-[#B8860B]" />
                Show reconciled
              </label>
            </TableToolbar>
          }
        />
      </div>

      <Modal open={acctOpen} onClose={() => setAcctOpen(false)} title="Add bank / cash account" width="max-w-lg">
        <FormGrid>
          <div className="sm:col-span-2"><Field label="Account name" required><Input value={acctForm.name} onChange={(e) => setAcctForm({ ...acctForm, name: e.target.value })} autoFocus placeholder="Operating Account" /></Field></div>
          <Field label="Bank"><Input value={acctForm.bank_name} onChange={(e) => setAcctForm({ ...acctForm, bank_name: e.target.value })} /></Field>
          <Field label="Account number"><Input value={acctForm.account_number} onChange={(e) => setAcctForm({ ...acctForm, account_number: e.target.value })} /></Field>
          <Field label="Type">
            <Select value={acctForm.account_type} onChange={(e) => setAcctForm({ ...acctForm, account_type: e.target.value })}>
              {['bank', 'savings', 'cash', 'petty_cash'].map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
            </Select>
          </Field>
          <Field label="Opening balance"><Input type="number" step="0.01" value={acctForm.opening_balance} onChange={(e) => setAcctForm({ ...acctForm, opening_balance: Number(e.target.value) })} /></Field>
          <Field label="Opening date"><Input type="date" value={acctForm.opening_date} onChange={(e) => setAcctForm({ ...acctForm, opening_date: e.target.value })} /></Field>
        </FormGrid>
        <FormActions>
          <button className="btn-ghost" onClick={() => setAcctOpen(false)}>Cancel</button>
          <button className="btn-gold" onClick={saveAccount}>Add Account</button>
        </FormActions>
      </Modal>

      <Modal open={txnOpen} onClose={() => setTxnOpen(false)} title="Manual bank transaction" width="max-w-lg">
        <FormGrid>
          <div className="sm:col-span-2">
            <Field label="Bank account" required>
              <Select value={txnForm.bank_account_id} onChange={(e) => setTxnForm({ ...txnForm, bank_account_id: e.target.value })}>
                <option value="">Select account…</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Date" required><Input type="date" value={txnForm.txn_date} onChange={(e) => setTxnForm({ ...txnForm, txn_date: e.target.value })} /></Field>
          <Field label="Amount (negative = debit)" required><Input type="number" step="0.01" value={txnForm.amount} onChange={(e) => setTxnForm({ ...txnForm, amount: Number(e.target.value) })} /></Field>
          <div className="sm:col-span-2"><Field label="Description" required><Input value={txnForm.description} onChange={(e) => setTxnForm({ ...txnForm, description: e.target.value })} /></Field></div>
          <Field label="Reference"><Input value={txnForm.reference} onChange={(e) => setTxnForm({ ...txnForm, reference: e.target.value })} /></Field>
        </FormGrid>
        <FormActions>
          <button className="btn-ghost" onClick={() => setTxnOpen(false)}>Cancel</button>
          <button className="btn-gold" onClick={saveTxn}>Record Transaction</button>
        </FormActions>
      </Modal>

      <Modal open={importOpen} onClose={() => setImportOpen(false)} title="Import bank statement rows" width="max-w-2xl">
        <FormGrid>
          <div className="sm:col-span-2">
            <Field label="Bank account" required>
              <Select value={importForm.bank_account_id} onChange={(e) => setImportForm({ ...importForm, bank_account_id: e.target.value })}>
                <option value="">Select account…</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </Select>
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Statement rows" hint="One per line: YYYY-MM-DD, description, reference, amount (negative for debits). Duplicates are detected and skipped.">
              <Textarea className="!min-h-40 font-mono" value={importForm.text}
                onChange={(e) => setImportForm({ ...importForm, text: e.target.value })}
                placeholder={'2026-10-01, Rental payment, INV-0001, 4800\n2026-10-02, Bank charge, FEE, -65.00'} />
            </Field>
          </div>
        </FormGrid>
        <FormActions>
          <button className="btn-ghost" onClick={() => setImportOpen(false)}>Cancel</button>
          <button className="btn-gold" onClick={runImport}>Import</button>
        </FormActions>
      </Modal>
    </div>
  );
}
