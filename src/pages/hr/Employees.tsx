import { useCallback, useEffect, useState } from 'react';
import { Plus, Search, UserPlus, Mail, Phone, MapPin, ShieldAlert } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../auth';
import {
  PageHeader, Field, Input, Select, Textarea, FormGrid, FormActions, Modal,
  StatusPill, toast, MiniStat, EmptyState,
} from '../../components/ui';
import { DataTable, Column, TableToolbar } from '../../components/DataTable';
import { fmtDate, titleCase, initials, zar } from '../../lib/format';
import type { Paginated, Property } from '../../lib/types';

const emptyForm: Record<string, any> = {
  full_name: '', job_title: '', department: '', branch: '', email: '', phone: '', property_id: '',
  role: '', employment_status: 'active', employment_type: 'permanent', hired_at: '',
  contract_start: '', contract_end: '', probation_end: '', date_of_birth: '', gender: '',
  id_number: '', address_line: '', address_city: '', postal_address: '',
  emergency_contact_name: '', emergency_contact_phone: '', emergency_contact_relationship: '',
  next_of_kin: '', base_salary: 0, salary_frequency: 'monthly', bank_name: '', bank_account: '',
  tax_number: '', uif_number: '', qualifications: '', skills: '', manager_id: '',
  shift_notes: '', notes: '',
};

