import { useCallback, useEffect, useState } from 'react';
import {
  User, FileText, MessageSquare, Wallet, LogIn, CheckCircle2, Clock, Send, RefreshCw,
} from 'lucide-react';
import { api } from '../lib/api';
import {
  PageHeader, Field, Input, Select, Textarea, FormGrid, FormActions, Modal,
  StatusPill, toast, Spinner, MiniStat, EmptyState, PanelHeader, Tabs,
} from '../components/ui';
import { fmtDate, fmtDateTime, fmtWhen, titleCase, zar } from '../lib/format';
import type { Student, Paginated, Complaint } from '../lib/types';

const CATEGORIES = ['Plumbing', 'Electrical', 'Cleaning', 'Security', 'Noise', 'Room Conditions', 'Internet Access', 'Facilities', 'Other'];

/**
 * Student self-service portal preview. Demonstrates exactly what a student
 * sees: their application status, account statement and complaint progress.
 * Staff can look up any student by reference to answer "what does the student
 * see right now?" — the same records the internal modules use, never copies.
 */
export default function Portal() {
  const [ref, setRef] = useState('');
  const [student, setStudent] = useState<(Student & any) | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<'application' | 'complaints' | 'account'>('application');

  const [application, setApplication] = useState<any>(null);
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [loadingData, setLoadingData] = useState(false);

  const [complaintOpen, setComplaintOpen] = useState(false);
  const [cForm, setCForm] = useState({ subject: '', description: '', category: 'Other', priority: 'normal' });
  const [submitting, setSubmitting] = useState(false);

  const lookup = useCallback(async (studentRef: string) => {
    if (!studentRef.trim()) return;
    setLoading(true);
    try {
      const list = await api.get<Paginated<Student>>(`/students?q=${encodeURIComponent(studentRef.trim())}&pageSize=5`);
      const found = list.data.find((s) => s.student_ref.toLowerCase() === studentRef.trim().toLowerCase()) || list.data[0];
      if (!found) { toast('No student found with that reference', 'error'); setStudent(null); return; }
      setStudent(found);
      setLoadingData(true);
      const [apps, comps, invs, pays] = await Promise.all([
        api.get<Paginated<any>>(`/applications?student_id=${found.id}&pageSize=10`).catch(() => ({ data: [] })),
        api.get<Paginated<Complaint>>(`/complaints?pageSize=50`).catch(() => ({ data: [] })),
        api.get<Paginated<any>>(`/invoices?student_id=${found.id}&pageSize=20`).catch(() => ({ data: [] })),
        api.get<Paginated<any>>(`/payments?student_id=${found.id}&pageSize=20`).catch(() => ({ data: [] })),
      ]);
      setApplication(apps.data?.[0] || null);
      setComplaints((comps.data || []).filter((c) => c.student_id === found.id));
      setInvoices(invs.data || []);
      setPayments(pays.data || []);
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setLoading(false); setLoadingData(false); }
  }, []);

  const submitComplaint = async () => {
    if (!student || !cForm.subject.trim() || !cForm.description.trim()) { toast('Subject and description are required', 'error'); return; }
    setSubmitting(true);
    try {
      const res = await api.post<{ ticket_ref: string }>('/complaints', {
        ...cForm, student_id: student.id, submitted_via: 'portal',
      });
      toast(`Complaint ${res.ticket_ref} submitted — the same record appears in the internal system`);
      setComplaintOpen(false); setCForm({ subject: '', description: '', category: 'Other', priority: 'normal' });
      lookup(ref);
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setSubmitting(false); }
  };

  const invoiced = invoices.reduce((s, i) => s + Number(i.total || 0), 0);
  const paid = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
  const balance = invoiced - paid;

  return (
    <div>
      <PageHeader
        title="Student Portal (Preview)"
        subtitle="What a student sees after signing in — the same underlying records, shared with the internal system."
      />

      <div className="mb-4 flex flex-wrap items-end gap-2.5 rounded-xl border border-line bg-white px-4 py-3">
        <div className="min-w-[240px]">
          <Field label="Student reference" hint="e.g. ST-2048 — look up any student to preview their portal.">
            <Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="ST-2048"
              onKeyDown={(e) => { if (e.key === 'Enter') lookup(ref); }} />
          </Field>
        </div>
        <button className="btn-gold !py-2" onClick={() => lookup(ref)} disabled={loading || !ref.trim()}>
          {loading ? <RefreshCw size={14} className="mr-1 inline animate-spin" /> : <LogIn size={14} className="mr-1 inline" />}
          Open Portal
        </button>
      </div>

      {!student ? (
        <div className="panel">
          <EmptyState
            icon={<User size={22} />}
            title="Enter a student reference to preview their portal"
            hint="Students register on the public website, verify their email, submit an application and track complaints and invoices here. Everything shown is the live shared record — no duplicate copies."
          />
        </div>
      ) : (
        <>
          <div className="mb-4 rounded-xl border border-line bg-white px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-base font-bold text-neutral-900">{student.full_name}</p>
                <p className="text-xs text-neutral-500">
                  {student.student_ref} · {student.institution || 'Institution not recorded'}{student.course ? ` · ${student.course}` : ''}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill value={student.status} />
                {student.property_name && (
                  <span className="pill bg-neutral-100 text-neutral-600">
                    {student.property_name}{student.room_number ? ` · Room ${student.room_number}` : ''}{student.bed_label ? ` · ${student.bed_label}` : ''}
                  </span>
                )}
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <MiniStat label="Check-in" value={fmtDate(student.check_in_date)} />
              <MiniStat label="Expected check-out" value={fmtDate(student.expected_check_out_date)} />
              <MiniStat label="Balance" value={zar(balance, 2)} tone={balance > 0.005 ? 'red' : 'green'} />
              <MiniStat label="Open complaints" value={complaints.filter((c) => !['resolved', 'closed'].includes(c.status)).length} tone="gold" />
            </div>
          </div>

          <div className="panel overflow-hidden">
            <div className="border-b border-line px-4 pt-2">
              <Tabs active={tab} onChange={(k) => setTab(k as any)} tabs={[
                { key: 'application', label: 'My Application' },
                { key: 'complaints', label: 'My Complaints', count: complaints.length },
                { key: 'account', label: 'My Account' },
              ]} />
            </div>

            {loadingData ? <Spinner /> : (
              <div className="p-4">
                {tab === 'application' && (
                  !application ? (
                    <EmptyState icon={<FileText size={20} />} title="No application submitted yet"
                      hint="Students complete registration on the public website and receive a reference like APP-XXXX." />
                  ) : (
                    <div>
                      <div className="mb-3 flex flex-wrap items-center gap-2">
                        <span className="pill bg-gold-soft text-gold-dark">{application.app_ref}</span>
                        <StatusPill value={application.status} />
                        <span className="text-xs text-neutral-500">
                          Submitted {fmtDateTime(application.submitted_at || application.created_at)}
                        </span>
                      </div>
                      <div className="grid gap-2.5 sm:grid-cols-3">
                        <MiniStat label="Preferred property" value={application.property_name || 'Any available'} />
                        <MiniStat label="Room type" value={application.room_type_pref || 'Any'} />
                        <MiniStat label="Move-in" value={fmtDate(application.move_in_date)} />
                      </div>
                      {application.decision_at && (
                        <div className="mt-3 rounded-lg border border-line px-3.5 py-2.5 text-xs text-neutral-600">
                          <p className="font-semibold text-neutral-700">Decision recorded {fmtDateTime(application.decision_at)}</p>
                          {application.decision_notes && <p className="mt-1">{application.decision_notes}</p>}
                        </div>
                      )}
                      {application.status === 'info_required' && (
                        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800">
                          Admissions needs more information before processing. Please reply with the requested documents.
                        </div>
                      )}
                      <p className="mt-3 text-[11px] text-neutral-400">
                        Status changes made by admissions appear here immediately — same record, no re-submission.
                      </p>
                    </div>
                  )
                )}

                {tab === 'complaints' && (
                  <div>
                    <div className="mb-3 flex items-center justify-between">
                      <p className="text-xs text-neutral-500">
                        {complaints.filter((c) => !['resolved', 'closed'].includes(c.status)).length} open · {complaints.length} total
                      </p>
                      <button className="btn-gold !py-1.5 text-xs" onClick={() => setComplaintOpen(true)}>
                        <MessageSquare size={12} className="mr-1 inline" />Submit Complaint
                      </button>
                    </div>
                    {complaints.length === 0 ? (
                      <EmptyState icon={<MessageSquare size={20} />} title="No complaints submitted"
                        hint="Submit a complaint here and track its progress. It reaches the internal system instantly." />
                    ) : (
                      <div className="space-y-2.5">
                        {complaints.map((c) => (
                          <div key={c.id} className="rounded-lg border border-line px-3.5 py-2.5">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="font-mono text-xs font-bold text-gold-dark">{c.ticket_ref}</span>
                              <div className="flex items-center gap-1.5">
                                <span className="pill bg-neutral-100 text-neutral-600">{c.category}</span>
                                <StatusPill value={c.status} />
                              </div>
                            </div>
                            <p className="mt-1 text-xs font-medium text-neutral-800">{c.subject}</p>
                            <p className="mt-0.5 text-[11px] text-neutral-500">{c.description}</p>
                            {(c.comments || []).filter((cm: any) => cm.visibility !== 'internal').length > 0 && (
                              <div className="mt-2 space-y-1.5 border-t border-line pt-2">
                                {(c.comments || []).filter((cm: any) => cm.visibility !== 'internal').map((cm: any) => (
                                  <div key={cm.id} className="rounded bg-neutral-50 px-2.5 py-1.5 text-[11px]">
                                    <span className="font-semibold text-neutral-700">{cm.author_name}</span>{' '}
                                    <span className="text-neutral-400">{fmtWhen(cm.created_at)}</span>
                                    <p className="mt-0.5 text-neutral-600">{cm.body}</p>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {tab === 'account' && (
                  <div>
                    <div className="mb-3 grid grid-cols-3 gap-2.5">
                      <MiniStat label="Invoiced" value={zar(invoiced, 2)} />
                      <MiniStat label="Paid" value={zar(paid, 2)} tone="green" />
                      <MiniStat label="Balance" value={zar(balance, 2)} tone={balance > 0.005 ? 'red' : 'green'} />
                    </div>
                    <div className="rounded-lg border border-line">
                      <p className="border-b border-line px-3.5 py-2 text-xs font-bold uppercase tracking-wide text-neutral-500">Invoices</p>
                      <div className="max-h-64 overflow-y-auto">
                        {invoices.length === 0 && <p className="px-3.5 py-3 text-xs text-neutral-400">No invoices issued yet.</p>}
                        {invoices.map((i) => (
                          <div key={i.id} className="flex items-center justify-between border-b border-line px-3.5 py-2 text-xs last:border-0">
                            <div>
                              <span className="font-mono font-semibold text-neutral-700">{i.invoice_ref}</span>
                              <span className="ml-2 text-neutral-400">due {fmtDate(i.due_date)}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="font-semibold">{zar(i.total, 2)}</span>
                              <StatusPill value={i.status} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="mt-3 rounded-lg border border-line">
                      <p className="border-b border-line px-3.5 py-2 text-xs font-bold uppercase tracking-wide text-neutral-500">Payments received</p>
                      <div className="max-h-48 overflow-y-auto">
                        {payments.length === 0 && <p className="px-3.5 py-3 text-xs text-neutral-400">No payments recorded yet.</p>}
                        {payments.map((p) => (
                          <div key={p.id} className="flex items-center justify-between border-b border-line px-3.5 py-2 text-xs last:border-0">
                            <span className="text-neutral-600">{p.payment_ref} · {p.method?.toUpperCase()} · {fmtDate(p.paid_at)}</span>
                            <span className="font-semibold text-emerald-600">{zar(p.amount, 2)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {/* complaint form */}
      <Modal open={complaintOpen} onClose={() => setComplaintOpen(false)} title="Submit a complaint" width="max-w-xl">
        <FormGrid>
          <div className="sm:col-span-2">
            <Field label="Subject" required>
              <Input value={cForm.subject} onChange={(e) => setCForm({ ...cForm, subject: e.target.value })} placeholder="No hot water in my room" autoFocus />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Description" required>
              <Textarea value={cForm.description} onChange={(e) => setCForm({ ...cForm, description: e.target.value })} />
            </Field>
          </div>
          <Field label="Category">
            <Select value={cForm.category} onChange={(e) => setCForm({ ...cForm, category: e.target.value })}>
              {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </Select>
          </Field>
          <Field label="Priority">
            <Select value={cForm.priority} onChange={(e) => setCForm({ ...cForm, priority: e.target.value })}>
              {['low', 'normal', 'high', 'urgent'].map((p) => <option key={p} value={p}>{titleCase(p)}</option>)}
            </Select>
          </Field>
        </FormGrid>
        <p className="mt-3 rounded-lg bg-gold-soft px-3 py-2 text-[11.5px] text-gold-dark">
          Your complaint gets a ticket number like FAR-XXXX and appears in the office system the moment you submit it. Track progress under “My Complaints”.
        </p>
        <FormActions>
          <button className="btn-ghost" onClick={() => setComplaintOpen(false)}>Cancel</button>
          <button className="btn-gold" onClick={submitComplaint} disabled={submitting}>
            <Send size={13} className="mr-1 inline" />{submitting ? 'Submitting…' : 'Submit Complaint'}
          </button>
        </FormActions>
      </Modal>
    </div>
  );
}
