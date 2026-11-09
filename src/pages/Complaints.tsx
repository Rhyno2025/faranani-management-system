import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Plus, Search, MessageSquare, Clock, User, Building2, Wrench, Send, History, ShieldAlert, Filter,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../auth';
import {
  PageHeader, Field, Input, Select, Textarea, FormGrid, FormActions, Modal,
  StatusPill, PriorityPill, toast, Spinner, EmptyState, MiniStat, Tabs, ConfirmDialog,
} from '../components/ui';
import { DataTable, Column, TableToolbar } from '../components/DataTable';
import { fmtDate, fmtDateTime, fmtWhen, titleCase } from '../lib/format';
import type { Complaint, Paginated, Property, Student, Staff } from '../lib/types';

const CATEGORIES = ['Plumbing', 'Electrical', 'Cleaning', 'Security', 'Noise', 'Room Conditions', 'Internet Access', 'Facilities', 'Other'];
const STATUSES = ['open', 'acknowledged', 'assigned', 'in_progress', 'awaiting_student', 'escalated', 'resolved', 'closed'];
const OPEN_STATUSES = ['open', 'acknowledged', 'assigned', 'in_progress', 'awaiting_student', 'escalated'];
const DEPTS = ['Maintenance', 'Housekeeping', 'Security', 'Facilities', 'Admissions', 'Finance'];

