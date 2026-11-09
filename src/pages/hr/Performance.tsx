import { useCallback, useEffect, useState } from 'react';
import { Plus, GraduationCap, Award, Users } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../auth';
import {
  Field, Input, Select, Textarea, FormGrid, FormActions, Modal, StatusPill, toast, MiniStat, Tabs, EmptyState,
} from '../../components/ui';
import { DataTable, Column } from '../../components/DataTable';
import { fmtDate, zar, titleCase } from '../../lib/format';

export function Performance() {
  const { can } = useAuth();
  const [tab, setTab] = useState<'reviews' | 'training'>('reviews');
  const [reviews, setReviews] = useState<any[]>([]);
  const [training, setTraining] = useState<any[]>([]);
  const [enrollments, setEnrollments] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewForm, setReviewForm] = useState({ staff_id: '', cycle: '', period_start: '', period_end: '', employee_comment: '', goals: '' });
  const [programOpen, setProgramOpen] = useState(false);
  const [programForm, setProgramForm] = useState({ name: '', provider: '', category: '', start_date: '', end_date: '', cost: 0, max_seats: 0 });
  const [enrollFor, setEnrollFor] = useState<any>(null);
  const [enrollStaff, setEnrollStaff] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === 'reviews') setReviews((await api.get<any>('/hr/performance/reviews')).data);
      else {
        const r = await api.get<any>('/hr/training');
        setTraining(r.data); setEnrollments(r.enrollments || []);
      }
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  const loadEmployees = async () => {
    try { setEmployees((await api.get<any>('/hr/employees?pageSize=300')).data); } catch { setEmployees([]); }
  };

  const createReview = async () => {
    if (!reviewForm.staff_id || !reviewForm.cycle) { toast('Employee and cycle are required', 'error'); return; }
    try {
      await api.post('/hr/performance/reviews', {
        ...reviewForm,
        goals: reviewForm.goals.split('\n').map((g) => g.trim()).filter(Boolean).map((g) => ({ title: g, status: 'pending' })),
      });
      toast('Review created as draft'); setReviewOpen(false); load();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const decide = async (id: string, status: string) => {
    try { await api.post(`/hr/performance/reviews/${id}/decision`, { status }); toast(`Review ${status}`); load(); }
    catch (e: any) { toast(e.message, 'error'); }
  };

  const createProgram = async () => {
    if (!programForm.name.trim()) { toast('Programme name is required', 'error'); return; }
    try { await api.post('/hr/training', programForm); toast('Training programme created'); setProgramOpen(false); load(); }
    catch (e: any) { toast(e.message, 'error'); }
  };

  const enroll = async () => {
    if (!enrollFor || !enrollStaff) { toast('Select an employee', 'error'); return; }
    try { await api.post(`/hr/training/${enrollFor.id}/enroll`, { staff_id: enrollStaff }); toast('Enrolled'); setEnrollFor(null); load(); }
    catch (e: any) { toast(e.message, 'error'); }
  };

  const reviewCols: Column<any>[] = [
    { key: 'review_ref', header: 'Ref', render: (r) => <span className="font-mono text-xs font-bold text-gold-dark">{r.review_ref}</span> },
    { key: 'full_name', header: 'Employee', render: (r) => (
      <div>
        <p className="text-xs font-semibold text-neutral-800">{r.full_name}</p>
        <p className="text-[11px] text-neutral-400">{r.department || '—'}</p>
      </div>
    ) },
    { key: 'cycle', header: 'Cycle', render: (r) => <span className="text-xs text-neutral-700">{r.cycle}</span> },
    { key: 'period', header: 'Period', render: (r) => <span className="text-xs text-neutral-500">{fmtDate(r.period_start)} → {fmtDate(r.period_end)}</span> },
    { key: 'manager_rating', header: 'Rating', render: (r) => <span className="text-xs font-semibold">{r.manager_rating ? `${r.manager_rating}/5` : '—'}</span> },
    { key: 'status', header: 'Status', render: (r) => <StatusPill value={r.status} /> },
    {
      key: 'actions', header: '', className: 'text-right',
      render: (r) => can('hr.performance') && (
        <div className="flex justify-end gap-1">
          {r.status === 'draft' && <button className="btn-ghost !py-1 text-[11px]" onClick={(e) => { e.stopPropagation(); decide(r.id, 'submitted'); }}>Submit</button>}
          {r.status === 'submitted' && <button className="btn-ghost !py-1 text-[11px] !text-emerald-600" onClick={(e) => { e.stopPropagation(); decide(r.id, 'approved'); }}>Approve</button>}
        </div>
      ),
    },
  ];

  const trainCols: Column<any>[] = [
    { key: 'name', header: 'Programme', render: (t) => (
      <div>
        <p className="text-xs font-semibold text-neutral-800">{t.name}</p>
        <p className="text-[11px] text-neutral-400">{t.provider || '—'}</p>
      </div>
    ) },
    { key: 'category', header: 'Category', render: (t) => <span className="text-xs text-neutral-600">{t.category || '—'}</span> },
    { key: 'dates', header: 'Dates', render: (t) => <span className="text-xs text-neutral-500">{fmtDate(t.start_date)} → {fmtDate(t.end_date)}</span> },
    { key: 'cost', header: 'Cost', render: (t) => <span className="text-xs">{zar(t.cost || 0, 2)}</span> },
    { key: 'enrolled', header: 'Enrolled', render: (t) => <span className="text-xs font-semibold">{t.enrolled || 0}</span> },
    { key: 'completed', header: 'Completed', render: (t) => <span className="text-xs text-emerald-600">{t.completed || 0}</span> },
    { key: 'status', header: 'Status', render: (t) => <StatusPill value={t.status} /> },
    {
      key: 'actions', header: '', className: 'text-right',
      render: (t) => can('hr.performance') && (
        <button className="btn-ghost !py-1 text-[11px]" onClick={(e) => { e.stopPropagation(); setEnrollFor(t); setEnrollStaff(''); loadEmployees(); }}>
          <Users size={12} className="mr-0.5 inline" />Enrol
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs active={tab} onChange={(k) => setTab(k as any)} tabs={[
          { key: 'reviews', label: 'Performance Reviews', count: reviews.length },
          { key: 'training', label: 'Training & Development', count: training.length },
        ]} />
        <div className="flex gap-2">
          {tab === 'training' && can('hr.performance') && (
            <button className="btn-gold inline-flex items-center gap-1.5" onClick={() => setProgramOpen(true)}><Plus size={15} /> New Programme</button>
          )}
          {tab === 'reviews' && can('hr.performance') && (
            <button className="btn-gold inline-flex items-center gap-1.5" onClick={() => { setReviewOpen(true); loadEmployees(); }}><Plus size={15} /> New Review</button>
          )}
        </div>
      </div>

      {tab === 'reviews' && (
        <div className="overflow-hidden rounded-xl border border-line">
          <DataTable
            rows={reviews} columns={reviewCols} loading={loading} rowKey={(r) => r.id}
            emptyTitle="No performance reviews" emptyHint="Create a review cycle, capture objectives and record manager assessments."
          />
        </div>
      )}

      {tab === 'training' && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <MiniStat label="Programmes" value={training.length} />
            <MiniStat label="Enrolments" value={enrollments.length} />
            <MiniStat label="Completed" value={enrollments.filter((e) => e.status === 'completed').length} tone="green" />
          </div>
          <div className="overflow-hidden rounded-xl border border-line">
            <DataTable
              rows={training} columns={trainCols} loading={loading} rowKey={(t) => t.id}
              emptyTitle="No training programmes" emptyHint="Add programmes and enrol employees to track development."
            />
          </div>
        </>
      )}

      {/* review form */}
      <Modal open={reviewOpen} onClose={() => setReviewOpen(false)} title="New performance review" width="max-w-xl">
        <FormGrid>
          <div className="sm:col-span-2">
            <Field label="Employee" required>
              <Select value={reviewForm.staff_id} onChange={(e) => setReviewForm({ ...reviewForm, staff_id: e.target.value })}>
                <option value="">Select employee…</option>
                {employees.map((s) => <option key={s.id} value={s.id}>{s.employee_ref} — {s.full_name}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Review cycle" required><Input value={reviewForm.cycle} onChange={(e) => setReviewForm({ ...reviewForm, cycle: e.target.value })} placeholder="2026 H1" /></Field>
          <div />
          <Field label="Period start"><Input type="date" value={reviewForm.period_start} onChange={(e) => setReviewForm({ ...reviewForm, period_start: e.target.value })} /></Field>
          <Field label="Period end"><Input type="date" value={reviewForm.period_end} onChange={(e) => setReviewForm({ ...reviewForm, period_end: e.target.value })} /></Field>
          <div className="sm:col-span-2">
            <Field label="Objectives / KPIs" hint="One per line.">
              <Textarea className="!min-h-20" value={reviewForm.goals} onChange={(e) => setReviewForm({ ...reviewForm, goals: e.target.value })} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Employee comment"><Textarea className="!min-h-16" value={reviewForm.employee_comment} onChange={(e) => setReviewForm({ ...reviewForm, employee_comment: e.target.value })} /></Field>
          </div>
        </FormGrid>
        <FormActions>
          <button className="btn-ghost" onClick={() => setReviewOpen(false)}>Cancel</button>
          <button className="btn-gold" onClick={createReview}>Create Draft Review</button>
        </FormActions>
      </Modal>

      {/* programme form */}
      <Modal open={programOpen} onClose={() => setProgramOpen(false)} title="New training programme" width="max-w-xl">
        <FormGrid>
          <div className="sm:col-span-2"><Field label="Programme name" required><Input value={programForm.name} onChange={(e) => setProgramForm({ ...programForm, name: e.target.value })} autoFocus /></Field></div>
          <Field label="Provider"><Input value={programForm.provider} onChange={(e) => setProgramForm({ ...programForm, provider: e.target.value })} /></Field>
          <Field label="Category"><Input value={programForm.category} onChange={(e) => setProgramForm({ ...programForm, category: e.target.value })} /></Field>
          <Field label="Start"><Input type="date" value={programForm.start_date} onChange={(e) => setProgramForm({ ...programForm, start_date: e.target.value })} /></Field>
          <Field label="End"><Input type="date" value={programForm.end_date} onChange={(e) => setProgramForm({ ...programForm, end_date: e.target.value })} /></Field>
          <Field label="Cost (ZAR)"><Input type="number" min={0} value={programForm.cost} onChange={(e) => setProgramForm({ ...programForm, cost: Number(e.target.value) })} /></Field>
          <Field label="Max seats"><Input type="number" min={0} value={programForm.max_seats} onChange={(e) => setProgramForm({ ...programForm, max_seats: Number(e.target.value) })} /></Field>
        </FormGrid>
        <FormActions>
          <button className="btn-ghost" onClick={() => setProgramOpen(false)}>Cancel</button>
          <button className="btn-gold" onClick={createProgram}>Create Programme</button>
        </FormActions>
      </Modal>

      {/* enrol */}
      <Modal open={Boolean(enrollFor)} onClose={() => setEnrollFor(null)} title={`Enrol — ${enrollFor?.name || ''}`} width="max-w-md">
        <Field label="Employee" required>
          <Select value={enrollStaff} onChange={(e) => setEnrollStaff(e.target.value)}>
            <option value="">Select employee…</option>
            {employees.map((s) => <option key={s.id} value={s.id}>{s.employee_ref} — {s.full_name}</option>)}
          </Select>
        </Field>
        <FormActions>
          <button className="btn-ghost" onClick={() => setEnrollFor(null)}>Cancel</button>
          <button className="btn-gold" onClick={enroll}>Enrol</button>
        </FormActions>
      </Modal>
    </div>
  );
}
