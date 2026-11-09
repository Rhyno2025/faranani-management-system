import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Search, Wrench, CheckCircle2, Camera, Link2, HardHat } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../auth';
import {
  PageHeader, Field, Input, Select, Textarea, FormGrid, FormActions, Modal,
  StatusPill, PriorityPill, toast, Spinner, MiniStat, ConfirmDialog,
} from '../components/ui';
import { DataTable, Column, TableToolbar } from '../components/DataTable';
import { fmtDate, fmtDateTime, titleCase, zar } from '../lib/format';
import type { MaintenanceJob, Paginated, Property, Complaint, Staff } from '../lib/types';

const STATUSES = ['pending', 'assigned', 'in_progress', 'completed', 'verified', 'cancelled'];
const STAFF_STATUSES = ['pending', 'assigned', 'in_progress', 'completed'];

export default function Maintenance() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [rows, setRows] = useState<MaintenanceJob[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 15, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState({ status: '', priority: '', property_id: '', assigned_to: '', open: 'true' });
  const [page, setPage] = useState(1);
  const [properties, setProperties] = useState<Property[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [detail, setDetail] = useState<(MaintenanceJob & any) | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', priority: 'normal', property_id: '', room_id: '', complaint_id: '', assigned_to: '', due_date: '', estimated_cost: 0, materials: '' });
  const [saving, setSaving] = useState(false);
  const [editOpen, setEditOpen] = useState<MaintenanceJob | null>(null);
  const [editForm, setEditForm] = useState({ status: '', assigned_to: '', work_notes: '', actual_cost: 0, priority: '' });
  const [verifyOpen, setVerifyOpen] = useState<MaintenanceJob | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ page: String(page), pageSize: '15' });
      if (q) p.set('q', q);
      Object.entries(filters).forEach(([k, v]) => { if (v) p.set(k, v); });
      const res = await api.get<Paginated<MaintenanceJob>>(`/maintenance?${p.toString()}`);
      setRows(res.data); setPagination(res.pagination);
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  }, [page, q, filters]);

  useEffect(() => { const t = setTimeout(load, q ? 300 : 0); return () => clearTimeout(t); }, [load, q]);
  useEffect(() => {
    api.get<Paginated<Property>>('/properties?pageSize=100').then((r) => setProperties(r.data)).catch(() => {});
    api.get<Paginated<Staff>>('/staff?pageSize=200').then((r) => setStaff(r.data)).catch(() => {});
  }, []);

  const openDetail = async (id: string) => {
    setDetailLoading(true);
    try {
      const data = await api.get<MaintenanceJob & any>(`/maintenance/${id}`);
      setDetail(data);
      const next = new URLSearchParams(params); next.set('id', id); setParams(next, { replace: true });
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setDetailLoading(false); }
  };
  const closeDetail = () => {
    setDetail(null);
    const next = new URLSearchParams(params); next.delete('id'); setParams(next, { replace: true });
  };

  useEffect(() => {
    const id = params.get('id');
    if (id) openDetail(id);
    const cid = params.get('complaint_id');
    if (params.get('new')) {
      setForm((f) => ({ ...f, complaint_id: cid || '' }));
      setFormOpen(true);
      params.delete('new'); params.delete('complaint_id'); setParams(params, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async () => {
    if (!form.title.trim() || !form.description.trim()) { toast('Title and description are required', 'error'); return; }
    setSaving(true);
    try {
      const payload: any = { ...form, estimated_cost: Number(form.estimated_cost) || 0 };
      payload.materials = form.materials.split(',').map((s) => s.trim()).filter(Boolean);
      const created = await api.post<MaintenanceJob>('/maintenance', payload);
      toast(`Job ${created.job_ref} created`);
      setFormOpen(false); load();
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setSaving(false); }
  };

  const saveEdit = async () => {
    if (!editOpen) return;
    try {
      await api.patch(`/maintenance/${editOpen.id}`, {
        ...editForm,
        estimated_cost: Number(editForm.actual_cost) || 0,
        actual_cost: Number(editForm.actual_cost) || 0,
      });
      toast('Job updated');
      setEditOpen(null); load();
      if (detail?.id === editOpen.id) openDetail(editOpen.id);
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const verifyJob = async () => {
    if (!verifyOpen) return;
    try {
      await api.patch(`/maintenance/${verifyOpen.id}`, { status: 'verified' });
      toast('Job verified & closed');
      setVerifyOpen(null); load();
      if (detail?.id === verifyOpen.id) openDetail(verifyOpen.id);
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const cols: Column<MaintenanceJob>[] = [
    { key: 'job_ref', header: 'Job Ref', render: (j) => <span className="font-mono text-xs font-bold text-gold-dark">{j.job_ref}</span> },
    {
      key: 'title', header: 'Job',
      render: (j) => (
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-amber-100 text-amber-700"><Wrench size={13} /></span>
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-neutral-800">{j.title}</p>
            {j.ticket_ref && <p className="text-[10.5px] text-neutral-400">from {j.ticket_ref}</p>}
          </div>
        </div>
      ),
    },
    { key: 'location', header: 'Location', render: (j) => <span className="text-xs text-neutral-600">{j.property_name || '—'}{j.building_name ? ` / ${j.building_name}` : ''}{j.room_number ? ` / Room ${j.room_number}` : ''}</span> },
    { key: 'priority', header: 'Priority', render: (j) => <PriorityPill value={j.priority} /> },
    { key: 'assignee', header: 'Assigned', render: (j) => <span className="text-xs text-neutral-600">{j.assignee_name || <span className="text-neutral-400">Unassigned</span>}</span> },
    { key: 'due_date', header: 'Due', render: (j) => <span className={`whitespace-nowrap text-xs ${j.due_date && new Date(j.due_date) < new Date() && !['completed','verified'].includes(j.status) ? 'font-semibold text-red-600' : 'text-neutral-500'}`}>{fmtDate(j.due_date)}</span> },
    { key: 'status', header: 'Status', render: (j) => <StatusPill value={j.status} /> },
    {
      key: 'actions', header: '', className: 'text-right',
      render: (j) => can('maintenance.manage') && (
        <button className="btn-ghost !py-1 text-[11px]" onClick={(e) => { e.stopPropagation(); setEditOpen(j); setEditForm({ status: j.status, assigned_to: j.assigned_to || '', work_notes: j.work_notes || '', actual_cost: j.actual_cost || 0, priority: j.priority }); }}>
          Manage
        </button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Maintenance"
        subtitle="Jobs raised from complaints or manually. Completing a job never auto-closes the linked complaint."
        actions={can('maintenance.manage') && (
          <button className="btn-gold inline-flex items-center gap-1.5" onClick={() => setFormOpen(true)}>
            <Plus size={15} /> New Job
          </button>
        )}
      />

      <div className="panel overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
          <div className="relative min-w-[200px] flex-1">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search jobs…" aria-label="Search jobs" className="field !py-1.5 !pl-9 text-xs" />
          </div>
          <select aria-label="Open/all" className="field !w-auto !py-1.5 text-xs"
            value={filters.open} onChange={(e) => { setFilters({ ...filters, open: e.target.value }); setPage(1); }}>
            <option value="true">Open jobs</option>
            <option value="">All jobs</option>
          </select>
          <select aria-label="Status filter" className="field !w-auto !py-1.5 text-xs"
            value={filters.status} onChange={(e) => { setFilters({ ...filters, status: e.target.value }); setPage(1); }}>
            <option value="">All Statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
          </select>
          <select aria-label="Priority filter" className="field !w-auto !py-1.5 text-xs"
            value={filters.priority} onChange={(e) => { setFilters({ ...filters, priority: e.target.value }); setPage(1); }}>
            <option value="">All Priorities</option>
            {['urgent', 'high', 'normal', 'low'].map((p) => <option key={p} value={p}>{titleCase(p)}</option>)}
          </select>
          <select aria-label="Property filter" className="field !w-auto !py-1.5 text-xs"
            value={filters.property_id} onChange={(e) => { setFilters({ ...filters, property_id: e.target.value }); setPage(1); }}>
            <option value="">All Properties</option>
            {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>

        <DataTable
          rows={rows} columns={cols} loading={loading} rowKey={(j) => j.id}
          onRowClick={(j) => openDetail(j.id)}
          page={pagination.page} pageSize={pagination.pageSize} total={pagination.total}
          totalPages={pagination.totalPages} onPageChange={setPage}
          emptyTitle="No maintenance requests have been submitted yet"
          emptyHint="Raise a job manually, or from a complaint in the Complaints module."
        />
      </div>

      {/* detail */}
      <Modal open={detailLoading || Boolean(detail)} onClose={closeDetail}
        title={detail ? `${detail.job_ref} — ${detail.title}` : 'Job'} width="max-w-3xl">
        {detailLoading || !detail ? <Spinner /> : (
          <div>
            <div className="mb-3.5 flex flex-wrap items-center gap-2">
              <PriorityPill value={detail.priority} />
              <StatusPill value={detail.status} />
              {detail.ticket_ref && <span className="pill bg-neutral-100 text-neutral-600">from {detail.ticket_ref}</span>}
              {detail.complaint_status && <span className="pill bg-neutral-100 text-neutral-500">complaint: {titleCase(detail.complaint_status)}</span>}
            </div>
            <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <MiniStat label="Location" value={`${detail.property_name || '—'} / Room ${detail.room_number || '—'}`} />
              <MiniStat label="Assigned" value={detail.assignee_name || 'Unassigned'} />
              <MiniStat label="Due" value={fmtDate(detail.due_date)} tone={detail.due_date && new Date(detail.due_date) < new Date() ? 'red' : 'default'} />
              <MiniStat label="Cost (est / actual)" value={`${zar(detail.estimated_cost)} / ${zar(detail.actual_cost)}`} />
            </div>
            <div className="mb-3 rounded-lg border border-line px-3.5 py-2.5 text-sm text-neutral-700">
              <p className="whitespace-pre-wrap">{detail.description}</p>
            </div>
            {detail.work_notes && (
              <div className="mb-3 rounded-lg border border-line px-3.5 py-2.5 text-sm text-neutral-700">
                <p className="mb-1 text-xs font-bold uppercase tracking-wide text-neutral-500">Work notes</p>
                <p className="whitespace-pre-wrap">{detail.work_notes}</p>
              </div>
            )}
            {detail.verified_by && (
              <p className="mb-3 flex items-center gap-1.5 text-xs text-emerald-700">
                <CheckCircle2 size={14} /> Verified by {detail.verified_by} on {fmtDateTime(detail.verified_at)}
              </p>
            )}
            {can('maintenance.manage') && (
              <div className="flex flex-wrap gap-2 rounded-lg bg-neutral-50 px-3 py-2.5">
                <button className="btn-ghost !py-1.5 text-xs" onClick={() => { setEditOpen(detail); setEditForm({ status: detail.status, assigned_to: detail.assigned_to || '', work_notes: detail.work_notes || '', actual_cost: detail.actual_cost || 0, priority: detail.priority }); }}>
                  <Wrench size={13} className="mr-1 inline" />Update Job
                </button>
                {['completed', 'in_progress'].includes(detail.status) && (
                  <button className="btn-gold !py-1.5 text-xs" onClick={() => setVerifyOpen(detail)}>
                    <CheckCircle2 size={13} className="mr-1 inline" />Verify & Close
                  </button>
                )}
              </div>
            )}
            <FormActions><button className="btn-ghost" onClick={closeDetail}>Close</button></FormActions>
          </div>
        )}
      </Modal>

      {/* create */}
      <Modal open={formOpen} onClose={() => setFormOpen(false)} title="New maintenance job" width="max-w-2xl">
        <FormGrid>
          <div className="sm:col-span-2">
            <Field label="Title" required>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Fix leaking tap" autoFocus />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Description" required>
              <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </Field>
          </div>
          <Field label="Priority">
            <Select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
              {['low', 'normal', 'high', 'urgent'].map((p) => <option key={p} value={p}>{titleCase(p)}</option>)}
            </Select>
          </Field>
          <Field label="Assign to">
            <Select value={form.assigned_to} onChange={(e) => setForm({ ...form, assigned_to: e.target.value })}>
              <option value="">Unassigned</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name} — {s.department || s.job_title || ''}</option>)}
            </Select>
          </Field>
          <Field label="Property">
            <Select value={form.property_id} onChange={(e) => setForm({ ...form, property_id: e.target.value })}>
              <option value="">Unassigned</option>
              {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
          <Field label="Estimated cost (ZAR)">
            <Input type="number" min={0} step={50} value={form.estimated_cost} onChange={(e) => setForm({ ...form, estimated_cost: Number(e.target.value) })} />
          </Field>
          <Field label="Due date">
            <Input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
          </Field>
          <Field label="Materials" hint="Comma separated">
            <Input value={form.materials} onChange={(e) => setForm({ ...form, materials: e.target.value })} placeholder="PVC pipe, sealant, washers" />
          </Field>
        </FormGrid>
        {form.complaint_id && (
          <p className="mt-3 rounded-lg bg-gold-soft px-3 py-2 text-[11.5px] text-gold-dark">
            Linked to complaint — the student will see progress updates, but this complaint will not be closed automatically.
          </p>
        )}
        <FormActions>
          <button className="btn-ghost" onClick={() => setFormOpen(false)}>Cancel</button>
          <button className="btn-gold" onClick={submit} disabled={saving}>{saving ? 'Saving…' : 'Create Job'}</button>
        </FormActions>
      </Modal>

      {/* edit */}
      <Modal open={Boolean(editOpen)} onClose={() => setEditOpen(null)} title={editOpen ? `Update ${editOpen.job_ref}` : ''} width="max-w-xl">
        {editOpen && (
          <>
            <FormGrid>
              <Field label="Status">
                <Select value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}>
                  {STAFF_STATUSES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
                </Select>
              </Field>
              <Field label="Assign to">
                <Select value={editForm.assigned_to} onChange={(e) => setEditForm({ ...editForm, assigned_to: e.target.value })}>
                  <option value="">Unassigned</option>
                  {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                </Select>
              </Field>
              <Field label="Actual cost (ZAR)">
                <Input type="number" min={0} step={50} value={editForm.actual_cost} onChange={(e) => setEditForm({ ...editForm, actual_cost: Number(e.target.value) })} />
              </Field>
            </FormGrid>
            <div className="mt-3.5">
              <Field label="Work notes">
                <Textarea value={editForm.work_notes} onChange={(e) => setEditForm({ ...editForm, work_notes: e.target.value })} />
              </Field>
            </div>
            <FormActions>
              <button className="btn-ghost" onClick={() => setEditOpen(null)}>Cancel</button>
              <button className="btn-gold" onClick={saveEdit}>Save Changes</button>
            </FormActions>
          </>
        )}
      </Modal>

      <ConfirmDialog open={Boolean(verifyOpen)} onClose={() => setVerifyOpen(null)} onConfirm={verifyJob}
        title="Verify & close job?" message="This marks the maintenance work as verified. The linked complaint stays open until it is resolved separately."
        confirmLabel="Verify Job" danger={false} />
    </div>
  );
}
