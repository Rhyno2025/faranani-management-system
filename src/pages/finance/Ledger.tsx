import { useCallback, useEffect, useState } from 'react';
import { Plus, Search, Trash2, Upload, Undo2, BookOpen, PlusCircle, XCircle } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../auth';
import {
  Field, Input, Select, Textarea, FormGrid, FormActions, Modal, StatusPill, toast, MiniStat, EmptyState, Tabs, ConfirmDialog,
} from '../../components/ui';
import { DataTable, Column, TableToolbar } from '../../components/DataTable';
import { fmtDate, zar, titleCase } from '../../lib/format';
import type { Paginated } from '../../lib/types';

type Line = { code: string; debit: number; credit: number; memo: string };

export function Ledger() {
  const { can } = useAuth();
  const [tab, setTab] = useState<'journals' | 'accounts'>('journals');
  const [journals, setJournals] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 25, total: 0, totalPages: 1 });

  const [newOpen, setNewOpen] = useState(false);
  const [form, setForm] = useState({ description: '', entry_date: new Date().toISOString().slice(0, 10) });
  const [lines, setLines] = useState<Line[]>([
    { code: '', debit: 0, credit: 0, memo: '' },
    { code: '', debit: 0, credit: 0, memo: '' },
  ]);
  const [confirm, setConfirm] = useState<{ kind: 'post' | 'reverse' | 'delete'; id: string; label: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === 'accounts') {
        setAccounts((await api.get<any>('/coa')).data);
      } else {
        const p = new URLSearchParams({ page: String(page), pageSize: '25' });
        if (q) p.set('q', q);
        if (status) p.set('status', status);
        const r = await api.get<Paginated<any>>(`/journals?${p.toString()}`);
        setJournals(r.data); setPagination(r.pagination);
      }
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  }, [tab, page, q, status]);

  useEffect(() => { const t = setTimeout(load, q ? 300 : 0); return () => clearTimeout(t); }, [load, q]);

  const totals = lines.reduce((acc, l) => ({
    debit: Math.round((acc.debit + (Number(l.debit) || 0)) * 100) / 100,
    credit: Math.round((acc.credit + (Number(l.credit) || 0)) * 100) / 100,
  }), { debit: 0, credit: 0 });
  const balanced = Math.abs(totals.debit - totals.credit) < 0.005 && totals.debit > 0;

  const save = async () => {
    if (!form.description.trim()) { toast('Description is required', 'error'); return; }
    if (!balanced) { toast(`Journal must balance — debits ${zar(totals.debit, 2)} vs credits ${zar(totals.credit, 2)}`, 'error'); return; }
    try {
      const r = await api.post<any>('/journals', { ...form, lines });
      toast(`Draft ${r.journal_ref} created`); setNewOpen(false); setTab('journals'); load();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const runConfirm = async () => {
    if (!confirm) return;
    try {
      if (confirm.kind === 'post') { await api.post(`/journals/${confirm.id}/post`); toast('Journal posted'); }
      else if (confirm.kind === 'reverse') { const r = await api.post<any>(`/journals/${confirm.id}/reverse`, { reason: 'Reversed by user' }); toast(`Reversed with ${r.reversal.journal_ref}`); }
      else { await api.del(`/journals/${confirm.id}`); toast('Draft deleted'); }
      setConfirm(null); load();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const journalCols: Column<any>[] = [
    { key: 'journal_ref', header: 'Ref', render: (j) => <span className="font-mono text-xs font-bold text-gold-dark">{j.journal_ref}</span> },
    { key: 'entry_date', header: 'Date', render: (j) => <span className="whitespace-nowrap text-xs">{fmtDate(j.entry_date)}</span> },
    { key: 'description', header: 'Description', render: (j) => (
      <div>
        <p className="text-xs font-medium text-neutral-800">{j.description}</p>
        <p className="text-[11px] text-neutral-400">{j.source_type || 'manual'} · {j.line_count || 0} lines</p>
      </div>
    ) },
    { key: 'total_debit', header: 'Amount', render: (j) => <span className="text-xs font-semibold">{zar(j.total_debit, 2)}</span> },
    { key: 'status', header: 'Status', render: (j) => <StatusPill value={j.status} /> },
    { key: 'posted_by', header: 'Posted by', render: (j) => <span className="text-[11px] text-neutral-500">{j.posted_by_name || '—'}</span> },
    {
      key: 'actions', header: '', className: 'text-right',
      render: (j) => {
        if (j.status === 'draft' && can('finance.gl.post')) {
          return (
            <div className="flex justify-end gap-1">
              {can('finance.gl.approve') && (
                <button className="btn-ghost !py-1 text-[11px] !text-emerald-600" onClick={(e) => { e.stopPropagation(); setConfirm({ kind: 'post', id: j.id, label: j.journal_ref }); }}>
                  <Upload size={12} className="mr-0.5 inline" />Post
                </button>
              )}
              <button className="btn-ghost !py-1 text-[11px] hover:!text-red-600" onClick={(e) => { e.stopPropagation(); setConfirm({ kind: 'delete', id: j.id, label: j.journal_ref }); }}>
                <Trash2 size={12} />
              </button>
            </div>
          );
        }
        if (j.status === 'posted' && can('finance.gl.approve') && !j.reversed_by) {
          return (
            <button className="btn-ghost !py-1 text-[11px]" onClick={(e) => { e.stopPropagation(); setConfirm({ kind: 'reverse', id: j.id, label: j.journal_ref }); }}>
              <Undo2 size={12} className="mr-0.5 inline" />Reverse
            </button>
          );
        }
        return null;
      },
    },
  ];

  const accountCols: Column<any>[] = [
    { key: 'code', header: 'Code', render: (a) => <span className="font-mono text-xs font-bold text-neutral-700">{a.code}</span> },
    { key: 'name', header: 'Account', render: (a) => (
      <div>
        <p className="text-xs font-semibold text-neutral-800">{a.name}</p>
        {a.description && <p className="text-[11px] text-neutral-400">{a.description}</p>}
      </div>
    ) },
    { key: 'type', header: 'Type', render: (a) => <span className="pill bg-neutral-100 text-neutral-600">{titleCase(a.type)}</span> },
    { key: 'total_debit', header: 'Debits', render: (a) => <span className="text-xs">{zar(a.total_debit, 2)}</span> },
    { key: 'total_credit', header: 'Credits', render: (a) => <span className="text-xs">{zar(a.total_credit, 2)}</span> },
    { key: 'active', header: 'Status', render: (a) => <StatusPill value={a.active ? 'active' : 'inactive'} /> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs active={tab} onChange={(k) => { setTab(k as any); setPage(1); }} tabs={[
          { key: 'journals', label: 'Journal Entries', count: pagination.total },
          { key: 'accounts', label: 'Chart of Accounts', count: accounts.length },
        ]} />
        {can('finance.gl.post') && (
          <button className="btn-gold inline-flex items-center gap-1.5" onClick={() => setNewOpen(true)}><Plus size={15} /> New Journal</button>
        )}
      </div>

      {tab === 'journals' && (
        <div className="overflow-hidden rounded-xl border border-line">
          <DataTable
            rows={journals} columns={journalCols} loading={loading} rowKey={(j) => j.id}
            page={pagination.page} pageSize={pagination.pageSize} total={pagination.total} totalPages={pagination.totalPages}
            onPageChange={setPage}
            emptyTitle="No journal entries" emptyHint="Journals are created here and automatically from invoices, payments, expenses and payroll. Drafts must be posted before they affect the statements."
            toolbar={
              <TableToolbar>
                <div className="relative min-w-[180px] flex-1">
                  <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                  <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search reference or description…" aria-label="Search journals" className="field !py-1.5 !pl-9 text-xs" />
                </div>
                <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status" className="field !w-auto !py-1.5 text-xs">
                  <option value="">All statuses</option>
                  {['draft', 'posted', 'reversed'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
                </select>
              </TableToolbar>
            }
          />
        </div>
      )}

      {tab === 'accounts' && (
        <div className="overflow-hidden rounded-xl border border-line">
          <DataTable
            rows={accounts} columns={accountCols} loading={loading} rowKey={(a) => a.id}
            emptyTitle="No chart of accounts" emptyHint="The standard property-management chart is seeded on first start."
          />
        </div>
      )}

      {/* new journal */}
      <Modal open={newOpen} onClose={() => setNewOpen(false)} title="New journal entry (draft)" width="max-w-4xl">
        <FormGrid>
          <div className="sm:col-span-2">
            <Field label="Description" required><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} autoFocus /></Field>
          </div>
          <Field label="Entry date" required><Input type="date" value={form.entry_date} onChange={(e) => setForm({ ...form, entry_date: e.target.value })} /></Field>
        </FormGrid>

        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-wide text-neutral-500">Lines</p>
            <button className="btn-ghost !py-1 text-xs" onClick={() => setLines([...lines, { code: '', debit: 0, credit: 0, memo: '' }])}>
              <PlusCircle size={12} className="mr-1 inline" />Add line
            </button>
          </div>
          <div className="space-y-2">
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-12 gap-2">
                <select className="field col-span-4 !py-1.5 text-xs" value={l.code}
                  onChange={(e) => { const next = [...lines]; next[i] = { ...l, code: e.target.value }; setLines(next); }}>
                  <option value="">Select account…</option>
                  {accounts.map((a) => <option key={a.id} value={a.code}>{a.code} — {a.name}</option>)}
                </select>
                <input type="number" min={0} step="0.01" placeholder="Debit" className="field col-span-3 !py-1.5 text-xs" value={l.debit || ''}
                  onChange={(e) => { const next = [...lines]; next[i] = { ...l, debit: Number(e.target.value), credit: 0 }; setLines(next); }} />
                <input type="number" min={0} step="0.01" placeholder="Credit" className="field col-span-3 !py-1.5 text-xs" value={l.credit || ''}
                  onChange={(e) => { const next = [...lines]; next[i] = { ...l, credit: Number(e.target.value), debit: 0 }; setLines(next); }} />
                <button className="col-span-2 rounded p-1.5 text-neutral-400 hover:text-red-600" aria-label="Remove line"
                  onClick={() => setLines(lines.filter((_, idx) => idx !== i))}><XCircle size={14} /></button>
              </div>
            ))}
          </div>
          <div className={`mt-3 flex justify-between rounded-lg border px-3.5 py-2 text-sm ${balanced ? 'border-emerald-200 bg-emerald-50' : 'border-line'}`}>
            <span className="text-neutral-600">Debits {zar(totals.debit, 2)} · Credits {zar(totals.credit, 2)}</span>
            <span className={`font-bold ${balanced ? 'text-emerald-600' : 'text-red-600'}`}>{balanced ? 'Balanced' : 'Out of balance'}</span>
          </div>
        </div>

        <FormActions>
          <button className="btn-ghost" onClick={() => setNewOpen(false)}>Cancel</button>
          <button className="btn-gold" onClick={save} disabled={!balanced}>Save Draft Journal</button>
        </FormActions>
      </Modal>

      <ConfirmDialog
        open={Boolean(confirm)} onClose={() => setConfirm(null)} onConfirm={runConfirm}
        title={confirm?.kind === 'post' ? 'Post journal?' : confirm?.kind === 'reverse' ? 'Reverse posted journal?' : 'Delete draft journal?'}
        message={confirm?.kind === 'post'
          ? `${confirm?.label} will be posted to the general ledger and included in the financial statements. Posted entries cannot be edited.`
          : confirm?.kind === 'reverse'
            ? `${confirm?.label} will be reversed with a mirror entry. The original stays in the audit trail.`
            : `${confirm?.label} will be permanently deleted (it has never been posted).`}
        confirmLabel={confirm?.kind === 'post' ? 'Post Journal' : confirm?.kind === 'reverse' ? 'Reverse' : 'Delete Draft'}
      />
    </div>
  );
}
