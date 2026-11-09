import { useCallback, useEffect, useState } from 'react';
import { Plus, Search, ShieldAlert, Lock } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../auth';
import {
  Field, Input, Select, Textarea, FormGrid, FormActions, Modal, StatusPill, toast, PriorityPill, EmptyState,
} from '../../components/ui';
import { DataTable, Column, TableToolbar } from '../../components/DataTable';
import { fmtDate, titleCase } from '../../lib/format';
import type { Paginated } from '../../lib/types';

const TYPES = ['grievance', 'disciplinary', 'incident', 'investigation', 'policy_violation', 'complaint'];
const STATUSES = ['open', 'investigating', 'hearing_scheduled', 'resolved', 'closed'];

export function Cases() {
  const { can } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 25, total: 0, totalPages: 1 });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ staff_id: '', type: 'grievance', title: '', description: '', severity: 'normal', confidential: false, due_date: '' });
  const [employees, setEmployees] = useState<any[]>([]);
  const [detail, setDetail] = useState<any>(null);
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ page: String(page), pageSize: '25' });
      if (q) p.set('q', q);
      if (status) p.set('status', status);
      const r = await api.get<Paginated<any>>(`/hr/cases?${p.toString()}`);
      setRows(r.data); setPagination(r.pagination);
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  }, [page, q, status]);

  useEffect(() => { const t = setTimeout(load, q ? 300 : 0); return () => clearTimeout(t); }, [load, q]);

  const openForm = async () => {
    try { setEmployees((await api.get<any>('/hr/employees?pageSize=300')).data); } catch { setEmployees([]); }
    setOpen(true);
  };

  const submit = async () => {
    if (!form.title.trim()) { toast('Case title is required', 'error'); return; }
    try {
      const r = await api.post<any>('/hr/cases', form);
      toast(`Case ${r.case_ref} opened`); setOpen(false); load();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const changeStatus = async (id: string, next: string) => {
    try { await api.post(`/hr/cases/${id}/status`, { status: next }); toast(`Case ${titleCase(next)}`); setDetail(null); load(); }
    catch (e: any) { toast(e.message, 'error'); }
  };

  const addNote = async () => {
    if (!detail || !note.trim()) return;
    try {
      await api.post(`/hr/cases/${detail.id}/notes`, { body: note });
      setNote(''); toast('Note added');
      setDetail(await api.get(`/hr/cases/${detail.id}`));
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const cols: Column<any>[] = [
    { key: 'case_ref', header: 'Ref', render: (c) => <span className="font-mono text-xs font-bold text-gold-dark">{c.case_ref}</span> },
    { key: 'title', header: 'Case', render: (c) => (
      <div>
        <p className="text-xs font-semibold text-neutral-800">{c.title}</p>
        <p className="text-[11px] text-neutral-400">{c.full_name ? `${c.full_name} (${c.employee_ref})` : 'General'}</p>
      </div>
    ) },
    { key: 'type', header: 'Type', render: (c) => <span className="pill bg-neutral-100 text-neutral-600">{titleCase(c.type)}</span> },
    { key: 'severity', header: 'Severity', render: (c) => <PriorityPill value={c.severity} /> },
    { key: 'created_at', header: 'Opened', render: (c) => <span className="text-xs">{fmtDate(c.created_at)}</span> },
    { key: 'confidential', header: 'Access', render: (c) => c.confidential
      ? <span className="pill inline-flex items-center gap-1 bg-red-100 text-red-700"><Lock size={10} /> Confidential</span>
      : <span className="text-xs text-neutral-400">Standard</span> },
    { key: 'status', header: 'Status', render: (c) => <StatusPill value={c.status} /> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-neutral-500">
          {pagination.total} case{pagination.total === 1 ? '' : 's'}
          {!can('hr.cases.confidential') && <span className="ml-2 text-neutral-400">· confidential cases are hidden from your role</span>}
        </p>
        {can('hr.cases') && (
          <button className="btn-gold inline-flex items-center gap-1.5" onClick={openForm}><Plus size={15} /> Open Case</button>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-line">
        <DataTable
          rows={rows} columns={cols} loading={loading} rowKey={(c) => c.id}
          onRowClick={(c) => setDetail(c)}
          page={pagination.page} pageSize={pagination.pageSize} total={pagination.total} totalPages={pagination.totalPages}
          onPageChange={setPage}
          emptyTitle="No employee relations cases" emptyHint="Grievances, disciplinary matters, incidents and investigations are recorded here with restricted access."
          toolbar={
            <TableToolbar>
              <div className="relative min-w-[180px] flex-1">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search cases…" aria-label="Search cases" className="field !py-1.5 !pl-9 text-xs" />
              </div>
              <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status" className="field !w-auto !py-1.5 text-xs">
                <option value="">All statuses</option>
                {STATUSES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
              </select>
            </TableToolbar>
          }
        />
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Open HR case" width="max-w-xl">
        <FormGrid>
          <div className="sm:col-span-2"><Field label="Title" required><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} autoFocus /></Field></div>
          <Field label="Employee">
            <Select value={form.staff_id} onChange={(e) => setForm({ ...form, staff_id: e.target.value })}>
              <option value="">Not linked to one employee</option>
              {employees.map((s) => <option key={s.id} value={s.id}>{s.employee_ref} — {s.full_name}</option>)}
            </Select>
          </Field>
          <Field label="Type">
            <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {TYPES.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
            </Select>
          </Field>
          <Field label="Severity">
            <Select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
              {['low', 'normal', 'high', 'urgent'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
            </Select>
          </Field>
          <Field label="Due date"><Input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></Field>
          <div className="sm:col-span-2"><Field label="Description"><Textarea className="!min-h-24" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field></div>
          <label className="flex items-center gap-2 text-xs text-neutral-600 sm:col-span-2">
            <input type="checkbox" checked={form.confidential} onChange={(e) => setForm({ ...form, confidential: e.target.checked })} className="accent-[#B8860B]" />
            Confidential — visible only to users with the confidential HR case permission
          </label>
        </FormGrid>
        <FormActions>
          <button className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
          <button className="btn-gold" onClick={submit}>Open Case</button>
        </FormActions>
      </Modal>

      <Modal open={Boolean(detail)} onClose={() => setDetail(null)} title={detail ? `${detail.case_ref} — ${detail.title}` : ''} width="max-w-lg">
        {detail && (
          <div>
            <div className="mb-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <div className="rounded-lg border border-line bg-neutral-50 px-3 py-2"><p className="text-[10px] uppercase text-neutral-400">Type</p><p className="text-sm font-bold">{titleCase(detail.type)}</p></div>
              <div className="rounded-lg border border-line bg-neutral-50 px-3 py-2"><p className="text-[10px] uppercase text-neutral-400">Severity</p><p className="text-sm font-bold">{titleCase(detail.severity)}</p></div>
              <div className="rounded-lg border border-line bg-neutral-50 px-3 py-2"><p className="text-[10px] uppercase text-neutral-400">Status</p><StatusPill value={detail.status} /></div>
              <div className="rounded-lg border border-line bg-neutral-50 px-3 py-2"><p className="text-[10px] uppercase text-neutral-400">Opened</p><p className="text-sm font-bold">{fmtDate(detail.created_at)}</p></div>
            </div>
            <p className="rounded-lg border border-line px-3.5 py-2.5 text-xs text-neutral-600">{detail.description || 'No description recorded.'}</p>

            <div className="mt-3 flex flex-wrap gap-1.5">
              {STATUSES.filter((s) => s !== detail.status).map((s) => (
                <button key={s} className="btn-ghost !py-1 text-[11px]" onClick={() => changeStatus(detail.id, s)}>Mark {titleCase(s)}</button>
              ))}
            </div>

            <div className="mt-3">
              <Field label="Add note">
                <Textarea className="!min-h-16" value={note} onChange={(e) => setNote(e.target.value)} />
              </Field>
              <button className="btn-ghost mt-2 !py-1 text-xs" onClick={addNote}>Add note</button>
            </div>

            <FormActions><button className="btn-ghost" onClick={() => setDetail(null)}>Close</button></FormActions>
          </div>
        )}
      </Modal>
    </div>
  );
}
