import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  UserPlus, Search, Eye, Pencil, Archive, RotateCcw, Download, X,
  Mail, Phone, Building, CalendarDays, Wallet, FileText, MessageSquareWarning, GraduationCap,
} from 'lucide-react';
import { api, downloadFile } from '../lib/api';
import { useAuth } from '../auth';
import {
  PageHeader, Field, Input, Select, Textarea, FormGrid, FormActions, Modal,
  StatusPill, toast, Spinner, EmptyState, ConfirmDialog, MiniStat, Tabs, PriorityPill,
} from '../components/ui';
import { DataTable, Column, TableToolbar } from '../components/DataTable';
import { fmtDate, fmtDateTime, zar, todayISO, titleCase } from '../lib/format';
import type { Student, Paginated, Property } from '../lib/types';

const STATUSES = ['registered', 'active', 'checked_out', 'deactivated', 'archived'];

const emptyForm = {
  full_name: '', email: '', phone: '', id_number: '', institution: '', course: '',
  emergency_contact_name: '', emergency_contact_phone: '', notes: '',
};

export default function Students() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const [rows, setRows] = useState<Student[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 25, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [propertyId, setPropertyId] = useState('');
  const [sort, setSort] = useState('created_at');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [properties, setProperties] = useState<Property[]>([]);

  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  const [detail, setDetail] = useState<(Student & any) | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailTab, setDetailTab] = useState('profile');
  const [statement, setStatement] = useState<any>(null);
  const [archiveId, setArchiveId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ page: String(page), pageSize: '25', sort, dir });
      if (q) p.set('q', q);
      if (status) p.set('status', status);
      if (propertyId) p.set('property_id', propertyId);
      if (params.get('archived') === 'true') p.set('archived', 'true');
      const res = await api.get<Paginated<Student>>(`/students?${p.toString()}`);
      setRows(res.data);
      setPagination(res.pagination);
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  }, [page, q, status, propertyId, sort, dir, params]);

  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  useEffect(() => {
    api.get<Paginated<Property>>('/properties?pageSize=100').then((r) => setProperties(r.data)).catch(() => {});
  }, []);

  // deep link ?id=
  useEffect(() => {
    const id = params.get('id');
    if (id) openDetail(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openDetail = async (id: string) => {
    setDetailLoading(true);
    setDetailTab('profile');
    setStatement(null);
    try {
      const data = await api.get<Student & any>(`/students/${id}`);
      setDetail(data);
      const next = new URLSearchParams(params);
      next.set('id', id);
      setParams(next, { replace: true });
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setDetailLoading(false); }
  };

  const closeDetail = () => {
    setDetail(null);
    const next = new URLSearchParams(params);
    next.delete('id');
    setParams(next, { replace: true });
  };

  const submitForm = async () => {
    if (!form.full_name.trim()) { toast('Full legal name is required', 'error'); return; }
    setSaving(true);
    try {
      if (editId) {
        await api.patch(`/students/${editId}`, form);
        toast('Student record updated');
      } else {
        const created = await api.post<Student>('/students', form);
        toast(`Registered ${created.student_ref} — ${created.full_name}`);
      }
      setFormOpen(false);
      setForm({ ...emptyForm });
      setEditId(null);
      load();
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setSaving(false); }
  };

  const openCreate = () => { setForm({ ...emptyForm }); setEditId(null); setFormOpen(true); };
  const openEdit = (s: Student) => {
    setForm({
      full_name: s.full_name, email: s.email || '', phone: s.phone || '', id_number: s.id_number || '',
      institution: s.institution || '', course: s.course || '',
      emergency_contact_name: s.emergency_contact_name || '', emergency_contact_phone: s.emergency_contact_phone || '',
      notes: s.notes || '',
    });
    setEditId(s.id);
    setFormOpen(true);
  };

  const doArchive = async () => {
    if (!archiveId) return;
    try {
      await api.post(`/students/${archiveId}/archive`);
      toast('Student archived and bed released');
      setArchiveId(null);
      closeDetail();
      load();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const loadStatement = async (id: string) => {
    try {
      const s = await api.get(`/students/${id}/statement`);
      setStatement(s);
    } catch (e: any) { toast(e.message, 'error'); }
  };

  useEffect(() => {
    if (detail && detailTab === 'statement' && !statement) loadStatement(detail.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailTab, detail]);

  const exportCsv = async () => {
    try {
      const p = new URLSearchParams();
      if (status) p.set('status', status);
      if (propertyId) p.set('property_id', propertyId);
      await downloadFile(`/reports/registrations?format=csv&${p.toString()}`, `faranani-students-${todayISO()}.csv`);
      toast('Student report exported');
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const columns: Column<Student>[] = useMemo(() => [
    {
      key: 'student_ref', header: 'Reference', sortValue: (s) => s.student_ref,
      render: (s) => <span className="font-semibold text-neutral-700">{s.student_ref}</span>,
    },
    {
      key: 'full_name', header: 'Full Name', sortValue: (s) => s.full_name,
      render: (s) => (
        <div>
          <p className="font-medium text-neutral-800">{s.full_name}</p>
          <p className="text-[11px] text-neutral-400">{s.email || '—'}</p>
        </div>
      ),
    },
    {
      key: 'contact', header: 'Contact',
      render: (s) => (
        <div className="text-[11.5px] text-neutral-600">
          <p>{s.phone || '—'}</p>
          <p className="text-neutral-400">{s.institution || ''}</p>
        </div>
      ),
    },
    {
      key: 'placement', header: 'Property / Room / Bed',
      render: (s) => s.property_name ? (
        <div className="text-[11.5px] text-neutral-600">
          <p className="font-medium">{s.property_name}</p>
          <p className="text-neutral-400">{s.building_name} · Room {s.room_number} · {s.bed_label}</p>
        </div>
      ) : <span className="text-xs text-neutral-400">Not allocated</span>,
    },
    { key: 'status', header: 'Status', render: (s) => <StatusPill value={s.status} /> },
    {
      key: 'check_in_date', header: 'Check-in', sortValue: (s) => s.check_in_date || '',
      render: (s) => <span className="whitespace-nowrap text-xs text-neutral-500">{fmtDate(s.check_in_date)}</span>,
    },
    {
      key: 'created_at', header: 'Registered', sortValue: (s) => s.created_at,
      render: (s) => <span className="whitespace-nowrap text-xs text-neutral-500">{fmtDate(s.created_at)}</span>,
    },
    {
      key: 'actions', header: '', className: 'text-right',
      render: (s) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <button className="rounded p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-gold-dark"
            title="View record" onClick={() => openDetail(s.id)}><Eye size={14} /></button>
          {can('students.manage') && (
            <>
              <button className="rounded p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                title="Edit" onClick={() => openEdit(s)}><Pencil size={14} /></button>
              <button className="rounded p-1.5 text-neutral-400 hover:bg-red-50 hover:text-red-600"
                title="Archive" onClick={() => setArchiveId(s.id)}><Archive size={14} /></button>
            </>
          )}
        </div>
      ),
    },
  ], [can]);

  const d = detail;

  return (
    <div>
      <PageHeader
        title="Students"
        subtitle="Registered students, allocations and account summaries — every record from the live database."
        actions={
          <>
            {can('reports.export') && (
              <button onClick={exportCsv} className="btn-ghost inline-flex items-center gap-1.5">
                <Download size={14} /> Export CSV
              </button>
            )}
            {can('students.manage') && (
              <button onClick={openCreate} className="btn-gold inline-flex items-center gap-1.5">
                <UserPlus size={15} /> Register Walk-in Student
              </button>
            )}
          </>
        }
      />

      <div className="panel overflow-hidden">
        <DataTable
          rows={rows}
          columns={columns}
          loading={loading}
          rowKey={(s) => s.id}
          onRowClick={(s) => openDetail(s.id)}
          sort={sort}
          dir={dir}
          onSortChange={(key) => {
            if (sort === key) setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
            else { setSort(key); setDir('asc'); }
            setPage(1);
          }}
          page={pagination.page}
          pageSize={pagination.pageSize}
          total={pagination.total}
          totalPages={pagination.totalPages}
          onPageChange={setPage}
          emptyTitle="No students registered yet"
          emptyHint="Add your first student to get started. Portal applications will also appear here once processed."
          emptyAction={can('students.manage') ? (
            <button onClick={openCreate} className="btn-gold">Register Student</button>
          ) : undefined}
          toolbar={
            <TableToolbar>
              <div className="relative min-w-[220px] flex-1">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }}
                  placeholder="Search name, reference, email, phone…" aria-label="Search students"
                  className="field !py-1.5 !pl-9 text-xs" />
              </div>
              <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}
                aria-label="Filter status" className="field !w-auto !py-1.5 text-xs">
                <option value="">All Statuses</option>
                {STATUSES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
              </select>
              <select value={propertyId} onChange={(e) => { setPropertyId(e.target.value); setPage(1); }}
                aria-label="Filter property" className="field !w-auto !py-1.5 text-xs">
                <option value="">All Properties</option>
                {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-neutral-500">
                <input type="checkbox" checked={params.get('archived') === 'true'}
                  onChange={(e) => {
                    const next = new URLSearchParams(params);
                    if (e.target.checked) next.set('archived', 'true'); else next.delete('archived');
                    setParams(next, { replace: true });
                    setPage(1);
                  }} className="h-3.5 w-3.5 accent-[#c9a227]" />
                Show archived
              </label>
            </TableToolbar>
          }
        />
      </div>

      {/* ---------- create / edit ---------- */}
      <Modal open={formOpen} onClose={() => setFormOpen(false)}
        title={editId ? 'Edit Student Record' : 'Register Walk-in Student'} width="max-w-3xl">
        <FormGrid>
          <Field label="Full legal name" required>
            <Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })}
              placeholder="e.g. Naledi Mokoena" autoFocus />
          </Field>
          <Field label="Email address">
            <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="student@example.com" />
          </Field>
          <Field label="Phone number">
            <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="082 000 0000" />
          </Field>
          <Field label="ID number" hint="Used for duplicate prevention">
            <Input value={form.id_number} onChange={(e) => setForm({ ...form, id_number: e.target.value })}
              placeholder="9001015800089" maxLength={13} />
          </Field>
          <Field label="Educational institution">
            <Input value={form.institution} onChange={(e) => setForm({ ...form, institution: e.target.value })}
              placeholder="University of Johannesburg" />
          </Field>
          <Field label="Course / programme">
            <Input value={form.course} onChange={(e) => setForm({ ...form, course: e.target.value })}
              placeholder="BCom Accounting" />
          </Field>
          <Field label="Emergency contact name">
            <Input value={form.emergency_contact_name}
              onChange={(e) => setForm({ ...form, emergency_contact_name: e.target.value })} />
          </Field>
          <Field label="Emergency contact phone">
            <Input value={form.emergency_contact_phone}
              onChange={(e) => setForm({ ...form, emergency_contact_phone: e.target.value })} />
          </Field>
        </FormGrid>
        <div className="mt-3.5">
          <Field label="Internal notes" hint="Visible to authorised staff only">
            <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
        </div>
        <FormActions>
          <button className="btn-ghost" onClick={() => setFormOpen(false)}>Cancel</button>
          <button className="btn-gold" onClick={submitForm} disabled={saving}>
            {saving ? 'Saving…' : editId ? 'Save Changes' : 'Register Student'}
          </button>
        </FormActions>
      </Modal>

      {/* ---------- detail ---------- */}
      <Modal open={detailLoading || Boolean(d)} onClose={closeDetail}
        title={d ? `${d.full_name} · ${d.student_ref}` : 'Student record'} width="max-w-4xl">
        {detailLoading || !d ? <Spinner /> : (
          <div>
            <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <MiniStat label="Status" value={<StatusPill value={d.status} />} />
              <MiniStat label="Property" value={d.property_name || 'Not allocated'} />
              <MiniStat label="Room / Bed" value={d.room_number ? `${d.room_number} · ${d.bed_label || ''}` : '—'} />
              <MiniStat label="Balance"
                value={zar(d.balances?.balance ?? 0)}
                tone={(d.balances?.balance ?? 0) > 0 ? 'red' : 'green'} />
            </div>

            <Tabs active={detailTab} onChange={setDetailTab} tabs={[
              { key: 'profile', label: 'Profile' },
              { key: 'allocations', label: 'Allocations', count: d.allocations?.length ?? 0 },
              { key: 'applications', label: 'Applications', count: d.applications?.length ?? 0 },
              { key: 'complaints', label: 'Complaints', count: d.complaints?.length ?? 0 },
              { key: 'documents', label: 'Documents', count: d.documents?.length ?? 0 },
              { key: 'statement', label: 'Account Statement' },
            ]} />

            <div className="mt-4">
              {detailTab === 'profile' && (
                <div className="grid gap-3 text-sm sm:grid-cols-2">
                  <Info label="Email" value={d.email} icon={<Mail size={13} />} />
                  <Info label="Phone" value={d.phone} icon={<Phone size={13} />} />
                  <Info label="ID number" value={d.id_number} />
                  <Info label="Institution" value={d.institution} icon={<GraduationCap size={13} />} />
                  <Info label="Course" value={d.course} />
                  <Info label="Emergency contact"
                    value={[d.emergency_contact_name, d.emergency_contact_phone].filter(Boolean).join(' · ')} />
                  <Info label="Check-in" value={fmtDate(d.check_in_date)} icon={<CalendarDays size={13} />} />
                  <Info label="Expected check-out" value={fmtDate(d.expected_check_out_date)} icon={<CalendarDays size={13} />} />
                  <Info label="Record created" value={fmtDateTime(d.created_at)} />
                  <Info label="Last updated" value={fmtDateTime(d.updated_at)} />
                  {d.notes && (
                    <div className="sm:col-span-2 rounded-lg border border-line bg-neutral-50 px-3 py-2">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Internal notes</p>
                      <p className="mt-1 whitespace-pre-wrap text-sm text-neutral-700">{d.notes}</p>
                    </div>
                  )}
                  <div className="sm:col-span-2 grid grid-cols-3 gap-2.5">
                    <MiniStat label="Invoiced" value={zar(d.balances?.invoiced ?? 0)} />
                    <MiniStat label="Paid" value={zar(d.balances?.paid ?? 0)} tone="green" />
                    <MiniStat label="Outstanding" value={zar(d.balances?.balance ?? 0)}
                      tone={(d.balances?.balance ?? 0) > 0 ? 'red' : 'green'} />
                  </div>
                </div>
              )}

              {detailTab === 'allocations' && (
                <List items={d.allocations} empty="No bed allocations recorded.">
                  {(a) => (
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-neutral-800">
                          {a.property_name} · {a.building_name} · Room {a.room_number} · {a.bed_label}
                        </p>
                        <p className="text-xs text-neutral-500">
                          {fmtDate(a.check_in_date)} → {a.check_out_date ? fmtDate(a.check_out_date) : 'ongoing'} · {a.allocation_ref}
                        </p>
                      </div>
                      <StatusPill value={a.status} />
                    </div>
                  )}
                </List>
              )}

              {detailTab === 'applications' && (
                <List items={d.applications} empty="No applications on record.">
                  {(a) => (
                    <button className="flex w-full items-center justify-between gap-3 text-left"
                      onClick={() => { closeDetail(); navigate(`/applications?id=${a.id}`); }}>
                      <div>
                        <p className="text-sm font-medium text-neutral-800">{a.app_ref}</p>
                        <p className="text-xs text-neutral-500">Move-in {fmtDate(a.move_in_date)} · created {fmtDate(a.created_at)}</p>
                      </div>
                      <StatusPill value={a.status} />
                    </button>
                  )}
                </List>
              )}

              {detailTab === 'complaints' && (
                <List items={d.complaints} empty="No complaints submitted.">
                  {(c) => (
                    <button className="flex w-full items-center justify-between gap-3 text-left"
                      onClick={() => { closeDetail(); navigate(`/complaints?id=${c.id}`); }}>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-neutral-800">{c.ticket_ref} · {c.subject}</p>
                        <p className="text-xs text-neutral-500">{c.category} · {fmtDateTime(c.created_at)}</p>
                      </div>
                      <div className="flex shrink-0 gap-1.5">
                        <PriorityPill value={c.priority} />
                        <StatusPill value={c.status} />
                      </div>
                    </button>
                  )}
                </List>
              )}

              {detailTab === 'documents' && (
                <List items={d.documents} empty="No documents uploaded for this student.">
                  {(doc) => (
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-neutral-800">{doc.file_name}</p>
                        <p className="text-xs text-neutral-500">{doc.doc_type} · {fmtDate(doc.created_at)}</p>
                      </div>
                      <a className="btn-ghost !py-1 text-xs" href={`/api/files/${encodeURIComponent(doc.file_name)}`} target="_blank" rel="noreferrer">
                        <FileText size={12} className="mr-1 inline" />Open
                      </a>
                    </div>
                  )}
                </List>
              )}

              {detailTab === 'statement' && (
                <div>
                  {!statement ? <Spinner label="Loading statement…" /> : (
                    <>
                      <div className="mb-3 grid grid-cols-3 gap-2.5">
                        <MiniStat label="Invoiced" value={zar(statement.balances.invoiced)} />
                        <MiniStat label="Paid" value={zar(statement.balances.paid)} tone="green" />
                        <MiniStat label="Balance" value={zar(statement.balances.balance)}
                          tone={statement.balances.balance > 0 ? 'red' : 'green'} />
                      </div>
                      <div className="overflow-hidden rounded-lg border border-line">
                        <table className="data-table">
                          <thead>
                            <tr><th>Date</th><th>Type</th><th>Description</th><th className="text-right">Debit</th>
                              <th className="text-right">Credit</th><th className="text-right">Balance</th></tr>
                          </thead>
                          <tbody>
                            {statement.events.map((e: any, i: number) => (
                              <tr key={i}>
                                <td className="whitespace-nowrap text-xs">{fmtDate(e.date)}</td>
                                <td><span className={`pill ${e.type === 'payment' ? 'bg-emerald-100 text-emerald-700' : 'bg-sky-100 text-sky-700'}`}>{e.type}</span></td>
                                <td className="text-xs text-neutral-600">{e.description}</td>
                                <td className="text-right text-xs text-red-600">{e.debit ? zar(e.debit, 2) : ''}</td>
                                <td className="text-right text-xs text-emerald-600">{e.credit ? zar(e.credit, 2) : ''}</td>
                                <td className="text-right text-xs font-semibold">{zar(e.balance, 2)}</td>
                              </tr>
                            ))}
                            {statement.events.length === 0 && (
                              <tr><td colSpan={6}><EmptyState title="No financial activity" hint="Invoices and payments will appear here." /></td></tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            <FormActions>
              <button className="btn-ghost" onClick={closeDetail}>Close</button>
              {can('students.manage') && detail?.status !== 'archived' && (
                <>
                  <button className="btn-ghost" onClick={() => openEdit(d)}><Pencil size={13} className="mr-1 inline" />Edit</button>
                  <button className="btn-ghost !border-red-200 !text-red-600 hover:!bg-red-50"
                    onClick={() => setArchiveId(d.id)}>
                    <Archive size={13} className="mr-1 inline" />Archive
                  </button>
                </>
              )}
              {can('students.manage') && detail?.status === 'archived' && (
                <button className="btn-gold" onClick={async () => {
                  try { await api.post(`/students/${d.id}/restore`); toast('Student restored'); closeDetail(); load(); }
                  catch (e: any) { toast(e.message, 'error'); }
                }}>
                  <RotateCcw size={13} className="mr-1 inline" />Restore
                </button>
              )}
            </FormActions>
          </div>
        )}
      </Modal>

      <ConfirmDialog open={Boolean(archiveId)} onClose={() => setArchiveId(null)} onConfirm={doArchive}
        title="Archive student record?"
        message="The student will be marked as archived and any active bed allocation will be completed and released. Invoices and history are retained."
        confirmLabel="Archive Student" />
    </div>
  );
}

function Info({ label, value, icon }: { label: string; value: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-neutral-50/60 px-3 py-2">
      <p className="flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">
        {icon}{label}
      </p>
      <p className="mt-0.5 truncate text-sm font-medium text-neutral-700" title={String(value ?? '')}>
        {value || '—'}
      </p>
    </div>
  );
}

function List({ items, empty, children }: { items: any[] | undefined; empty: string; children: (item: any) => React.ReactNode }) {
  if (!items || items.length === 0) return <EmptyState title={empty} hint="" />;
  return (
    <div className="divide-y divide-neutral-100 rounded-lg border border-line">
      {items.map((item, i) => (
        <div key={item.id || i} className="px-3.5 py-2.5">{children(item)}</div>
      ))}
    </div>
  );
}
