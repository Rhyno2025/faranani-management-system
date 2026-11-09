import { useCallback, useEffect, useState } from 'react';
import { Plus, Search, Check, X, Ban } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../auth';
import {
  Field, Input, Select, Textarea, FormGrid, FormActions, Modal, StatusPill, toast, MiniStat, EmptyState, Tabs,
} from '../../components/ui';
import { DataTable, Column, TableToolbar } from '../../components/DataTable';
import { fmtDate, titleCase, todayISO } from '../../lib/format';
import type { Paginated } from '../../lib/types';

export function Leave() {
  const { can } = useAuth();
  const [tab, setTab] = useState<'requests' | 'policies'>('requests');
  const [rows, setRows] = useState<any[]>([]);
  const [types, setTypes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 25, total: 0, totalPages: 1 });
  const [pendingCount, setPendingCount] = useState(0);

  const [applyOpen, setApplyOpen] = useState(false);
  const [form, setForm] = useState({ staff_id: '', leave_type_id: '', start_date: '', end_date: '', reason: '' });
  const [employees, setEmployees] = useState<any[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === 'policies') {
        setTypes((await api.get<any>('/hr/leave/types')).data);
      } else {
        const p = new URLSearchParams({ page: String(page), pageSize: '25' });
        if (q) p.set('q', q);
        if (status) p.set('status', status);
        const r = await api.get<Paginated<any>>(`/hr/leave/requests?${p.toString()}`);
        setRows(r.data); setPagination(r.pagination);
        setPendingCount(r.data.filter((x: any) => ['pending', 'hr_pending'].includes(x.status)).length);
        const t = (await api.get<any>('/hr/leave/types')).data;
        setTypes(t);
      }
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  }, [tab, page, q, status]);

  useEffect(() => { const t = setTimeout(load, q ? 300 : 0); return () => clearTimeout(t); }, [load, q]);

  const openApply = async () => {
    try { setEmployees((await api.get<any>('/hr/employees?pageSize=300')).data); } catch { setEmployees([]); }
    setForm({ ...form, leave_type_id: types[0]?.id || '' });
    setApplyOpen(true);
  };

  const submit = async () => {
    if (!form.leave_type_id || !form.start_date || !form.end_date) { toast('Leave type and dates are required', 'error'); return; }
    try {
      const r = await api.post<any>('/hr/leave/requests', form);
      toast(`Leave request ${r.leave_ref} submitted`); setApplyOpen(false); load();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const decide = async (id: string, stage: 'manager' | 'hr', approve: boolean) => {
    try {
      await api.post(`/hr/leave/requests/${id}/decision`, { stage, decision: approve ? 'approve' : 'reject' });
      toast(approve ? 'Leave approved' : 'Leave rejected'); load();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const cancel = async (id: string) => {
    try { await api.post(`/hr/leave/requests/${id}/cancel`, { reason: 'Cancelled by employee' }); toast('Request cancelled'); load(); }
    catch (e: any) { toast(e.message, 'error'); }
  };

  const cols: Column<any>[] = [
    { key: 'leave_ref', header: 'Ref', render: (r) => <span className="font-mono text-xs font-bold text-gold-dark">{r.leave_ref}</span> },
    { key: 'full_name', header: 'Employee', render: (r) => (
      <div>
        <p className="text-xs font-semibold text-neutral-800">{r.full_name}</p>
        <p className="text-[11px] text-neutral-400">{r.employee_ref} · {r.department || '—'}</p>
      </div>
    ) },
    { key: 'leave_type', header: 'Type', render: (r) => <span className="text-xs text-neutral-700">{r.leave_type}</span> },
    { key: 'dates', header: 'Dates', render: (r) => <span className="whitespace-nowrap text-xs">{fmtDate(r.start_date)} → {fmtDate(r.end_date)}</span> },
    { key: 'days', header: 'Days', render: (r) => <span className="text-xs font-semibold">{r.days}</span> },
    { key: 'status', header: 'Status', render: (r) => <StatusPill value={r.status} /> },
    {
      key: 'actions', header: '', className: 'text-right',
      render: (r) => {
        if (['approved', 'rejected', 'cancelled'].includes(r.status)) return null;
        return (
          <div className="flex justify-end gap-1">
            {r.status === 'pending' && can('hr.leave.approve') && (
              <button className="btn-ghost !py-1 text-[11px] !text-emerald-600" onClick={(e) => { e.stopPropagation(); decide(r.id, 'manager', true); }}>
                <Check size={12} className="mr-0.5 inline" />Approve
              </button>
            )}
            {r.status === 'hr_pending' && can('hr.leave.approve') && (
              <button className="btn-ghost !py-1 text-[11px] !text-emerald-600" onClick={(e) => { e.stopPropagation(); decide(r.id, 'hr', true); }}>
                <Check size={12} className="mr-0.5 inline" />HR verify
              </button>
            )}
            {can('hr.leave.approve') && (
              <button className="btn-ghost !py-1 text-[11px] hover:!text-red-600" onClick={(e) => { e.stopPropagation(); decide(r.id, r.status === 'pending' ? 'manager' : 'hr', false); }}>
                <X size={12} className="mr-0.5 inline" />Reject
              </button>
            )}
            <button className="btn-ghost !py-1 text-[11px]" onClick={(e) => { e.stopPropagation(); cancel(r.id); }}>
              <Ban size={12} className="mr-0.5 inline" />Cancel
            </button>
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs active={tab} onChange={(k) => { setTab(k as any); setPage(1); }} tabs={[
          { key: 'requests', label: 'Requests', count: pendingCount || undefined },
          { key: 'policies', label: 'Leave Policies' },
        ]} />
        <button className="btn-gold inline-flex items-center gap-1.5" onClick={openApply}><Plus size={15} /> Apply for Leave</button>
      </div>

      {tab === 'requests' && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MiniStat label="Total requests" value={pagination.total} />
            <MiniStat label="Awaiting approval" value={rows.filter((r) => ['pending', 'hr_pending'].includes(r.status)).length} tone="gold" />
            <MiniStat label="Approved" value={rows.filter((r) => r.status === 'approved').length} tone="green" />
            <MiniStat label="Rejected / cancelled" value={rows.filter((r) => ['rejected', 'cancelled'].includes(r.status)).length} tone="red" />
          </div>

          <div className="overflow-hidden rounded-xl border border-line">
            <DataTable
              rows={rows} columns={cols} loading={loading} rowKey={(r) => r.id}
              page={pagination.page} pageSize={pagination.pageSize} total={pagination.total} totalPages={pagination.totalPages}
              onPageChange={setPage}
              emptyTitle="No leave requests" emptyHint="Leave applications submitted by employees or on their behalf will appear here."
              toolbar={
                <TableToolbar>
                  <div className="relative min-w-[180px] flex-1">
                    <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                    <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search employee or reference…" aria-label="Search leave" className="field !py-1.5 !pl-9 text-xs" />
                  </div>
                  <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status filter" className="field !w-auto !py-1.5 text-xs">
                    <option value="">All statuses</option>
                    {['pending', 'hr_pending', 'approved', 'rejected', 'cancelled'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
                  </select>
                </TableToolbar>
              }
            />
          </div>
        </>
      )}

      {tab === 'policies' && (
        <div>
          <p className="mb-3 text-xs text-neutral-500">
            Leave policies are company configuration. Days shown are defaults and must be confirmed against your approved leave policy and applicable employment law.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {types.map((t) => (
              <div key={t.id} className="rounded-xl border border-line bg-white p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-bold text-neutral-800">{t.name}</p>
                  <span className={`pill ${t.paid ? 'bg-emerald-100 text-emerald-700' : 'bg-neutral-100 text-neutral-600'}`}>{t.paid ? 'Paid' : 'Unpaid'}</span>
                </div>
                <p className="mt-1 text-xs text-neutral-500">{t.days_per_year > 0 ? `${t.days_per_year} days / year` : 'Case by case'}</p>
                <p className="mt-2 text-[11.5px] text-neutral-400">{t.description}</p>
                {t.requires_document === 1 && <p className="mt-1.5 text-[11px] font-semibold text-amber-600">Supporting document required</p>}
              </div>
            ))}
            {types.length === 0 && <EmptyState title="No leave policies configured" />}
          </div>
        </div>
      )}

      <Modal open={applyOpen} onClose={() => setApplyOpen(false)} title="Apply for leave" width="max-w-xl">
        <FormGrid>
          <div className="sm:col-span-2">
            <Field label="Employee" hint="Managers and HR may apply on behalf of an employee.">
              <Select value={form.staff_id} onChange={(e) => setForm({ ...form, staff_id: e.target.value })}>
                <option value="">My own record</option>
                {employees.map((s) => <option key={s.id} value={s.id}>{s.employee_ref} — {s.full_name}</option>)}
              </Select>
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Leave type" required>
              <Select value={form.leave_type_id} onChange={(e) => setForm({ ...form, leave_type_id: e.target.value })}>
                <option value="">Select type…</option>
                {types.map((t) => <option key={t.id} value={t.id}>{t.name}{t.requires_document ? ' (document required)' : ''}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Start date" required><Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></Field>
          <Field label="End date" required><Input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></Field>
          <div className="sm:col-span-2">
            <Field label="Reason"><Textarea className="!min-h-16" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></Field>
          </div>
        </FormGrid>
        <p className="mt-2 text-[11px] text-neutral-400">Working days exclude weekends and configured public holidays. Overlapping requests are blocked by the server.</p>
        <FormActions>
          <button className="btn-ghost" onClick={() => setApplyOpen(false)}>Cancel</button>
          <button className="btn-gold" onClick={submit}>Submit Request</button>
        </FormActions>
      </Modal>
    </div>
  );
}