export function Employees() {
  const { can, user } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 25, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [properties, setProperties] = useState<Property[]>([]);
  const [staffList, setStaffList] = useState<any[]>([]);

  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({ ...emptyForm });
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ page: String(page), pageSize: '25' });
      if (q) p.set('q', q);
      if (status) p.set('status', status);
      const res = await api.get<Paginated<any>>(`/hr/employees?${p.toString()}`);
      setRows(res.data); setPagination(res.pagination);
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  }, [page, q, status]);

  useEffect(() => { const t = setTimeout(load, q ? 300 : 0); return () => clearTimeout(t); }, [load, q]);
  useEffect(() => {
    api.get<Paginated<Property>>('/properties?pageSize=100').then((r) => setProperties(r.data)).catch(() => {});
    api.get<{ data: any[] }>('/departments').then((r) => setStaffList(r.data)).catch(() => {});
  }, []);

  const submit = async () => {
    if (!form.full_name.trim()) { toast('Full name is required', 'error'); return; }
    setSaving(true);
    try {
      if (editId) { await api.patch(`/hr/employees/${editId}`, form); toast('Employee record updated'); }
      else { const r = await api.post<any>('/hr/employees', form); toast(`Employee ${r.employee_ref} created`); }
      setFormOpen(false); setEditId(null); setForm({ ...emptyForm }); load();
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setSaving(false); }
  };

  const openDetail = async (id: string) => {
    try { setDetail(await api.get(`/hr/employees/${id}`)); } catch (e: any) { toast(e.message, 'error'); }
  };

  const startExit = async () => {
    if (!detail) return;
    const last = prompt('Last working day (YYYY-MM-DD):');
    if (!last) return;
    const reason = prompt('Reason (optional):') || '';
    try {
      await api.post(`/hr/employees/${detail.id}/exit`, { last_working_day: last, reason, exit_type: 'resignation' });
      toast('Exit recorded'); setDetail(null); load();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const cols: Column<any>[] = [
    {
      key: 'name', header: 'Employee',
      render: (s) => (
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ink text-[11px] font-bold text-gold">{initials(s.full_name)}</span>
          <div>
            <p className="text-xs font-semibold text-neutral-800">{s.full_name}</p>
            <p className="text-[11px] text-neutral-400">{s.employee_ref}</p>
          </div>
        </div>
      ),
    },
    { key: 'job_title', header: 'Job Title', render: (s) => <span className="text-xs text-neutral-600">{s.job_title || '—'}</span> },
    { key: 'department', header: 'Department', render: (s) => <span className="pill bg-neutral-100 text-neutral-600">{s.department || '—'}</span> },
    { key: 'employment_type', header: 'Type', render: (s) => <span className="text-[11px] text-neutral-500">{titleCase(s.employment_type || 'permanent')}</span> },
    { key: 'hired_at', header: 'Appointed', render: (s) => <span className="whitespace-nowrap text-xs">{fmtDate(s.hired_at)}</span> },
    { key: 'contract_end', header: 'Contract ends', render: (s) => <span className="whitespace-nowrap text-xs">{fmtDate(s.contract_end)}</span> },
    { key: 'open_onboarding', header: 'Onboarding', render: (s) => <span className="text-xs font-semibold">{s.open_onboarding || 0}</span> },
    { key: 'employment_status', header: 'Status', render: (s) => <StatusPill value={s.employment_status} /> },
  ];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-neutral-500">
          {pagination.total} employee record{pagination.total === 1 ? '' : 's'}
          {!can('hr.salary') && <span className="ml-2 text-neutral-400">· salary and banking fields are hidden by your role</span>}
        </p>
        {can('staff.manage') && (
          <button className="btn-gold inline-flex items-center gap-1.5" onClick={() => { setForm({ ...emptyForm }); setEditId(null); setFormOpen(true); }}>
            <Plus size={15} /> New Employee
          </button>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-line">
        <DataTable
          rows={rows} columns={cols} loading={loading} rowKey={(s) => s.id}
          onRowClick={(s) => openDetail(s.id)}
          page={pagination.page} pageSize={pagination.pageSize} total={pagination.total}
          totalPages={pagination.totalPages} onPageChange={setPage}
          emptyTitle="No employee records" emptyHint="Add your first employee to start tracking attendance, leave, payroll and performance."
          emptyAction={can('staff.manage') && (
            <button className="btn-gold inline-flex items-center gap-1.5" onClick={() => { setForm({ ...emptyForm }); setFormOpen(true); }}>
              <UserPlus size={14} /> Add Employee
            </button>
          )}
          toolbar={
            <TableToolbar>
              <div className="relative min-w-[200px] flex-1">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search name, reference, job title…"
                  aria-label="Search employees" className="field !py-1.5 !pl-9 text-xs" />
              </div>
              <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status filter" className="field !w-auto !py-1.5 text-xs">
                <option value="">All statuses</option>
                {['active', 'on_leave', 'inactive', 'terminated'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
              </select>
            </TableToolbar>
          }
        />
      </div>

      {/* ------------------------------ form ------------------------------ */}
      <Modal open={formOpen} onClose={() => setFormOpen(false)} title={editId ? 'Edit Employee' : 'New Employee'} width="max-w-4xl">
        <FormGrid>
          <Field label="Full legal name" required><Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} autoFocus /></Field>
          <Field label="Job title"><Input value={form.job_title} onChange={(e) => setForm({ ...form, job_title: e.target.value })} /></Field>
          <Field label="Department">
            <Input list="hr-departments" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} placeholder="Finance" />
            <datalist id="hr-departments">{staffList.map((d: any) => <option key={d.id} value={d.name} />)}</datalist>
          </Field>
          <Field label="Branch"><Input value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })} /></Field>
          <Field label="Email"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label="Phone"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
          <Field label="Assigned property">
            <Select value={form.property_id} onChange={(e) => setForm({ ...form, property_id: e.target.value })}>
              <option value="">Company-wide</option>
              {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
          <Field label="Employment type">
            <Select value={form.employment_type} onChange={(e) => setForm({ ...form, employment_type: e.target.value })}>
              {['permanent', 'fixed_term', 'part_time', 'contractor', 'probation', 'intern'].map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
            </Select>
          </Field>
          <Field label="Date of appointment"><Input type="date" value={form.hired_at} onChange={(e) => setForm({ ...form, hired_at: e.target.value })} /></Field>
          <Field label="Employment status">
            <Select value={form.employment_status} onChange={(e) => setForm({ ...form, employment_status: e.target.value })}>
              {['active', 'on_leave', 'inactive', 'terminated'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
            </Select>
          </Field>
          <Field label="Contract start"><Input type="date" value={form.contract_start} onChange={(e) => setForm({ ...form, contract_start: e.target.value })} /></Field>
          <Field label="Contract end"><Input type="date" value={form.contract_end} onChange={(e) => setForm({ ...form, contract_end: e.target.value })} /></Field>
          <Field label="Probation ends"><Input type="date" value={form.probation_end} onChange={(e) => setForm({ ...form, probation_end: e.target.value })} /></Field>
          <Field label="Date of birth"><Input type="date" value={form.date_of_birth} onChange={(e) => setForm({ ...form, date_of_birth: e.target.value })} /></Field>
          <Field label="ID number"><Input value={form.id_number} onChange={(e) => setForm({ ...form, id_number: e.target.value })} maxLength={13} /></Field>
          <Field label="Gender">
            <Select value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
              <option value="">Not specified</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option>
            </Select>
          </Field>
          <Field label="Residential address"><Input value={form.address_line} onChange={(e) => setForm({ ...form, address_line: e.target.value })} /></Field>
          <Field label="City / town"><Input value={form.address_city} onChange={(e) => setForm({ ...form, address_city: e.target.value })} /></Field>
          <Field label="Postal address"><Input value={form.postal_address} onChange={(e) => setForm({ ...form, postal_address: e.target.value })} /></Field>
          <Field label="Next of kin"><Input value={form.next_of_kin} onChange={(e) => setForm({ ...form, next_of_kin: e.target.value })} /></Field>
          <Field label="Emergency contact"><Input value={form.emergency_contact_name} onChange={(e) => setForm({ ...form, emergency_contact_name: e.target.value })} /></Field>
          <Field label="Emergency contact phone"><Input value={form.emergency_contact_phone} onChange={(e) => setForm({ ...form, emergency_contact_phone: e.target.value })} /></Field>
          <Field label="Relationship"><Input value={form.emergency_contact_relationship} onChange={(e) => setForm({ ...form, emergency_contact_relationship: e.target.value })} /></Field>

          {can('hr.salary') && (
            <>
              <Field label="Monthly basic salary (ZAR)" hint="Restricted to authorised users.">
                <Input type="number" min={0} step="0.01" value={form.base_salary} onChange={(e) => setForm({ ...form, base_salary: Number(e.target.value) })} />
              </Field>
              <Field label="Salary frequency">
                <Select value={form.salary_frequency} onChange={(e) => setForm({ ...form, salary_frequency: e.target.value })}>
                  {['monthly', 'weekly', 'daily', 'hourly'].map((f) => <option key={f} value={f}>{titleCase(f)}</option>)}
                </Select>
              </Field>
              <Field label="Bank name"><Input value={form.bank_name} onChange={(e) => setForm({ ...form, bank_name: e.target.value })} /></Field>
              <Field label="Account number"><Input value={form.bank_account} onChange={(e) => setForm({ ...form, bank_account: e.target.value })} /></Field>
              <Field label="Tax number (SARS)"><Input value={form.tax_number} onChange={(e) => setForm({ ...form, tax_number: e.target.value })} /></Field>
              <Field label="UIF number"><Input value={form.uif_number} onChange={(e) => setForm({ ...form, uif_number: e.target.value })} /></Field>
            </>
          )}

          <Field label="Qualifications"><Textarea className="!min-h-16" value={form.qualifications} onChange={(e) => setForm({ ...form, qualifications: e.target.value })} /></Field>
          <Field label="Skills"><Textarea className="!min-h-16" value={form.skills} onChange={(e) => setForm({ ...form, skills: e.target.value })} /></Field>
          <div className="sm:col-span-2">
            <Field label="Shift notes"><Input value={form.shift_notes} onChange={(e) => setForm({ ...form, shift_notes: e.target.value })} placeholder="07:00 – 15:00, Mon–Fri" /></Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Internal HR notes" hint="Visible to HR only."><Textarea className="!min-h-16" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
          </div>
        </FormGrid>
        <FormActions>
          <button className="btn-ghost" onClick={() => setFormOpen(false)}>Cancel</button>
          <button className="btn-gold" onClick={submit} disabled={saving}>{saving ? 'Saving…' : editId ? 'Save Changes' : 'Create Employee'}</button>
        </FormActions>
      </Modal>

      {/* ------------------------------ detail ------------------------------ */}
      <Modal open={Boolean(detail)} onClose={() => setDetail(null)} title={detail ? `${detail.full_name} — ${detail.employee_ref}` : ''} width="max-w-3xl">
        {detail && (
          <div>
            <div className="mb-3.5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <MiniStat label="Status" value={<StatusPill value={detail.employment_status} />} />
              <MiniStat label="Department" value={detail.department || '—'} />
              <MiniStat label="Appointed" value={fmtDate(detail.hired_at)} />
              <MiniStat label="Contract ends" value={fmtDate(detail.contract_end)} tone="gold" />
              {can('hr.salary') && <MiniStat label="Monthly salary" value={zar(detail.base_salary || 0, 2)} tone="gold" />}
              {can('hr.salary') && <MiniStat label="Bank" value={detail.bank_name || '—'} />}
              <MiniStat label="Property" value={detail.property_name || 'Company-wide'} />
              <MiniStat label="Onboarding open" value={detail.onboarding?.filter((o: any) => o.status !== 'completed').length || 0} />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-line px-3.5 py-2.5 text-xs text-neutral-600">
                <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wide text-neutral-400">Contact</p>
                <p className="flex items-center gap-1.5"><Mail size={12} />{detail.email || '—'}</p>
                <p className="mt-1 flex items-center gap-1.5"><Phone size={12} />{detail.phone || '—'}</p>
                <p className="mt-1 flex items-center gap-1.5"><MapPin size={12} />{detail.address_line || '—'}{detail.address_city ? `, ${detail.address_city}` : ''}</p>
                <p className="mt-2 border-t border-line pt-1.5">Emergency: {detail.emergency_contact_name || '—'} {detail.emergency_contact_phone ? `(${detail.emergency_contact_phone})` : ''}</p>
              </div>
              <div className="rounded-lg border border-line px-3.5 py-2.5 text-xs text-neutral-600">
                <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wide text-neutral-400">Employment</p>
                <p>{detail.job_title || '—'} · {titleCase(detail.employment_type || 'permanent')}</p>
                <p className="mt-1">Probation ends: {fmtDate(detail.probation_end)}</p>
                <p className="mt-1">Qualifications: {detail.qualifications || '—'}</p>
                <p className="mt-1">Skills: {detail.skills || '—'}</p>
              </div>
            </div>

            {/* leave balances */}
            <div className="mt-3 rounded-lg border border-line">
              <p className="border-b border-line px-3.5 py-2 text-[10.5px] font-bold uppercase tracking-wide text-neutral-400">Leave balances (calendar year)</p>
              <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-4">
                {(detail.balances || []).map((b: any) => (
                  <MiniStat key={b.leave_type_id} label={b.name} value={`${b.remaining} / ${b.entitlement}`} tone={b.remaining === 0 ? 'red' : 'green'} />
                ))}
                {(detail.balances || []).length === 0 && <p className="text-xs text-neutral-400">No leave policies configured.</p>}
              </div>
            </div>

            {/* onboarding */}
            <div className="mt-3 rounded-lg border border-line">
              <p className="border-b border-line px-3.5 py-2 text-[10.5px] font-bold uppercase tracking-wide text-neutral-400">Onboarding checklist</p>
              <ul className="divide-y divide-neutral-100">
                {(detail.onboarding || []).map((t: any) => (
                  <li key={t.id} className="flex items-center justify-between px-3.5 py-2 text-xs">
                    <span className={t.status === 'completed' ? 'text-neutral-400 line-through' : 'text-neutral-700'}>{t.title}</span>
                    {t.status === 'completed'
                      ? <StatusPill value="completed" />
                      : can('staff.manage') && (
                        <button className="btn-ghost !py-0.5 text-[11px]"
                          onClick={async () => { try { await api.post(`/hr/onboarding/${t.id}/complete`); openDetail(detail.id); } catch (e: any) { toast(e.message, 'error'); } }}>
                          Mark done
                        </button>
                      )}
                  </li>
                ))}
                {(detail.onboarding || []).length === 0 && <li className="px-3.5 py-3 text-xs text-neutral-400">No checklist items.</li>}
              </ul>
            </div>

            <FormActions>
              <button className="btn-ghost" onClick={() => setDetail(null)}>Close</button>
              {can('staff.manage') && detail.employment_status !== 'terminated' && (
                <button className="btn-ghost !text-red-600" onClick={startExit}>Record exit…</button>
              )}
              {can('staff.manage') && (
                <button className="btn-gold" onClick={() => {
                  setForm({ ...emptyForm, ...detail }); setEditId(detail.id); setDetail(null); setFormOpen(true);
                }}>Edit</button>
              )}
            </FormActions>
          </div>
        )}
      </Modal>
    </div>
  );
}
