import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Search, CalendarDays, Sparkles, ClipboardCheck, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../auth';
import {
  PageHeader, Field, Input, Select, Textarea, FormGrid, FormActions, Modal,
  StatusPill, toast, Spinner, Tabs, MiniStat, ConfirmDialog, PanelHeader,
} from '../components/ui';
import { DataTable, Column, TableToolbar } from '../components/DataTable';
import { fmtDate, fmtTime, todayISO, titleCase } from '../lib/format';
import type { CleaningTask, Paginated, Property, Staff } from '../lib/types';

const FREQS = ['daily', 'weekly', 'biweekly', 'monthly'];

export default function Cleaning() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<'tasks' | 'schedules'>('tasks');
  const [tasks, setTasks] = useState<CleaningTask[]>([]);
  const [schedules, setSchedules] = useState<any[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 20, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState({ status: '', property_id: '', date: '' });
  const [page, setPage] = useState(1);
  const [properties, setProperties] = useState<Property[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);

  const [schOpen, setSchOpen] = useState(false);
  const [schForm, setSchForm] = useState({ property_id: '', area_name: '', frequency: 'daily', due_time: '09:00', assigned_to: '', supervisor_id: '', checklist: '' });
  const [inspect, setInspect] = useState<{ task: CleaningTask; result: string; notes: string } | null>(null);
  const [completeOpen, setCompleteOpen] = useState<CleaningTask | null>(null);
  const [completeNotes, setCompleteNotes] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === 'tasks') {
        const p = new URLSearchParams({ page: String(page), pageSize: '20' });
        if (q) p.set('q', q);
        Object.entries(filters).forEach(([k, v]) => { if (v) p.set(k, v); });
        const res = await api.get<Paginated<CleaningTask>>(`/cleaning/tasks?${p.toString()}`);
        setTasks(res.data); setPagination(res.pagination);
      } else {
        const p = new URLSearchParams();
        if (filters.property_id) p.set('property_id', filters.property_id);
        const res = await api.get<{ data: any[] }>(`/cleaning/schedules?${p.toString()}`);
        setSchedules(res.data);
      }
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  }, [tab, page, q, filters]);

  useEffect(() => { const t = setTimeout(load, q ? 300 : 0); return () => clearTimeout(t); }, [load, q]);
  useEffect(() => {
    api.get<Paginated<Property>>('/properties?pageSize=100').then((r) => setProperties(r.data)).catch(() => {});
    api.get<Paginated<Staff>>('/staff?pageSize=200').then((r) => setStaff(r.data)).catch(() => {});
  }, []);

  const createSchedule = async () => {
    if (!schForm.property_id || !schForm.area_name) { toast('Property and area are required', 'error'); return; }
    try {
      await api.post('/cleaning/schedules', {
        ...schForm,
        checklist: schForm.checklist.split(',').map((s) => s.trim()).filter(Boolean),
      });
      toast('Cleaning schedule created');
      setSchOpen(false); setSchForm({ property_id: '', area_name: '', frequency: 'daily', due_time: '09:00', assigned_to: '', supervisor_id: '', checklist: '' });
      load();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const doComplete = async () => {
    if (!completeOpen) return;
    try {
      await api.post(`/cleaning/tasks/${completeOpen.id}/complete`, { notes: completeNotes });
      toast('Task marked complete');
      setCompleteOpen(null); setCompleteNotes(''); load();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const doInspect = async () => {
    if (!inspect) return;
    try {
      const res = await api.post<{ result: string }>(`/cleaning/tasks/${inspect.task.id}/inspect`, { result: inspect.result, notes: inspect.notes });
      toast(res.result === 'pass' ? 'Inspection passed' : 'Failed — a re-clean task was created', res.result === 'pass' ? 'success' : 'error');
      setInspect(null); load();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const canManage = can('cleaning.manage');
  const today = todayISO();
  const todayTasks = tasks.filter((t) => t.task_date === today);

  const taskCols: Column<CleaningTask>[] = [
    { key: 'area', header: 'Area / Room', render: (t) => (
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-emerald-100 text-emerald-700"><Sparkles size={13} /></span>
        <div>
          <p className="text-xs font-medium text-neutral-800">{t.area_name}</p>
          <p className="text-[10.5px] text-neutral-400">{t.property_name}{t.building_name ? ` / ${t.building_name}` : ''}{t.room_number ? ` / Room ${t.room_number}` : ''}</p>
        </div>
      </div>
    ) },
    { key: 'task_date', header: 'Date', render: (t) => <span className="whitespace-nowrap text-xs text-neutral-600">{fmtDate(t.task_date)}</span> },
    { key: 'due_time', header: 'Due', render: (t) => <span className="text-xs text-neutral-600">{t.due_time || '—'}</span> },
    { key: 'cleaner', header: 'Cleaner', render: (t) => <span className="text-xs text-neutral-600">{t.cleaner_name || <span className="text-neutral-400">Unassigned</span>}</span> },
    { key: 'supervisor', header: 'Supervisor', render: (t) => <span className="text-xs text-neutral-600">{t.supervisor_name || '—'}</span> },
    { key: 'status', header: 'Status', render: (t) => <StatusPill value={t.status} /> },
    {
      key: 'actions', header: '', className: 'text-right',
      render: (t) => (
        <div className="flex justify-end gap-1">
          {t.status === 'pending' && (
            <button className="btn-ghost !py-1 text-[11px]" onClick={(e) => { e.stopPropagation(); setCompleteOpen(t); }}>
              Complete
            </button>
          )}
          {canManage && t.status === 'completed' && (
            <button className="btn-ghost !py-1 text-[11px]" onClick={(e) => { e.stopPropagation(); setInspect({ task: t, result: 'pass', notes: '' }); }}>
              Inspect
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Cleaning & Housekeeping"
        subtitle="Recurring schedules generate daily tasks automatically. Failed inspections raise re-clean work."
        actions={canManage && (
          <button className="btn-gold inline-flex items-center gap-1.5" onClick={() => setSchOpen(true)}>
            <Plus size={15} /> New Schedule
          </button>
        )}
      />

      {/* daily strip */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="panel px-4 py-3">
          <p className="text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">Today's tasks</p>
          <p className="text-xl font-bold text-neutral-800">{todayTasks.length}</p>
        </div>
        <div className="panel px-4 py-3">
          <p className="text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">Completed today</p>
          <p className="text-xl font-bold text-emerald-600">{todayTasks.filter((t) => t.status === 'completed').length}</p>
        </div>
        <div className="panel px-4 py-3">
          <p className="text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">Pending</p>
          <p className="text-xl font-bold text-amber-600">{todayTasks.filter((t) => t.status === 'pending').length}</p>
        </div>
        <div className="panel px-4 py-3">
          <p className="text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">Failed inspections</p>
          <p className="text-xl font-bold text-red-600">{tasks.filter((t) => t.status === 'failed_inspection').length}</p>
        </div>
      </div>

      <div className="panel overflow-hidden">
        <div className="border-b border-line px-4 pt-2">
          <Tabs active={tab} onChange={(k) => { setTab(k as any); setPage(1); }} tabs={[
            { key: 'tasks', label: 'Tasks', count: pagination.total },
            { key: 'schedules', label: 'Schedules', count: schedules.length },
          ]} />
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
          {tab === 'tasks' && (
            <div className="relative min-w-[180px] flex-1">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
              <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search areas…" aria-label="Search cleaning" className="field !py-1.5 !pl-9 text-xs" />
            </div>
          )}
          <select aria-label="Status filter" className="field !w-auto !py-1.5 text-xs"
            value={filters.status} onChange={(e) => { setFilters({ ...filters, status: e.target.value }); setPage(1); }}>
            <option value="">All Statuses</option>
            {['pending', 'completed', 'failed_inspection'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
          </select>
          <select aria-label="Property filter" className="field !w-auto !py-1.5 text-xs"
            value={filters.property_id} onChange={(e) => { setFilters({ ...filters, property_id: e.target.value }); setPage(1); }}>
            <option value="">All Properties</option>
            {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {tab === 'tasks' && (
            <input type="date" aria-label="Date filter" className="field !w-auto !py-1.5 text-xs"
              value={filters.date} onChange={(e) => { setFilters({ ...filters, date: e.target.value }); setPage(1); }} />
          )}
        </div>

        {tab === 'tasks' ? (
          <DataTable rows={tasks} columns={taskCols} loading={loading} rowKey={(t) => t.id}
            page={pagination.page} pageSize={pagination.pageSize} total={pagination.total}
            totalPages={pagination.totalPages} onPageChange={setPage}
            emptyTitle="No cleaning tasks" emptyHint="Create a schedule and today's tasks are generated automatically." />
        ) : (
          <div>
            {loading ? <Spinner /> : (
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr><th>Area</th><th>Property</th><th>Frequency</th><th>Due Time</th><th>Cleaner</th><th>Supervisor</th><th>Status</th>{canManage && <th />}</tr>
                  </thead>
                  <tbody>
                    {schedules.map((s) => (
                      <tr key={s.id}>
                        <td className="text-xs font-medium text-neutral-800">{s.area_name}</td>
                        <td className="text-xs text-neutral-600">{s.property_name}</td>
                        <td className="text-xs text-neutral-600">{titleCase(s.frequency)}</td>
                        <td className="text-xs text-neutral-600">{s.due_time}</td>
                        <td className="text-xs text-neutral-600">{s.cleaner_name || '—'}</td>
                        <td className="text-xs text-neutral-600">{s.supervisor_name || '—'}</td>
                        <td><StatusPill value={s.status} /></td>
                        {canManage && (
                          <td className="text-right">
                            <button className="btn-ghost !py-1 text-[11px]" onClick={async () => {
                              if (!confirm(`Delete schedule for ${s.area_name}?`)) return;
                              try { await api.del(`/cleaning/schedules/${s.id}`); toast('Schedule deleted'); load(); } catch (e: any) { toast(e.message, 'error'); }
                            }}>Delete</button>
                          </td>
                        )}
                      </tr>
                    ))}
                    {schedules.length === 0 && (
                      <tr><td colSpan={8}><div className="py-10 text-center text-sm text-neutral-500">No schedules yet. Create one to auto-generate daily tasks.</div></td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* schedule */}
      <Modal open={schOpen} onClose={() => setSchOpen(false)} title="New cleaning schedule" width="max-w-2xl">
        <FormGrid>
          <Field label="Property" required>
            <Select value={schForm.property_id} onChange={(e) => setSchForm({ ...schForm, property_id: e.target.value })}>
              <option value="">Select property…</option>
              {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
          <Field label="Area / Room" required>
            <Input value={schForm.area_name} onChange={(e) => setSchForm({ ...schForm, area_name: e.target.value })} placeholder="Block A — 2nd floor corridor" />
          </Field>
          <Field label="Frequency">
            <Select value={schForm.frequency} onChange={(e) => setSchForm({ ...schForm, frequency: e.target.value })}>
              {FREQS.map((f) => <option key={f} value={f}>{titleCase(f)}</option>)}
            </Select>
          </Field>
          <Field label="Due time">
            <Input type="time" value={schForm.due_time} onChange={(e) => setSchForm({ ...schForm, due_time: e.target.value })} />
          </Field>
          <Field label="Cleaner">
            <Select value={schForm.assigned_to} onChange={(e) => setSchForm({ ...schForm, assigned_to: e.target.value })}>
              <option value="">Unassigned</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </Select>
          </Field>
          <Field label="Supervisor">
            <Select value={schForm.supervisor_id} onChange={(e) => setSchForm({ ...schForm, supervisor_id: e.target.value })}>
              <option value="">None</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="Checklist" hint="Comma separated, e.g. Sweep, Mop, Bin out, Surfaces wiped">
              <Input value={schForm.checklist} onChange={(e) => setSchForm({ ...schForm, checklist: e.target.value })} />
            </Field>
          </div>
        </FormGrid>
        <FormActions>
          <button className="btn-ghost" onClick={() => setSchOpen(false)}>Cancel</button>
          <button className="btn-gold" onClick={createSchedule}>Create Schedule</button>
        </FormActions>
      </Modal>

      {/* complete */}
      <Modal open={Boolean(completeOpen)} onClose={() => setCompleteOpen(null)} title="Mark task complete" width="max-w-md">
        <Field label="Notes (optional)">
          <Textarea value={completeNotes} onChange={(e) => setCompleteNotes(e.target.value)} />
        </Field>
        <FormActions>
          <button className="btn-ghost" onClick={() => setCompleteOpen(null)}>Cancel</button>
          <button className="btn-gold" onClick={doComplete}><CheckCircle2 size={14} className="mr-1 inline" />Mark Complete</button>
        </FormActions>
      </Modal>

      {/* inspect */}
      <Modal open={Boolean(inspect)} onClose={() => setInspect(null)} title="Inspect cleaning" width="max-w-md">
        {inspect && (
          <>
            <Field label="Result">
              <Select value={inspect.result} onChange={(e) => setInspect({ ...inspect, result: e.target.value })}>
                <option value="pass">Pass</option>
                <option value="fail">Fail (creates re-clean task)</option>
              </Select>
            </Field>
            <div className="mt-3.5">
              <Field label="Inspection notes">
                <Textarea value={inspect.notes} onChange={(e) => setInspect({ ...inspect, notes: e.target.value })} />
              </Field>
            </div>
            <FormActions>
              <button className="btn-ghost" onClick={() => setInspect(null)}>Cancel</button>
              <button className="btn-gold" onClick={doInspect}>Submit Inspection</button>
            </FormActions>
          </>
        )}
      </Modal>
    </div>
  );
}
