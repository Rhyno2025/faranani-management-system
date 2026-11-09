import { useCallback, useEffect, useState } from 'react';
import { Plus, Check, Send, XCircle } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../auth';
import {
  Field, Input, Select, FormGrid, FormActions, Modal, StatusPill, toast, MiniStat, EmptyState,
} from '../../components/ui';
import { DataTable, Column } from '../../components/DataTable';
import { fmtDate, zar } from '../../lib/format';

interface BudgetLine { account_id: string; month: number; amount: number }

export function Budgets() {
  const { can } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(new Date().getFullYear());
  const [form, setForm] = useState({ label: '', fiscal_year: new Date().getFullYear(), notes: '' });
  const [lines, setLines] = useState<BudgetLine[]>([{ account_id: '', month: 1, amount: 0 }]);
  const [comparison, setComparison] = useState<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows((await api.get<any>(`/budgets?year=${year}`)).data);
      api.get<any>(`/reports/budget-vs-actual?year=${year}`).then(setComparison).catch(() => setComparison(null));
      api.get<any>('/coa').then((r) => setAccounts(r.data)).catch(() => {});
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  }, [year]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!form.label.trim()) { toast('Budget label is required', 'error'); return; }
    const valid = lines.filter((l) => l.account_id && l.amount);
    if (!valid.length) { toast('Add at least one budget line', 'error'); return; }
    try {
      const r = await api.post<any>('/budgets', { ...form, fiscal_year: Number(form.fiscal_year), lines: valid });
      toast(`Budget ${r.budget_ref} created (v${r.version})`); setOpen(false); load();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const setStatus = async (id: string, status: string) => {
    try { await api.post(`/budgets/${id}/status`, { status }); toast(`Budget ${status}`); load(); }
    catch (e: any) { toast(e.message, 'error'); }
  };

  const cols: Column<any>[] = [
    { key: 'budget_ref', header: 'Ref', render: (b) => <span className="font-mono text-xs font-bold text-gold-dark">{b.budget_ref}</span> },
    { key: 'label', header: 'Budget', render: (b) => (
      <div>
        <p className="text-xs font-semibold text-neutral-800">{b.label}</p>
        <p className="text-[11px] text-neutral-400">{b.scope_type}{b.version > 1 ? ` · v${b.version}` : ''}</p>
      </div>
    ) },
    { key: 'fiscal_year', header: 'Year', render: (b) => <span className="text-xs">{b.fiscal_year}</span> },
    { key: 'total', header: 'Value', render: (b) => <span className="text-xs font-semibold">{zar(b.total || 0, 2)}</span> },
    { key: 'created_at', header: 'Created', render: (b) => <span className="text-xs">{fmtDate(b.created_at)}</span> },
    { key: 'status', header: 'Status', render: (b) => <StatusPill value={b.status} /> },
    {
      key: 'actions', header: '', className: 'text-right',
      render: (b) => can('finance.budget') && (
        <div className="flex justify-end gap-1">
          {b.status === 'draft' && <button className="btn-ghost !py-1 text-[11px]" onClick={(e) => { e.stopPropagation(); setStatus(b.id, 'submitted'); }}><Send size={12} className="mr-0.5 inline" />Submit</button>}
          {b.status === 'submitted' && can('finance.approve') && (
            <button className="btn-ghost !py-1 text-[11px] !text-emerald-600" onClick={(e) => { e.stopPropagation(); setStatus(b.id, 'approved'); }}><Check size={12} className="mr-0.5 inline" />Approve</button>
          )}
          {b.status === 'submitted' && (
            <button className="btn-ghost !py-1 text-[11px] hover:!text-red-600" onClick={(e) => { e.stopPropagation(); setStatus(b.id, 'rejected'); }}><XCircle size={12} /></button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <label className="text-xs text-neutral-500">Fiscal year</label>
          <select className="field !w-auto !py-1.5 text-xs" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {[0, 1, 2].map((i) => <option key={i} value={new Date().getFullYear() - i}>{new Date().getFullYear() - i}</option>)}
          </select>
        </div>
        {can('finance.budget') && (
          <button className="btn-gold inline-flex items-center gap-1.5" onClick={() => setOpen(true)}><Plus size={15} /> New Budget</button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <MiniStat label="Budgets" value={rows.length} />
        <MiniStat label="Approved value" value={zar(rows.filter((b) => b.status === 'approved').reduce((s, b) => s + (b.total || 0), 0), 2)} tone="gold" />
        <MiniStat label="Awaiting approval" value={rows.filter((b) => b.status === 'submitted').length} />
      </div>

      <div className="overflow-hidden rounded-xl border border-line">
        <DataTable
          rows={rows} columns={cols} loading={loading} rowKey={(b) => b.id}
          emptyTitle="No budgets" emptyHint="Create an annual budget with monthly lines per account, submit it and have it approved."
        />
      </div>

      {comparison && comparison.rows?.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-line">
          <p className="border-b border-line px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-neutral-500">
            Budget vs actual — {comparison.year}
          </p>
          <table className="data-table">
            <thead><tr><th>Account</th><th className="text-right">Budget</th><th className="text-right">Actual</th><th className="text-right">Variance</th></tr></thead>
            <tbody>
              {comparison.rows.map((r: any) => (
                <tr key={r.account_id}>
                  <td className="text-xs">{r.code} — {r.name}</td>
                  <td className="text-right text-xs">{zar(r.budget, 2)}</td>
                  <td className="text-right text-xs">{zar(r.actual, 2)}</td>
                  <td className={`text-right text-xs font-semibold ${r.variance < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{zar(r.variance, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="New budget" width="max-w-3xl">
        <FormGrid>
          <div className="sm:col-span-2"><Field label="Label" required><Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="2027 Operating Budget" autoFocus /></Field></div>
          <Field label="Fiscal year" required><Input type="number" value={form.fiscal_year} onChange={(e) => setForm({ ...form, fiscal_year: Number(e.target.value) })} /></Field>
          <Field label="Notes"><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
        </FormGrid>

        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-wide text-neutral-500">Budget lines</p>
            <button className="btn-ghost !py-1 text-xs" onClick={() => setLines([...lines, { account_id: '', month: 1, amount: 0 }])}>+ Add line</button>
          </div>
          <div className="space-y-2">
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-12 gap-2">
                <select className="field col-span-6 !py-1.5 text-xs" value={l.account_id}
                  onChange={(e) => { const n = [...lines]; n[i] = { ...l, account_id: e.target.value }; setLines(n); }}>
                  <option value="">Select account…</option>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                </select>
                <select className="field col-span-2 !py-1.5 text-xs" value={l.month}
                  onChange={(e) => { const n = [...lines]; n[i] = { ...l, month: Number(e.target.value) }; setLines(n); }}>
                  {Array.from({ length: 12 }, (_, m) => m + 1).map((m) => <option key={m} value={m}>{new Date(2000, m - 1, 1).toLocaleString('en', { month: 'short' })}</option>)}
                </select>
                <input type="number" step="0.01" className="field col-span-3 !py-1.5 text-xs" value={l.amount || ''}
                  onChange={(e) => { const n = [...lines]; n[i] = { ...l, amount: Number(e.target.value) }; setLines(n); }} />
                <button className="col-span-1 rounded p-1.5 text-neutral-400 hover:text-red-600" aria-label="Remove"
                  onClick={() => setLines(lines.filter((_, x) => x !== i))}><XCircle size={14} /></button>
              </div>
            ))}
          </div>
        </div>

        <FormActions>
          <button className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
          <button className="btn-gold" onClick={save}>Create Draft Budget</button>
        </FormActions>
      </Modal>
    </div>
  );
}
