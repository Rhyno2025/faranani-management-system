import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Plus, Search, Eye, CheckCircle2, XCircle, PauseCircle, Info, Upload, Trash2,
  Send, UserCheck, FileText, Download, BedDouble,
} from 'lucide-react';
import { api, uploadFile, downloadFile } from '../lib/api';
import { useAuth } from '../auth';
import {
  PageHeader, Field, Input, Select, Textarea, FormGrid, FormActions, Modal,
  StatusPill, toast, Spinner, EmptyState, Tabs, MiniStat, ConfirmDialog,
} from '../components/ui';
import { DataTable, Column, TableToolbar } from '../components/DataTable';
import { fmtDate, fmtDateTime, todayISO, titleCase, zar } from '../lib/format';
import type { Application, Paginated, Property, Student } from '../lib/types';

const STATUSES = ['draft', 'submitted', 'under_review', 'info_required', 'approved', 'waitlisted', 'rejected'];

export default function Applications() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const [rows, setRows] = useState<Application[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 20, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState(params.get('status') || '');
  const [propertyId, setPropertyId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [properties, setProperties] = useState<Property[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});

  const [detail, setDetail] = useState<(Application & any) | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busyKey, setBusyKey] = useState('');
  const [decision, setDecision] = useState<{ kind: 'approved' | 'rejected' | 'waitlisted' } | null>(null);
  const [decisionNote, setDecisionNote] = useState('');
  const [infoOpen, setInfoOpen] = useState(false);
  const [infoNote, setInfoNote] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [allocOpen, setAllocOpen] = useState(false);
  const [allocForm, setAllocForm] = useState({ student_id: '', bed_id: '', check_in_date: todayISO(), check_out_date: '' });
  const [freeBeds, setFreeBeds] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ page: String(page), pageSize: '20' });
      if (q) p.set('q', q);
      if (status) p.set('status', status);
      if (propertyId) p.set('property_id', propertyId);
      if (from) p.set('from', from);
      if (to) p.set('to', to);
      const res = await api.get<Paginated<Application>>(`/applications?${p.toString()}`);
      setRows(res.data);
      setPagination(res.pagination);
      // status counts for tabs (unfiltered)
      const c: Record<string, number> = {};
      for (const s of STATUSES) {
        const r = await api.get<Paginated<Application>>(`/applications?pageSize=1&status=${s}`);
        c[s] = r.pagination.total;
      }
      setCounts(c);
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  }, [page, q, status, propertyId, from, to]);

  useEffect(() => { const t = setTimeout(load, q ? 300 : 0); return () => clearTimeout(t); }, [load, q]);
  useEffect(() => {
    api.get<Paginated<Property>>('/properties?pageSize=100').then((r) => setProperties(r.data)).catch(() => {});
  }, []);

  const openDetail = async (id: string) => {
    setDetailLoading(true);
    try {
      const data = await api.get<Application & any>(`/applications/${id}`);
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

  const action = async (path: string, body?: any, key = path) => {
    setBusyKey(key);
    try {
      await api.post(path, body);
      toast('Application updated');
      if (detail) await openDetail(detail.id);
      load();
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setBusyKey(''); }
  };

  const submitDecision = async () => {
    if (!detail || !decision) return;
    if (decision.kind === 'rejected' && !decisionNote.trim()) {
      toast('A decision note is required when rejecting', 'error'); return;
    }
    await action(`/applications/${detail.id}/decision`, { decision: decision.kind, decision_notes: decisionNote }, 'decision');
    setDecision(null); setDecisionNote('');
  };

  const openAllocation = async () => {
    if (!detail) return;
    setAllocForm({ student_id: detail.student_id, bed_id: '', check_in_date: detail.move_in_date || todayISO(), check_out_date: '' });
    try {
      const beds = await api.get<{ data: any[] }>('/beds?pageSize=500');
      setFreeBeds((beds.data || []).filter((b) => b.live_status === 'available'));
    } catch { setFreeBeds([]); }
    setAllocOpen(true);
  };

  const confirmAllocation = async () => {
    if (!allocForm.bed_id) { toast('Select an available bed', 'error'); return; }
    setBusyKey('alloc');
    try {
      const res = await api.post('/allocations', { ...allocForm, application_id: detail?.id });
      toast(`Bed allocated — ${res.allocation_ref}`);
      setAllocOpen(false);
      if (detail) await openDetail(detail.id);
      load();
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setBusyKey(''); }
  };

  const uploadDoc = async (file: File) => {
    if (!detail) return;
    setUploading(true);
    try {
      await uploadFile(`/applications/${detail.id}/documents`, file, { doc_type: file.name.includes('id') ? 'ID Document' : 'Supporting Document' });
      toast('Document uploaded');
      await openDetail(detail.id);
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setUploading(false); }
  };

  const columns: Column<Application>[] = useMemo(() => [
    { key: 'app_ref', header: 'Reference', render: (a) => <span className="font-semibold text-neutral-700">{a.app_ref}</span> },
    {
      key: 'student', header: 'Applicant',
      render: (a) => (
        <div>
          <p className="font-medium text-neutral-800">{a.student_name}</p>
          <p className="text-[11px] text-neutral-400">{a.student_ref} · {a.student_email}</p>
        </div>
      ),
    },
    { key: 'property_name', header: 'Preferred Property', render: (a) => <span className="text-xs text-neutral-600">{a.property_name || '—'}</span> },
    { key: 'room_type_pref', header: 'Room Type', render: (a) => <span className="text-xs text-neutral-600">{a.room_type_pref || '—'}</span> },
    { key: 'move_in_date', header: 'Move-in', render: (a) => <span className="whitespace-nowrap text-xs text-neutral-500">{fmtDate(a.move_in_date)}</span> },
    {
      key: 'submitted_at', header: 'Submitted',
      render: (a) => <span className="whitespace-nowrap text-xs text-neutral-500">{fmtDate(a.submitted_at || a.created_at)}</span>,
    },
    {
      key: 'documents', header: 'Docs',
      render: (a) => (
        <span className={`pill ${(a.document_count || 0) > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
          {a.document_count || 0}
        </span>
      ),
    },
    { key: 'reviewer_name', header: 'Reviewer', render: (a) => <span className="text-xs text-neutral-600">{a.reviewer_name || 'Unassigned'}</span> },
    { key: 'status', header: 'Status', render: (a) => <StatusPill value={a.status} /> },
    {
      key: 'actions', header: '', className: 'text-right',
      render: (a) => (
        <button className="rounded p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-gold-dark"
          title="Review application" onClick={(e) => { e.stopPropagation(); openDetail(a.id); }}>
          <Eye size={14} />
        </button>
      ),
    },
  ], []);

  const d = detail;
  const canProcess = can('applications.process');

  return (
    <div>
      <PageHeader
        title="Applications & Admissions"
        subtitle="Review submitted applications, request information, approve or reject, then allocate a bed."
        actions={
          <>
            {can('reports.export') && (
              <button className="btn-ghost inline-flex items-center gap-1.5"
                onClick={async () => {
                  try {
                    await downloadFile(`/reports/admissions?format=csv${status ? `&status=${status}` : ''}`, `admissions-${todayISO()}.csv`);
                    toast('Admissions report exported');
                  } catch (e: any) { toast(e.message, 'error'); }
                }}>
                <Download size={14} /> Export
              </button>
            )}
            {canProcess && (
              <button className="btn-gold inline-flex items-center gap-1.5" onClick={() => setCreateOpen(true)}>
                <Plus size={15} /> New Application
              </button>
            )}
          </>
        }
      />

      <div className="panel overflow-hidden">
        <div className="border-b border-line px-4 pt-2">
          <Tabs active={status} onChange={(k) => { setStatus(k); setPage(1); }}
            tabs={[
              { key: '', label: 'All', count: pagination.total },
              ...STATUSES.map((s) => ({ key: s, label: titleCase(s), count: counts[s] ?? 0 })),
            ]} />
        </div>
        <DataTable
          rows={rows}
          columns={columns}
          loading={loading}
          rowKey={(a) => a.id}
          onRowClick={(a) => openDetail(a.id)}
          page={pagination.page}
          pageSize={pagination.pageSize}
          total={pagination.total}
          totalPages={pagination.totalPages}
          onPageChange={setPage}
          emptyTitle="No applications found"
          emptyHint="Applications submitted through the portal or registered by admissions appear here."
          toolbar={
            <TableToolbar>
              <div className="relative min-w-[200px] flex-1">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }}
                  placeholder="Search reference, applicant…" aria-label="Search applications"
                  className="field !py-1.5 !pl-9 text-xs" />
              </div>
              <select value={propertyId} onChange={(e) => { setPropertyId(e.target.value); setPage(1); }}
                aria-label="Filter property" className="field !w-auto !py-1.5 text-xs">
                <option value="">All Properties</option>
                {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }}
                aria-label="From date" className="field !w-auto !py-1.5 text-xs" />
              <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }}
                aria-label="To date" className="field !w-auto !py-1.5 text-xs" />
            </TableToolbar>
          }
        />
      </div>

      {/* ---------- detail / review drawer ---------- */}
      <Modal open={detailLoading || Boolean(d)} onClose={closeDetail}
        title={d ? `${d.app_ref} · ${d.student_name}` : 'Application'} width="max-w-4xl">
        {detailLoading || !d ? <Spinner /> : (
          <div>
            <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <MiniStat label="Status" value={<StatusPill value={d.status} />} />
              <MiniStat label="Move-in" value={fmtDate(d.move_in_date)} />
              <MiniStat label="Submitted" value={fmtDate(d.submitted_at || d.created_at)} />
              <MiniStat label="Reviewer" value={d.reviewer_name || 'Unassigned'} />
            </div>

            <div className="mb-4 grid gap-3 text-sm sm:grid-cols-2">
              <div className="rounded-lg border border-line bg-neutral-50/60 px-3 py-2">
                <p className="text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">Applicant</p>
                <p className="mt-0.5 font-medium text-neutral-700">{d.student_name} ({d.student_ref})</p>
                <p className="text-xs text-neutral-500">{d.student_email} · {d.student_phone || '—'}</p>
                <p className="text-xs text-neutral-500">{d.institution || ''}</p>
              </div>
              <div className="rounded-lg border border-line bg-neutral-50/60 px-3 py-2">
                <p className="text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">Request</p>
                <p className="mt-0.5 text-sm text-neutral-700">
                  {d.property_name || 'Any property'} · {d.room_type_pref || 'Any room type'}
                </p>
                <p className="text-xs text-neutral-500">
                  {fmtDate(d.move_in_date)} · {d.duration_months || 12} months
                </p>
              </div>
            </div>

            {/* documents */}
            <div className="mb-4 rounded-lg border border-line">
              <div className="flex items-center justify-between border-b border-line px-3.5 py-2">
                <p className="text-xs font-bold text-neutral-700">Supporting Documents ({d.documents?.length || 0})</p>
                {canProcess && (
                  <label className="btn-ghost inline-flex cursor-pointer items-center gap-1 !py-1 text-xs">
                    {uploading ? 'Uploading…' : <><Upload size={12} /> Upload</>}
                    <input type="file" hidden accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx,.txt,.csv"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadDoc(f); e.target.value = ''; }} />
                  </label>
                )}
              </div>
              <div className="divide-y divide-neutral-100">
                {(d.documents || []).map((doc: any) => (
                  <div key={doc.id} className="flex items-center justify-between px-3.5 py-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <FileText size={14} className="shrink-0 text-gold" />
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium text-neutral-700">{doc.file_name}</p>
                        <p className="text-[10.5px] text-neutral-400">{doc.doc_type} · {fmtDateTime(doc.uploaded_at)}</p>
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <a className="btn-ghost !py-1 text-[11px]" href={`/api/files/${encodeURIComponent(doc.stored_path)}`} target="_blank" rel="noreferrer">View</a>
                      {canProcess && (
                        <button className="rounded p-1.5 text-neutral-400 hover:bg-red-50 hover:text-red-600"
                          onClick={async () => {
                            try {
                              await api.del(`/applications/${d.id}/documents/${doc.id}`);
                              toast('Document removed'); await openDetail(d.id);
                            } catch (e: any) { toast(e.message, 'error'); }
                          }}><Trash2 size={13} /></button>
                      )}
                    </div>
                  </div>
                ))}
                {(d.documents || []).length === 0 && (
                  <p className="px-3.5 py-3 text-xs text-neutral-400">No documents uploaded yet.</p>
                )}
              </div>
            </div>

            {/* internal notes */}
            {d.notes?.length > 0 && (
              <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50/60 px-3.5 py-2.5">
                <p className="text-[11px] font-bold uppercase tracking-wide text-amber-700">Internal notes</p>
                {d.notes.map((n: any) => (
                  <p key={n.id} className="mt-1.5 text-xs text-amber-900">
                    <span className="font-semibold">{n.author_name}</span> · {fmtDateTime(n.created_at)}<br />{n.body}
                  </p>
                ))}
              </div>
            )}

            {d.status === 'approved' && d.decision_at && (
              <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs text-emerald-800">
                <CheckCircle2 size={13} className="mr-1 inline" />
                Approved on {fmtDateTime(d.decision_at)}{d.decision_notes ? ` — ${d.decision_notes}` : ''}
              </div>
            )}

            {/* workflow actions */}
            {canProcess && (
              <div className="rounded-lg border border-line bg-neutral-50/70 px-3.5 py-3">
                <p className="mb-2.5 text-[11px] font-bold uppercase tracking-wide text-neutral-500">Admissions actions</p>
                <div className="flex flex-wrap gap-2">
                  {d.status === 'draft' && (
                    <button className="btn-gold inline-flex items-center gap-1.5" disabled={busyKey === 'submit'}
                      onClick={() => action(`/applications/${d.id}/submit`, {}, 'submit')}>
                      <Send size={14} /> Submit Application
                    </button>
                  )}
                  {['submitted', 'info_required'].includes(d.status) && (
                    <button className="btn-gold inline-flex items-center gap-1.5" disabled={busyKey === 'review'}
                      onClick={() => action(`/applications/${d.id}/review`, {}, 'review')}>
                      <Eye size={14} /> Start Review
                    </button>
                  )}
                  {['submitted', 'under_review'].includes(d.status) && (
                    <>
                      <button className="btn-ghost inline-flex items-center gap-1.5" onClick={() => setInfoOpen(true)}>
                        <Info size={14} /> Request Information
                      </button>
                      <button className="btn-ghost inline-flex items-center gap-1.5 !border-emerald-300 !text-emerald-700 hover:!bg-emerald-50"
                        onClick={() => setDecision({ kind: 'approved' })}>
                        <CheckCircle2 size={14} /> Approve
                      </button>
                      <button className="btn-ghost inline-flex items-center gap-1.5" onClick={() => setDecision({ kind: 'waitlisted' })}>
                        <PauseCircle size={14} /> Waitlist
                      </button>
                      <button className="btn-ghost inline-flex items-center gap-1.5 !border-red-200 !text-red-600 hover:!bg-red-50"
                        onClick={() => setDecision({ kind: 'rejected' })}>
                        <XCircle size={14} /> Reject
                      </button>
                    </>
                  )}
                  {d.status === 'approved' && can('rooms.allocate') && (
                    <button className="btn-gold inline-flex items-center gap-1.5" onClick={openAllocation}>
                      <BedDouble size={14} /> Allocate Bed
                    </button>
                  )}
                  {can('rooms.allocate') && !d.status.includes('rejected') && (
                    <button className="btn-ghost inline-flex items-center gap-1.5" onClick={openAllocation}>
                      <UserCheck size={14} /> Allocate / Check-in
                    </button>
                  )}
                </div>
                <p className="mt-2 text-[10.5px] text-neutral-400">
                  Approval alone does not occupy a bed — a bed is only reserved after explicit allocation with valid dates.
                </p>
              </div>
            )}

            <FormActions>
              <button className="btn-ghost" onClick={closeDetail}>Close</button>
            </FormActions>
          </div>
        )}
      </Modal>

      {/* decision modal */}
      <Modal open={Boolean(decision)} onClose={() => setDecision(null)}
        title={decision ? `${titleCase(decision.kind)} application` : ''} width="max-w-md">
        <Field label={decision?.kind === 'rejected' ? 'Reason (required)' : 'Decision notes'}
          required={decision?.kind === 'rejected'}>
          <Textarea value={decisionNote} onChange={(e) => setDecisionNote(e.target.value)}
            placeholder={decision?.kind === 'approved' ? 'All documents verified.' : 'Provide a clear reason…'} />
        </Field>
        <FormActions>
          <button className="btn-ghost" onClick={() => setDecision(null)}>Cancel</button>
          <button className="btn-gold" onClick={submitDecision} disabled={busyKey === 'decision'}>
            {busyKey === 'decision' ? 'Saving…' : `Confirm ${titleCase(decision?.kind || '')}`}
          </button>
        </FormActions>
      </Modal>

      {/* request info modal */}
      <Modal open={infoOpen} onClose={() => setInfoOpen(false)} title="Request more information" width="max-w-md">
        <Field label="Information required" required>
          <Textarea value={infoNote} onChange={(e) => setInfoNote(e.target.value)}
            placeholder="e.g. Please upload a certified copy of your ID." />
        </Field>
        <p className="mt-2 text-[11px] text-neutral-500">The student is notified in their portal.</p>
        <FormActions>
          <button className="btn-ghost" onClick={() => setInfoOpen(false)}>Cancel</button>
          <button className="btn-gold" disabled={!infoNote.trim() || busyKey === 'info'}
            onClick={async () => {
              await action(`/applications/${d?.id}/request-info`, { note: infoNote }, 'info');
              setInfoOpen(false); setInfoNote('');
            }}>
            Send Request
          </button>
        </FormActions>
      </Modal>

      {/* allocate bed modal */}
      <Modal open={allocOpen} onClose={() => setAllocOpen(false)} title="Allocate bed / check-in" width="max-w-lg">
        <FormGrid>
          <Field label="Check-in date" required>
            <Input type="date" value={allocForm.check_in_date}
              onChange={(e) => setAllocForm({ ...allocForm, check_in_date: e.target.value })} />
          </Field>
          <Field label="Expected check-out">
            <Input type="date" value={allocForm.check_out_date}
              onChange={(e) => setAllocForm({ ...allocForm, check_out_date: e.target.value })} />
          </Field>
        </FormGrid>
        <div className="mt-3.5">
          <Field label="Available bed" required hint={`${freeBeds.length} free beds — availability is derived from existing allocations`}>
            <Select value={allocForm.bed_id} onChange={(e) => setAllocForm({ ...allocForm, bed_id: e.target.value })}>
              <option value="">Select a bed…</option>
              {freeBeds.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.property_name} · {b.building_name} · Room {b.room_number} · {b.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <FormActions>
          <button className="btn-ghost" onClick={() => setAllocOpen(false)}>Cancel</button>
          <button className="btn-gold" onClick={confirmAllocation} disabled={busyKey === 'alloc'}>
            {busyKey === 'alloc' ? 'Allocating…' : 'Confirm Allocation'}
          </button>
        </FormActions>
      </Modal>

      {/* create application */}
      <CreateApplication open={createOpen} onClose={() => setCreateOpen(false)} onCreated={() => { setCreateOpen(false); load(); }} />
    </div>
  );
}

function CreateApplication({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [students, setStudents] = useState<Student[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [form, setForm] = useState({ student_id: '', property_id: '', room_type_pref: 'Single', move_in_date: todayISO(), duration_months: 12, internal_notes: '', submit: true });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    api.get<Paginated<Student>>('/students?pageSize=200&status=registered').then((r) => setStudents(r.data)).catch(() => {});
    api.get<Paginated<Property>>('/properties?pageSize=100').then((r) => setProperties(r.data)).catch(() => {});
  }, [open]);

  const submit = async () => {
    if (!form.student_id) { toast('Select a student', 'error'); return; }
    setSaving(true);
    try {
      const res = await api.post<Application>('/applications', form);
      toast(`Application ${res.app_ref} created`);
      onCreated();
      setForm({ ...form, student_id: '' });
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setSaving(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="New Accommodation Application" width="max-w-2xl">
      <FormGrid>
        <Field label="Student" required>
          <Select value={form.student_id} onChange={(e) => setForm({ ...form, student_id: e.target.value })}>
            <option value="">Select student…</option>
            {students.map((s) => <option key={s.id} value={s.id}>{s.student_ref} — {s.full_name}</option>)}
          </Select>
        </Field>
        <Field label="Preferred property">
          <Select value={form.property_id} onChange={(e) => setForm({ ...form, property_id: e.target.value })}>
            <option value="">Any property</option>
            {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        <Field label="Room type preference">
          <Select value={form.room_type_pref} onChange={(e) => setForm({ ...form, room_type_pref: e.target.value })}>
            {['Single', 'Double', 'Twin', 'Shared', 'Studio'].map((t) => <option key={t}>{t}</option>)}
          </Select>
        </Field>
        <Field label="Move-in date">
          <Input type="date" value={form.move_in_date} onChange={(e) => setForm({ ...form, move_in_date: e.target.value })} />
        </Field>
        <Field label="Duration (months)">
          <Input type="number" min={1} max={24} value={form.duration_months}
            onChange={(e) => setForm({ ...form, duration_months: Number(e.target.value) })} />
        </Field>
        <Field label="Start as">
          <Select value={String(form.submit)} onChange={(e) => setForm({ ...form, submit: e.target.value === 'true' })}>
            <option value="true">Submitted (ready for review)</option>
            <option value="false">Draft</option>
          </Select>
        </Field>
      </FormGrid>
      <div className="mt-3.5">
        <Field label="Internal notes">
          <Textarea value={form.internal_notes} onChange={(e) => setForm({ ...form, internal_notes: e.target.value })} />
        </Field>
      </div>
      <FormActions>
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-gold" onClick={submit} disabled={saving}>
          {saving ? 'Creating…' : 'Create Application'}
        </button>
      </FormActions>
    </Modal>
  );
}
