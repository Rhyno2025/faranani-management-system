import { useCallback, useEffect, useState } from 'react';
import { Plus, Search, Briefcase, UserPlus, CalendarPlus } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../auth';
import {
  Field, Input, Select, Textarea, FormGrid, FormActions, Modal, StatusPill, toast,
  MiniStat, EmptyState, Tabs,
} from '../../components/ui';
import { DataTable, Column, TableToolbar } from '../../components/DataTable';
import { fmtDate, titleCase, zar } from '../../lib/format';
import type { Paginated } from '../../lib/types';

export function Recruitment() {
  const { can } = useAuth();
  const [tab, setTab] = useState<'vacancies' | 'applicants' | 'pipeline'>('vacancies');

  const [vacancies, setVacancies] = useState<any[]>([]);
  const [applicants, setApplicants] = useState<any[]>([]);
  const [pipeline, setPipeline] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [pagination, setPagination] = useState({ page: 1, pageSize: 25, total: 0, totalPages: 1 });
  const [page, setPage] = useState(1);

  const [vacOpen, setVacOpen] = useState(false);
  const [vacForm, setVacForm] = useState({ title: '', department: '', vacancies: 1, employment_type: 'permanent', salary_min: 0, salary_max: 0, description: '', requirements: '' });
  const [appOpen, setAppOpen] = useState(false);
  const [appForm, setAppForm] = useState({ full_name: '', email: '', phone: '', source: '', notes: '' });
  const [applyOpen, setApplyOpen] = useState(false);
  const [applyForm, setApplyForm] = useState({ applicant_id: '', requisition_id: '' });
  const [interviewFor, setInterviewFor] = useState<any>(null);
  const [interviewForm, setInterviewForm] = useState({ scheduled_at: '', interviewer: '', notes: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ page: String(page), pageSize: '25' });
      if (q) p.set('q', q);
      if (tab === 'vacancies') setVacancies((await api.get<Paginated<any>>(`/hr/recruitment/requisitions?${p}`)).data);
      else if (tab === 'applicants') setApplicants((await api.get<Paginated<any>>(`/hr/recruitment/applicants?${p}`)).data);
      else setPipeline((await api.get<Paginated<any>>(`/hr/recruitment/applications?${p}`)).data);
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  }, [tab, page, q]);

  useEffect(() => { const t = setTimeout(load, q ? 300 : 0); return () => clearTimeout(t); }, [load, q]);

  const createVacancy = async () => {
    if (!vacForm.title.trim()) { toast('Job title is required', 'error'); return; }
    try {
      const r = await api.post<any>('/hr/recruitment/requisitions', vacForm);
      toast(`Vacancy ${r.req_ref} created as draft`); setVacOpen(false); load();
    } catch (e: any) { toast(e.message, 'error'); }
  };
  const setVacancyStatus = async (id: string, status: string) => {
    try { await api.post(`/hr/recruitment/requisitions/${id}/status`, { status }); toast(`Vacancy ${status}`); load(); }
    catch (e: any) { toast(e.message, 'error'); }
  };
  const createApplicant = async () => {
    if (!appForm.full_name.trim()) { toast('Applicant name is required', 'error'); return; }
    try { await api.post('/hr/recruitment/applicants', appForm); toast('Applicant added'); setAppOpen(false); setAppForm({ full_name: '', email: '', phone: '', source: '', notes: '' }); load(); }
    catch (e: any) { toast(e.message, 'error'); }
  };
  const submitApplication = async () => {
    if (!applyForm.applicant_id || !applyForm.requisition_id) { toast('Select applicant and vacancy', 'error'); return; }
    try { await api.post('/hr/recruitment/applications', applyForm); toast('Application recorded'); setApplyOpen(false); setTab('pipeline'); load(); }
    catch (e: any) { toast(e.message, 'error'); }
  };
  const setStage = async (id: string, status: string) => {
    try { await api.post(`/hr/recruitment/applications/${id}/stage`, { status }); toast(`Candidate ${status}`); load(); }
    catch (e: any) { toast(e.message, 'error'); }
  };
  const scheduleInterview = async () => {
    if (!interviewFor || !interviewForm.scheduled_at) { toast('Interview date and time required', 'error'); return; }
    try { await api.post(`/hr/recruitment/applications/${interviewFor.id}/interviews`, interviewForm); toast('Interview scheduled'); setInterviewFor(null); load(); }
    catch (e: any) { toast(e.message, 'error'); }
  };

  const vacCols: Column<any>[] = [
    { key: 'req_ref', header: 'Ref', render: (v) => <span className="font-mono text-xs font-bold text-gold-dark">{v.req_ref}</span> },
    { key: 'title', header: 'Position', render: (v) => <span className="text-xs font-semibold text-neutral-800">{v.title}</span> },
    { key: 'department', header: 'Department', render: (v) => <span className="text-xs text-neutral-600">{v.department || '—'}</span> },
    { key: 'vacancies', header: 'Vacancies', render: (v) => <span className="text-xs">{v.vacancies}</span> },
    { key: 'applicants', header: 'Applicants', render: (v) => <span className="text-xs font-semibold">{v.applicants || 0}</span> },
    { key: 'created_at', header: 'Created', render: (v) => <span className="text-xs">{fmtDate(v.created_at)}</span> },
    { key: 'status', header: 'Status', render: (v) => <StatusPill value={v.status} /> },
    {
      key: 'actions', header: '', className: 'text-right',
      render: (v) => can('hr.recruitment') && (
        <div className="flex justify-end gap-1">
          {v.status === 'draft' && <button className="btn-ghost !py-1 text-[11px]" onClick={(e) => { e.stopPropagation(); setVacancyStatus(v.id, 'open'); }}>Publish</button>}
          {v.status === 'open' && <button className="btn-ghost !py-1 text-[11px]" onClick={(e) => { e.stopPropagation(); setVacancyStatus(v.id, 'closed'); }}>Close</button>}
        </div>
      ),
    },
  ];

  const appCols: Column<any>[] = [
    { key: 'applicant_ref', header: 'Ref', render: (a) => <span className="font-mono text-xs font-bold text-gold-dark">{a.applicant_ref}</span> },
    { key: 'full_name', header: 'Applicant', render: (a) => <span className="text-xs font-semibold text-neutral-800">{a.full_name}</span> },
    { key: 'contact', header: 'Contact', render: (a) => <span className="text-xs text-neutral-500">{a.email || a.phone || '—'}</span> },
    { key: 'source', header: 'Source', render: (a) => <span className="text-xs text-neutral-600">{a.source || '—'}</span> },
    { key: 'applications', header: 'Applications', render: (a) => <span className="text-xs font-semibold">{a.applications || 0}</span> },
    { key: 'created_at', header: 'Added', render: (a) => <span className="text-xs">{fmtDate(a.created_at)}</span> },
    {
      key: 'actions', header: '', className: 'text-right',
      render: (a) => can('hr.recruitment') && (
        <button className="btn-ghost !py-1 text-[11px]" onClick={(e) => { e.stopPropagation(); setApplyForm({ applicant_id: a.id, requisition_id: '' }); setApplyOpen(true); }}>
          Apply to role
        </button>
      ),
    },
  ];

  const pipeCols: Column<any>[] = [
    { key: 'application_ref', header: 'Ref', render: (p) => <span className="font-mono text-xs font-bold text-gold-dark">{p.application_ref}</span> },
    { key: 'full_name', header: 'Candidate', render: (p) => <span className="text-xs font-semibold text-neutral-800">{p.full_name}</span> },
    { key: 'title', header: 'Applied for', render: (p) => <span className="text-xs text-neutral-600">{p.title}</span> },
    { key: 'created_at', header: 'Applied', render: (p) => <span className="text-xs">{fmtDate(p.created_at)}</span> },
    { key: 'status', header: 'Stage', render: (p) => <StatusPill value={p.status} /> },
    {
      key: 'actions', header: '', className: 'text-right',
      render: (p) => can('hr.recruitment') && (
        <div className="flex justify-end gap-1">
          {['screening', 'shortlisted'].includes(p.status) && (
            <button className="btn-ghost !py-1 text-[11px]" onClick={(e) => { e.stopPropagation(); setInterviewFor(p); setInterviewForm({ scheduled_at: '', interviewer: '', notes: '' }); }}>
              Interview
            </button>
          )}
          {p.status !== 'hired' && p.status !== 'rejected' && (
            <>
              <button className="btn-ghost !py-1 text-[11px]" onClick={(e) => { e.stopPropagation(); setStage(p.id, 'hired'); }}>Hire</button>
              <button className="btn-ghost !py-1 text-[11px] hover:!text-red-600" onClick={(e) => { e.stopPropagation(); setStage(p.id, 'rejected'); }}>Reject</button>
            </>
          )}
        </div>
      ),
    },
  ];

  const rows = tab === 'vacancies' ? vacancies : tab === 'applicants' ? applicants : pipeline;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1">
          <Tabs active={tab} onChange={(k) => { setTab(k as any); setPage(1); }} tabs={[
            { key: 'vacancies', label: 'Vacancies', count: vacancies.length },
            { key: 'applicants', label: 'Applicants', count: applicants.length },
            { key: 'pipeline', label: 'Pipeline', count: pipeline.length },
          ]} />
        </div>
        {can('hr.recruitment') && (
          <div className="flex gap-2">
            <button className="btn-ghost inline-flex items-center gap-1.5" onClick={() => setAppOpen(true)}><UserPlus size={14} /> Add Applicant</button>
            <button className="btn-gold inline-flex items-center gap-1.5" onClick={() => setVacOpen(true)}><Plus size={15} /> New Vacancy</button>
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-line">
        <DataTable
          rows={rows} columns={tab === 'vacancies' ? vacCols : tab === 'applicants' ? appCols : pipeCols}
          loading={loading} rowKey={(r: any) => r.id}
          page={pagination.page} pageSize={pagination.pageSize} total={pagination.total} totalPages={pagination.totalPages}
          onPageChange={setPage}
          emptyTitle={tab === 'vacancies' ? 'No vacancies recorded' : tab === 'applicants' ? 'No applicants yet' : 'No applications in the pipeline'}
          emptyHint="Recruitment records are created here — nothing is pre-populated."
          toolbar={
            <TableToolbar>
              <div className="relative min-w-[200px] flex-1">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search…" aria-label="Search recruitment" className="field !py-1.5 !pl-9 text-xs" />
              </div>
            </TableToolbar>
          }
        />
      </div>

      {/* vacancy form */}
      <Modal open={vacOpen} onClose={() => setVacOpen(false)} title="New vacancy" width="max-w-2xl">
        <FormGrid>
          <div className="sm:col-span-2"><Field label="Job title" required><Input value={vacForm.title} onChange={(e) => setVacForm({ ...vacForm, title: e.target.value })} autoFocus /></Field></div>
          <Field label="Department"><Input value={vacForm.department} onChange={(e) => setVacForm({ ...vacForm, department: e.target.value })} /></Field>
          <Field label="Vacancies"><Input type="number" min={1} value={vacForm.vacancies} onChange={(e) => setVacForm({ ...vacForm, vacancies: Number(e.target.value) })} /></Field>
          <Field label="Employment type">
            <Select value={vacForm.employment_type} onChange={(e) => setVacForm({ ...vacForm, employment_type: e.target.value })}>
              {['permanent', 'fixed_term', 'part_time', 'contractor', 'intern'].map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
            </Select>
          </Field>
          <div />
          <Field label="Minimum salary"><Input type="number" min={0} value={vacForm.salary_min} onChange={(e) => setVacForm({ ...vacForm, salary_min: Number(e.target.value) })} /></Field>
          <Field label="Maximum salary"><Input type="number" min={0} value={vacForm.salary_max} onChange={(e) => setVacForm({ ...vacForm, salary_max: Number(e.target.value) })} /></Field>
          <div className="sm:col-span-2"><Field label="Job description"><Textarea className="!min-h-20" value={vacForm.description} onChange={(e) => setVacForm({ ...vacForm, description: e.target.value })} /></Field></div>
          <div className="sm:col-span-2"><Field label="Requirements"><Textarea className="!min-h-20" value={vacForm.requirements} onChange={(e) => setVacForm({ ...vacForm, requirements: e.target.value })} /></Field></div>
        </FormGrid>
        <FormActions>
          <button className="btn-ghost" onClick={() => setVacOpen(false)}>Cancel</button>
          <button className="btn-gold" onClick={createVacancy}>Create Draft Vacancy</button>
        </FormActions>
      </Modal>

      {/* applicant form */}
      <Modal open={appOpen} onClose={() => setAppOpen(false)} title="Add applicant" width="max-w-xl">
        <FormGrid>
          <div className="sm:col-span-2"><Field label="Full name" required><Input value={appForm.full_name} onChange={(e) => setAppForm({ ...appForm, full_name: e.target.value })} autoFocus /></Field></div>
          <Field label="Email"><Input type="email" value={appForm.email} onChange={(e) => setAppForm({ ...appForm, email: e.target.value })} /></Field>
          <Field label="Phone"><Input value={appForm.phone} onChange={(e) => setAppForm({ ...appForm, phone: e.target.value })} /></Field>
          <Field label="Source"><Input value={appForm.source} onChange={(e) => setAppForm({ ...appForm, source: e.target.value })} placeholder="Referral, job board…" /></Field>
          <Field label="Notes"><Input value={appForm.notes} onChange={(e) => setAppForm({ ...appForm, notes: e.target.value })} /></Field>
        </FormGrid>
        <FormActions>
          <button className="btn-ghost" onClick={() => setAppOpen(false)}>Cancel</button>
          <button className="btn-gold" onClick={createApplicant}>Add Applicant</button>
        </FormActions>
      </Modal>

      {/* apply to role */}
      <Modal open={applyOpen} onClose={() => setApplyOpen(false)} title="Record application" width="max-w-lg">
        <FormGrid>
          <div className="sm:col-span-2">
            <Field label="Vacancy" required>
              <Select value={applyForm.requisition_id} onChange={(e) => setApplyForm({ ...applyForm, requisition_id: e.target.value })}>
                <option value="">Select vacancy…</option>
                {vacancies.filter((v) => v.status !== 'closed').map((v) => <option key={v.id} value={v.id}>{v.req_ref} — {v.title}</option>)}
              </Select>
            </Field>
          </div>
        </FormGrid>
        <FormActions>
          <button className="btn-ghost" onClick={() => setApplyOpen(false)}>Cancel</button>
          <button className="btn-gold" onClick={submitApplication}>Record Application</button>
        </FormActions>
      </Modal>

      {/* interview */}
      <Modal open={Boolean(interviewFor)} onClose={() => setInterviewFor(null)} title={`Schedule interview — ${interviewFor?.full_name || ''}`} width="max-w-lg">
        <FormGrid>
          <div className="sm:col-span-2"><Field label="Date & time" required><Input type="datetime-local" value={interviewForm.scheduled_at} onChange={(e) => setInterviewForm({ ...interviewForm, scheduled_at: e.target.value })} /></Field></div>
          <Field label="Interviewer"><Input value={interviewForm.interviewer} onChange={(e) => setInterviewForm({ ...interviewForm, interviewer: e.target.value })} /></Field>
          <div className="sm:col-span-2"><Field label="Notes"><Textarea className="!min-h-16" value={interviewForm.notes} onChange={(e) => setInterviewForm({ ...interviewForm, notes: e.target.value })} /></Field></div>
        </FormGrid>
        <FormActions>
          <button className="btn-ghost" onClick={() => setInterviewFor(null)}>Cancel</button>
          <button className="btn-gold" onClick={scheduleInterview}><CalendarPlus size={14} className="mr-1 inline" />Schedule</button>
        </FormActions>
      </Modal>
    </div>
  );
}