export default function Complaints() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [rows, setRows] = useState<Complaint[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 15, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'all' | 'open' | 'resolved'>('open');
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState({ status: '', category: '', priority: '', property_id: '', assigned_dept: '' });
  const [page, setPage] = useState(1);
  const [properties, setProperties] = useState<Property[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);

  const [detail, setDetail] = useState<(Complaint & any) | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [comment, setComment] = useState('');
  const [internal, setInternal] = useState(false);
  const [postingComment, setPostingComment] = useState(false);
  const [statusModal, setStatusModal] = useState<{ status: string; notes: string; studentMessage: string } | null>(null);
  const [assignOpen, setAssignOpen] = useState<{ dept: string; to: string }>({ dept: '', to: '' });

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ subject: '', description: '', category: 'Other', priority: 'normal', student_id: '', property_id: '', message: '' });
  const [students, setStudents] = useState<Student[]>([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ page: String(page), pageSize: '15' });
      if (q) p.set('q', q);
      if (tab === 'open') p.set('open', 'true');
      Object.entries(filters).forEach(([k, v]) => { if (v) p.set(k, v); });
      const res = await api.get<Paginated<Complaint>>(`/complaints?${p.toString()}`);
      setRows(res.data); setPagination(res.pagination);
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  }, [page, q, tab, filters]);

  useEffect(() => { const t = setTimeout(load, q ? 300 : 0); return () => clearTimeout(t); }, [load, q]);
  useEffect(() => {
    api.get<Paginated<Property>>('/properties?pageSize=100').then((r) => setProperties(r.data)).catch(() => {});
    api.get<Paginated<Staff>>('/staff?pageSize=200').then((r) => setStaff(r.data)).catch(() => {});
  }, []);

  const openDetail = async (id: string) => {
    setDetailLoading(true);
    try {
      const data = await api.get<Complaint & any>(`/complaints/${id}`);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const postComment = async () => {
    if (!comment.trim() || !detail) return;
    setPostingComment(true);
    try {
      await api.post(`/complaints/${detail.id}/comments`, { body: comment, visibility: internal ? 'internal' : 'student_visible' });
      setComment(''); setInternal(false);
      toast('Update added');
      openDetail(detail.id);
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setPostingComment(false); }
  };

  const applyStatus = async () => {
    if (!statusModal || !detail) return;
    try {
      await api.patch(`/complaints/${detail.id}`, {
        status: statusModal.status,
        resolution_notes: statusModal.notes,
        note: statusModal.notes,
        student_message: statusModal.studentMessage,
      });
      toast(`Complaint marked ${titleCase(statusModal.status)}`);
      setStatusModal(null); openDetail(detail.id); load();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const applyAssign = async () => {
    if (!detail) return;
    try {
      await api.patch(`/complaints/${detail.id}`, { assigned_dept: assignOpen.dept, assigned_to: assignOpen.to });
      toast('Assignment updated');
      setAssignOpen({ dept: '', to: '' }); openDetail(detail.id); load();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const createComplaint = async () => {
    if (!form.subject.trim() || !form.description.trim()) { toast('Subject and description are required', 'error'); return; }
    setSaving(true);
    try {
      const res = await api.post<{ ticket_ref: string }>('/complaints', { ...form, submitted_via: 'staff' });
      toast(`Complaint ${res.ticket_ref} logged`);
      setCreateOpen(false); setForm({ subject: '', description: '', category: 'Other', priority: 'normal', student_id: '', property_id: '', message: '' });
      load();
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setSaving(false); }
  };

  const openCreate = async () => {
    try {
      const s = await api.get<Paginated<Student>>('/students?pageSize=300');
      setStudents(s.data);
    } catch { setStudents([]); }
    setCreateOpen(true);
  };

  const cols: Column<Complaint>[] = useMemo(() => [
    { key: 'ticket_ref', header: 'Ticket', render: (c) => <span className="font-mono text-xs font-bold text-gold-dark">{c.ticket_ref}</span> },
    {
      key: 'student', header: 'Student / Reference',
      render: (c) => (
        <div className="text-xs">
          <p className="font-medium text-neutral-800">{c.student_name || 'Walk-in / Public'}</p>
          {c.student_ref && <p className="text-[11px] text-neutral-400">{c.student_ref}</p>}
        </div>
      ),
    },
    {
      key: 'location', header: 'Property / Room',
      render: (c) => <span className="text-xs text-neutral-600">{c.property_name ? `${c.property_name} / ${c.building_name || ''} / Room ${c.room_number || '—'}` : '—'}</span>,
    },
    { key: 'subject', header: 'Complaint', render: (c) => <span className="block max-w-[200px] truncate text-xs font-medium text-neutral-700" title={c.subject}>{c.subject}</span> },
    { key: 'priority', header: 'Priority', render: (c) => <PriorityPill value={c.priority} /> },
    { key: 'assigned_dept', header: 'Department', render: (c) => <span className="text-xs text-neutral-600">{c.assigned_dept || '—'}</span> },
    { key: 'assignee', header: 'Assignee', render: (c) => <span className="text-xs text-neutral-600">{c.assignee_name || <span className="text-neutral-400">Unassigned</span>}</span> },
    { key: 'created_at', header: 'Submitted', render: (c) => <span className="whitespace-nowrap text-xs text-neutral-500">{fmtDateTime(c.created_at)}</span> },
    { key: 'status', header: 'Status', render: (c) => <StatusPill value={c.status} /> },
  ], []);

  const counts = {
    all: pagination.total,
    open: rows.filter((c) => OPEN_STATUSES.includes(c.status)).length,
    resolved: rows.filter((c) => ['resolved', 'closed'].includes(c.status)).length,
  };

  return (
    <div>
      <PageHeader
        title="Complaints & Requests"
        subtitle="One shared record across the public website, student portal and this system."
        actions={
          can('complaints.manage') && (
            <button className="btn-gold inline-flex items-center gap-1.5" onClick={openCreate}>
              <Plus size={15} /> Log Complaint
            </button>
          )
        }
      />

      <div className="panel overflow-hidden">
        <div className="border-b border-line px-4 pt-2">
          <Tabs active={tab} onChange={(k) => setTab(k as any)} tabs={[
            { key: 'open', label: 'Open & Active', count: counts.open },
            { key: 'all', label: 'All Complaints', count: counts.all },
            { key: 'resolved', label: 'Resolved / Closed', count: counts.resolved },
          ]} />
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
          <div className="relative min-w-[200px] flex-1">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }}
              placeholder="Search tickets, students, subjects…" aria-label="Search complaints"
              className="field !py-1.5 !pl-9 text-xs" />
          </div>
          <select aria-label="Category filter" className="field !w-auto !py-1.5 text-xs"
            value={filters.category} onChange={(e) => { setFilters({ ...filters, category: e.target.value }); setPage(1); }}>
            <option value="">All Categories</option>
            {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
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
          <select aria-label="Department filter" className="field !w-auto !py-1.5 text-xs"
            value={filters.assigned_dept} onChange={(e) => { setFilters({ ...filters, assigned_dept: e.target.value }); setPage(1); }}>
            <option value="">All Departments</option>
            {DEPTS.map((d) => <option key={d}>{d}</option>)}
          </select>
        </div>

        <DataTable
          rows={rows} columns={cols} loading={loading} rowKey={(c) => c.id}
          onRowClick={(c) => openDetail(c.id)}
          page={pagination.page} pageSize={pagination.pageSize} total={pagination.total}
          totalPages={pagination.totalPages} onPageChange={setPage}
          emptyTitle="No complaints recorded yet"
          emptyHint="Complaints submitted on the website or portal appear here instantly — no duplicate records are created."
        />
      </div>

      {/* ============ detail ============ */}
      <Modal open={detailLoading || Boolean(detail)} onClose={closeDetail}
        title={detail ? `${detail.ticket_ref} — ${detail.subject}` : 'Complaint'} width="max-w-4xl">
        {detailLoading || !detail ? <Spinner /> : (
          <div>
            <div className="mb-3.5 flex flex-wrap items-center gap-2">
              <PriorityPill value={detail.priority} />
              <StatusPill value={detail.status} />
              <span className="pill bg-neutral-100 text-neutral-600">{detail.category}</span>
              <span className="pill bg-neutral-100 text-neutral-500">via {detail.submitted_via}</span>
            </div>

            <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <MiniStat label="Student" value={detail.student_name || 'Public'} />
              <MiniStat label="Location" value={`${detail.property_name || '—'} / Room ${detail.room_number || '—'}`} />
              <MiniStat label="Department" value={detail.assigned_dept || 'Unassigned'} />
              <MiniStat label="Assignee" value={detail.assignee_name || 'Unassigned'} />
            </div>

            <div className="mb-3 rounded-lg border border-line px-3.5 py-2.5 text-sm text-neutral-700">
              <p className="whitespace-pre-wrap">{detail.description}</p>
            </div>

            <div className="mb-4 grid grid-cols-2 gap-2.5 text-xs text-neutral-500 sm:grid-cols-4">
              <div><span className="block font-semibold text-neutral-400">Submitted</span>{fmtDateTime(detail.submitted_at)}</div>
              <div><span className="block font-semibold text-neutral-400">SLA Due</span>{detail.due_at ? fmtDateTime(detail.due_at) : '—'}</div>
              <div><span className="block font-semibold text-neutral-400">Resolved</span>{fmtDateTime(detail.resolved_at)}</div>
              <div><span className="block font-semibold text-neutral-400">Student contact</span>{detail.student_email || '—'}</div>
            </div>

            {/* actions */}
            {can('complaints.manage') && (
              <div className="mb-4 flex flex-wrap gap-2 rounded-lg bg-neutral-50 px-3 py-2.5">
                <button className="btn-ghost !py-1.5 text-xs" onClick={() => setAssignOpen({ dept: detail.assigned_dept || '', to: detail.assigned_to || '' })}>
                  <User size={13} className="mr-1 inline" />Assign
                </button>
                {!['resolved', 'closed'].includes(detail.status) && (
                  <button className="btn-ghost !py-1.5 text-xs" onClick={() => setStatusModal({ status: 'in_progress', notes: '', studentMessage: '' })}>
                    Advance Status
                  </button>
                )}
                {detail.status !== 'resolved' && (
                  <button className="btn-ghost !py-1.5 text-xs" onClick={() => setStatusModal({ status: 'resolved', notes: '', studentMessage: 'Your complaint has been resolved.' })}>
                    Mark Resolved
                  </button>
                )}
                {detail.status !== 'closed' && (
                  <button className="btn-ghost !py-1.5 text-xs" onClick={() => setStatusModal({ status: 'closed', notes: '', studentMessage: '' })}>
                    Close
                  </button>
                )}
                {can('maintenance.manage') && (
                  <a className="btn-gold !py-1.5 text-xs" href={`/maintenance?new=1&complaint_id=${detail.id}`}>
                    <Wrench size={13} className="mr-1 inline" />Raise Maintenance Job
                  </a>
                )}
              </div>
            )}

            {/* linked maintenance */}
            {(detail.maintenance_jobs || []).length > 0 && (
              <div className="mb-4 rounded-lg border border-line">
                <p className="flex items-center gap-1.5 border-b border-line px-3.5 py-2 text-xs font-bold uppercase tracking-wide text-neutral-500">
                  <Wrench size={13} /> Linked maintenance jobs
                </p>
                {detail.maintenance_jobs.map((j: any) => (
                  <div key={j.id} className="flex items-center justify-between px-3.5 py-2 text-xs">
                    <span className="font-mono font-semibold text-neutral-700">{j.job_ref} — {j.title}</span>
                    <StatusPill value={j.status} />
                  </div>
                ))}
                <p className="px-3.5 pb-2 text-[11px] text-neutral-400">Completing a job does not close this complaint — resolution is a separate decision.</p>
              </div>
            )}

            {/* status history */}
            <div className="mb-4 rounded-lg border border-line">
              <p className="flex items-center gap-1.5 border-b border-line px-3.5 py-2 text-xs font-bold uppercase tracking-wide text-neutral-500">
                <History size={13} /> Status history
              </p>
              <div className="max-h-40 overflow-y-auto px-3.5 py-2">
                {(detail.history || []).map((h: any) => (
                  <div key={h.id} className="flex items-center gap-2 py-1 text-xs">
                    <span className="text-neutral-400">{fmtDateTime(h.changed_at)}</span>
                    <span className="text-neutral-600">
                      {h.from_status ? titleCase(h.from_status) : 'Created'} → <span className="font-semibold">{titleCase(h.to_status)}</span>
                      <span className="text-neutral-400"> by {h.changed_by_name}</span>
                      {h.note && <span className="text-neutral-400"> — {h.note}</span>}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* comments */}
            <div className="rounded-lg border border-line">
              <p className="border-b border-line px-3.5 py-2 text-xs font-bold uppercase tracking-wide text-neutral-500">Updates & notes</p>
              <div className="max-h-56 space-y-2 overflow-y-auto px-3.5 py-2.5">
                {(detail.comments || []).length === 0 && <p className="text-xs text-neutral-400">No updates yet.</p>}
                {(detail.comments || []).map((c: any) => (
                  <div key={c.id} className={`rounded-lg px-3 py-2 text-xs ${c.visibility === 'internal' ? 'bg-amber-50 border border-amber-200' : 'bg-neutral-50'}`}>
                    <div className="mb-1 flex items-center justify-between">
                      <span className="font-semibold text-neutral-700">{c.author_name || 'Student'}</span>
                      <span className="flex items-center gap-1.5 text-[10.5px] text-neutral-400">
                        {c.visibility === 'internal' && <span className="pill bg-amber-100 text-amber-700">Internal</span>}
                        {fmtWhen(c.created_at)}
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap text-neutral-600">{c.body}</p>
                  </div>
                ))}
              </div>
              <div className="border-t border-line px-3.5 py-2.5">
                <Textarea value={comment} onChange={(e) => setComment(e.target.value)}
                  placeholder="Add an update for the student (or an internal note)…" className="!min-h-16 text-xs" />
                <div className="mt-2 flex items-center justify-between">
                  {can('complaints.manage') ? (
                    <label className="flex items-center gap-1.5 text-xs text-neutral-500">
                      <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} className="accent-[#B8860B]" />
                      Internal note (not visible to student)
                    </label>
                  ) : <span />}
                  <button className="btn-gold !py-1.5 text-xs" onClick={postComment} disabled={postingComment || !comment.trim()}>
                    <Send size={12} className="mr-1 inline" />{postingComment ? 'Posting…' : 'Post Update'}
                  </button>
                </div>
              </div>
            </div>

            <FormActions><button className="btn-ghost" onClick={closeDetail}>Close</button></FormActions>
          </div>
        )}
      </Modal>

      {/* status change */}
      <Modal open={Boolean(statusModal)} onClose={() => setStatusModal(null)} title="Update complaint status" width="max-w-lg">
        {statusModal && (
          <>
            <Field label="New status" required>
              <Select value={statusModal.status} onChange={(e) => setStatusModal({ ...statusModal, status: e.target.value })}>
                {STATUSES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
              </Select>
            </Field>
            <div className="mt-3.5">
              <Field label={statusModal.status === 'resolved' ? 'Resolution details' : 'Internal note'}>
                <Textarea value={statusModal.notes} onChange={(e) => setStatusModal({ ...statusModal, notes: e.target.value })} />
              </Field>
            </div>
            {statusModal.status !== 'closed' && (
              <div className="mt-3.5">
                <Field label="Message to student" hint="The student sees this in their portal immediately.">
                  <Textarea value={statusModal.studentMessage} onChange={(e) => setStatusModal({ ...statusModal, studentMessage: e.target.value })} className="!min-h-16" />
                </Field>
              </div>
            )}
            <FormActions>
              <button className="btn-ghost" onClick={() => setStatusModal(null)}>Cancel</button>
              <button className="btn-gold" onClick={applyStatus}>Save Status</button>
            </FormActions>
          </>
        )}
      </Modal>

      {/* assign */}
      <Modal open={Boolean(statusModal) === false && Boolean(assignOpen.dept !== '' || (detail && assignOpen.to))} onClose={() => setAssignOpen({ dept: '', to: '' })}
        title="Assign complaint" width="max-w-md">
        <Field label="Department">
          <Select value={assignOpen.dept} onChange={(e) => setAssignOpen({ ...assignOpen, dept: e.target.value })}>
            <option value="">Unassigned</option>
            {DEPTS.map((d) => <option key={d}>{d}</option>)}
          </Select>
        </Field>
        <div className="mt-3.5">
          <Field label="Responsible staff member">
            <Select value={assignOpen.to} onChange={(e) => setAssignOpen({ ...assignOpen, to: e.target.value })}>
              <option value="">Unassigned</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name} — {s.department || s.job_title || ''}</option>)}
            </Select>
          </Field>
        </div>
        <FormActions>
          <button className="btn-ghost" onClick={() => setAssignOpen({ dept: '', to: '' })}>Cancel</button>
          <button className="btn-gold" onClick={applyAssign}>Assign</button>
        </FormActions>
      </Modal>

      {/* create */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Log a complaint (walk-in / phone)" width="max-w-2xl">
        <FormGrid>
          <div className="sm:col-span-2">
            <Field label="Subject" required>
              <Input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="Leaking bathroom pipe" autoFocus />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Description" required>
              <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </Field>
          </div>
          <Field label="Student" hint="Leave blank for anonymous walk-ins">
            <Select value={form.student_id} onChange={(e) => setForm({ ...form, student_id: e.target.value })}>
              <option value="">Not linked</option>
              {students.map((s) => <option key={s.id} value={s.id}>{s.student_ref} — {s.full_name}</option>)}
            </Select>
          </Field>
          <Field label="Category">
            <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </Select>
          </Field>
          <Field label="Priority">
            <Select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
              {['low', 'normal', 'high', 'urgent'].map((p) => <option key={p} value={p}>{titleCase(p)}</option>)}
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="Message for the student">
              <Textarea value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} className="!min-h-16" />
            </Field>
          </div>
        </FormGrid>
        <p className="mt-3 rounded-lg bg-gold-soft px-3 py-2 text-[11.5px] text-gold-dark">
          Urgent electrical, plumbing or security complaints are auto-escalated and routed to the correct department.
        </p>
        <FormActions>
          <button className="btn-ghost" onClick={() => setCreateOpen(false)}>Cancel</button>
          <button className="btn-gold" onClick={createComplaint} disabled={saving}>{saving ? 'Saving…' : 'Log Complaint'}</button>
        </FormActions>
      </Modal>
    </div>
  );
}
