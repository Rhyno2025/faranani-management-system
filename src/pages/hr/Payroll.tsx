import { useCallback, useEffect, useState } from 'react';
import { Plus, Calculator, CheckCircle2, Banknote, FileText, Info } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../auth';
import {
  Field, Input, Select, FormGrid, FormActions, Modal, StatusPill, toast, MiniStat, EmptyState,
} from '../../components/ui';
import { DataTable, Column } from '../../components/DataTable';
import { fmtDate, zar, titleCase } from '../../lib/format';

export function Payroll() {
  const { can } = useAuth();
  const [periods, setPeriods] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<any>(null);
  const [detail, setDetail] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newKey, setNewKey] = useState(todayKey());
  const [payslip, setPayslip] = useState<any>(null);
  const [bankAccounts, setBankAccounts] = useState<any[]>([]);
  const [payTarget, setPayTarget] = useState<any>(null);
  const [payAccount, setPayAccount] = useState('');

  function todayKey() { return new Date().toISOString().slice(0, 7); }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get<any>('/hr/payroll/periods');
      setPeriods(r.data);
      api.get<any>('/hr/payroll/config').then(setConfig).catch(() => {});
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const create = async () => {
    try { await api.post('/hr/payroll/periods', { period_key: newKey }); toast('Payroll period created'); setCreateOpen(false); load(); }
    catch (e: any) { toast(e.message, 'error'); }
  };

  const open = async (id: string) => {
    try { setDetail(await api.get(`/hr/payroll/periods/${id}`)); } catch (e: any) { toast(e.message, 'error'); }
  };

  const run = async (id: string) => {
    setBusy(true);
    try {
      const r = await api.post<any>(`/hr/payroll/periods/${id}/calculate`, {});
      toast(`Payroll calculated: ${r.employee_count} employee(s), net ${zar(r.net, 2)}`);
      open(id); load();
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  };

  const approve = async (id: string) => {
    setBusy(true);
    try {
      const r = await api.post<any>(`/hr/payroll/periods/${id}/approve`);
      toast(`Approved — draft journal ${r.journal_ref || ''} created for finance to post`.replace('  ', ' '));
      open(id); load();
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  };

  const pay = async () => {
    if (!payTarget) return;
    setBusy(true);
    try {
      await api.post(`/hr/payroll/periods/${payTarget.id}/pay`, { bank_account_id: payAccount || undefined });
      toast('Payment confirmed against the payroll record');
      setPayTarget(null); open(payTarget.id); load();
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  };

  const startPayment = async () => {
    try {
      const r = await api.get<any>('/bank/accounts');
      setBankAccounts(r.data);
      if (!r.data.length) { toast('Configure a bank account in Finance → Banking first', 'error'); return; }
      setPayAccount(r.data[0].id);
      setPayTarget(detail);
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const showPayslip = async (entryId: string) => {
    try { setPayslip(await api.get(`/hr/payroll/payslips/${entryId}`)); } catch (e: any) { toast(e.message, 'error'); }
  };

  const periodCols: Column<any>[] = [
    { key: 'label', header: 'Period', render: (p) => <span className="text-xs font-semibold text-neutral-800">{p.label}</span> },
    { key: 'employee_count', header: 'Employees', render: (p) => <span className="text-xs">{p.employee_count}</span> },
    { key: 'gross_total', header: 'Gross', render: (p) => <span className="text-xs">{zar(p.gross_total, 2)}</span> },
    { key: 'deduction_total', header: 'Deductions', render: (p) => <span className="text-xs text-red-600">{zar(p.deduction_total, 2)}</span> },
    { key: 'net_total', header: 'Net pay', render: (p) => <span className="text-xs font-bold text-emerald-600">{zar(p.net_total, 2)}</span> },
    { key: 'status', header: 'Status', render: (p) => <StatusPill value={p.status} /> },
    {
      key: 'actions', header: '', className: 'text-right',
      render: (p) => (
        <div className="flex justify-end gap-1">
          <button className="btn-ghost !py-1 text-[11px]" onClick={(e) => { e.stopPropagation(); open(p.id); }}>Open</button>
          {['draft', 'calculated'].includes(p.status) && can('hr.payroll.process') && (
            <button className="btn-ghost !py-1 text-[11px]" onClick={(e) => { e.stopPropagation(); run(p.id); }} disabled={busy}>
              <Calculator size={12} className="mr-0.5 inline" />Calculate
            </button>
          )}
          {p.status === 'calculated' && can('hr.payroll.approve') && (
            <button className="btn-ghost !py-1 text-[11px] !text-emerald-600" onClick={(e) => { e.stopPropagation(); approve(p.id); }} disabled={busy}>
              <CheckCircle2 size={12} className="mr-0.5 inline" />Approve
            </button>
          )}
        </div>
      ),
    },
  ];

  const entryCols: Column<any>[] = [
    { key: 'full_name', header: 'Employee', render: (e) => (
      <div>
        <p className="text-xs font-semibold text-neutral-800">{e.full_name}</p>
        <p className="text-[11px] text-neutral-400">{e.employee_ref} · {e.department || '—'}</p>
      </div>
    ) },
    { key: 'basic', header: 'Basic', render: (e) => <span className="text-xs">{e.basic !== undefined ? zar(e.basic, 2) : '••••'}</span> },
    { key: 'gross', header: 'Gross', render: (e) => <span className="text-xs">{e.gross !== undefined ? zar(e.gross, 2) : '••••'}</span> },
    { key: 'deductions', header: 'Deductions', render: (e) => <span className="text-xs text-red-600">{e.deductions !== undefined ? zar(e.deductions, 2) : '••••'}</span> },
    { key: 'net', header: 'Net', render: (e) => <span className="text-xs font-bold text-emerald-600">{e.net !== undefined ? zar(e.net, 2) : '••••'}</span> },
    { key: 'status', header: 'Status', render: (e) => <StatusPill value={e.status} /> },
    {
      key: 'actions', header: '', className: 'text-right',
      render: (e) => (
        <button className="btn-ghost !py-1 text-[11px]" onClick={(ev) => { ev.stopPropagation(); showPayslip(e.id); }}>
          <FileText size={12} className="mr-0.5 inline" />Payslip
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MiniStat label="Payroll periods" value={periods.length} />
        <MiniStat label="Draft" value={periods.filter((p) => ['draft', 'calculated'].includes(p.status)).length} />
        <MiniStat label="Approved" value={periods.filter((p) => p.status === 'approved').length} tone="green" />
        <MiniStat label="Paid" value={periods.filter((p) => p.status === 'paid').length} tone="gold" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-neutral-500">
          {config?.tax ? `PAYE: ${config.tax.tax_year} SARS brackets, effective ${config.tax.effective_from}` : 'Statutory configuration not loaded'}
        </p>
        {can('hr.payroll.process') && (
          <button className="btn-gold inline-flex items-center gap-1.5" onClick={() => setCreateOpen(true)}><Plus size={15} /> New Payroll Period</button>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-line">
        <DataTable
          rows={periods} columns={periodCols} loading={loading} rowKey={(p) => p.id}
          onRowClick={(p) => open(p.id)}
          emptyTitle="No payroll periods" emptyHint="Create a monthly period, calculate it from employee salary records, then approve and confirm payment."
        />
      </div>

      {detail && (
        <Modal open={Boolean(detail)} onClose={() => setDetail(null)} title={`Payroll — ${detail.label}`} width="max-w-5xl">
          <div className="mb-3 grid grid-cols-2 gap-2.5 sm:grid-cols-5">
            <MiniStat label="Status" value={<StatusPill value={detail.status} />} />
            <MiniStat label="Employees" value={detail.employee_count} />
            <MiniStat label="Gross" value={zar(detail.gross_total, 2)} tone="gold" />
            <MiniStat label="Deductions" value={zar(detail.deduction_total, 2)} tone="red" />
            <MiniStat label="Net pay" value={zar(detail.net_total, 2)} tone="green" />
          </div>

          <div className="mb-3 flex flex-wrap gap-2">
            {['draft', 'calculated'].includes(detail.status) && can('hr.payroll.process') && (
              <button className="btn-gold inline-flex items-center gap-1.5" disabled={busy} onClick={() => run(detail.id)}>
                <Calculator size={14} /> {detail.status === 'draft' ? 'Calculate payroll' : 'Recalculate'}
              </button>
            )}
            {detail.status === 'calculated' && can('hr.payroll.approve') && (
              <button className="btn-gold inline-flex items-center gap-1.5" disabled={busy} onClick={() => approve(detail.id)}>
                <CheckCircle2 size={14} /> Approve payroll
              </button>
            )}
            {detail.status === 'approved' && can('hr.payroll.approve') && (
              <button className="btn-gold inline-flex items-center gap-1.5" disabled={busy} onClick={startPayment}>
                <Banknote size={14} /> Confirm payment
              </button>
            )}
          </div>

          {detail.status === 'approved' && (
            <p className="mb-3 flex items-start gap-1.5 rounded-lg bg-gold-soft/60 px-3 py-2 text-[11.5px] text-gold-dark">
              <Info size={13} className="mt-0.5 shrink-0" />
              Approval created a draft journal in Finance → Ledger. Payroll is only reflected in the financial statements once finance posts it.
            </p>
          )}

          <div className="overflow-hidden rounded-lg border border-line">
            <DataTable
              rows={detail.entries || []} columns={entryCols} rowKey={(e: any) => e.id}
              emptyTitle="No payroll lines" emptyHint="Run the calculation to build lines from employee salary records."
            />
          </div>

          <FormActions><button className="btn-ghost" onClick={() => setDetail(null)}>Close</button></FormActions>
        </Modal>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New payroll period" width="max-w-md">
        <FormGrid>
          <div className="sm:col-span-2">
            <Field label="Period (YYYY-MM)" required>
              <Input value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="2026-10" />
            </Field>
          </div>
        </FormGrid>
        <FormActions>
          <button className="btn-ghost" onClick={() => setCreateOpen(false)}>Cancel</button>
          <button className="btn-gold" onClick={create}>Create Period</button>
        </FormActions>
      </Modal>

      <Modal open={Boolean(payTarget)} onClose={() => setPayTarget(null)} title="Confirm payroll payment" width="max-w-lg">
        <p className="text-sm text-neutral-600">
          Confirm that net pay of <strong>{zar(payTarget?.net_total || 0, 2)}</strong> for {payTarget?.label} was released from the company account.
          This marks the payroll record as paid — it does not initiate a bank transfer.
        </p>
        <div className="mt-3">
          <Field label="Bank account" required>
            <Select value={payAccount} onChange={(e) => setPayAccount(e.target.value)}>
              {bankAccounts.map((b) => <option key={b.id} value={b.id}>{b.name}{b.bank_name ? ` — ${b.bank_name}` : ''}</option>)}
            </Select>
          </Field>
        </div>
        <FormActions>
          <button className="btn-ghost" onClick={() => setPayTarget(null)}>Cancel</button>
          <button className="btn-gold" onClick={pay} disabled={busy}>{busy ? 'Working…' : 'Confirm Payment'}</button>
        </FormActions>
      </Modal>

      <Modal open={Boolean(payslip)} onClose={() => setPayslip(null)} title={payslip ? `Payslip — ${payslip.full_name} · ${payslip.label}` : ''} width="max-w-lg">
        {payslip && (
          <div>
            <div className="mb-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              <MiniStat label="Employee" value={payslip.employee_ref} />
              <MiniStat label="Period" value={`${fmtDate(payslip.start_date)} → ${fmtDate(payslip.end_date)}`} />
              <MiniStat label="Net pay" value={zar(payslip.net, 2)} tone="green" />
            </div>
            <table className="data-table">
              <thead><tr><th>Line</th><th>Type</th><th className="text-right">Amount</th></tr></thead>
              <tbody>
                {(payslip.lines || []).map((l: any, i: number) => (
                  <tr key={i}>
                    <td className="text-xs">{l.label}</td>
                    <td className="text-xs text-neutral-500">{titleCase(l.kind)}</td>
                    <td className={`text-right text-xs font-semibold ${l.kind === 'deduction' ? 'text-red-600' : ''}`}>{zar(l.amount, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-3 rounded-lg border border-line px-3.5 py-2.5 text-sm">
              <div className="flex justify-between"><span className="text-neutral-500">Gross</span><span className="font-semibold">{zar(payslip.gross, 2)}</span></div>
              <div className="flex justify-between"><span className="text-neutral-500">Deductions</span><span className="font-semibold text-red-600">{zar(payslip.deductions, 2)}</span></div>
              <div className="flex justify-between"><span className="text-neutral-500">Net</span><span className="font-bold text-emerald-600">{zar(payslip.net, 2)}</span></div>
            </div>
            <FormActions><button className="btn-ghost" onClick={() => setPayslip(null)}>Close</button></FormActions>
          </div>
        )}
      </Modal>

      {config?.deductions?.length > 0 && (
        <div className="rounded-xl border border-line">
          <p className="border-b border-line px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-neutral-500">Configured statutory rules</p>
          <ul className="divide-y divide-neutral-100">
            {config.deductions.map((d: any) => (
              <li key={d.code} className="px-4 py-2 text-xs">
                <span className="font-semibold text-neutral-800">{d.label}</span>
                <span className="ml-2 text-neutral-500">{d.rate ? `${d.rate}%` : 'progressive'}{d.ceiling ? ` · ceiling R${Number(d.ceiling).toLocaleString()}/month` : ''}</span>
                <span className="ml-2 text-neutral-400">effective {d.effective_from}</span>
                <a href={d.source} target="_blank" rel="noreferrer" className="ml-2 text-gold-dark underline">source</a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
