import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Plus, Search, ChevronLeft, ChevronRight, CalendarDays, CheckCircle2, Clock, Trash2, ListTodo,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../auth';
import {
  PageHeader, Field, Input, Select, Textarea, FormGrid, FormActions, Modal,
  StatusPill, PriorityPill, toast, Spinner, Tabs, ConfirmDialog, EmptyState,
} from '../components/ui';
import { DataTable, Column, TableToolbar } from '../components/DataTable';
import { fmtDate, fmtTime, todayISO, titleCase, relativeDay } from '../lib/format';
import type { Task, CalendarEvent, Paginated, Staff, Property } from '../lib/types';

const STATUSES = ['todo', 'in_progress', 'done', 'verified'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function parseYMD(s: string) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export default function Tasks() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<'list' | 'calendar'>('list');
  const [rows, setRows] = useState<Task[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 20, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState({ status: '', priority: '', property_id: '', assigned_to: '' });
  const [page, setPage] = useState(1);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);

  const [cursor, setCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', assigned_to: '', department: '', property_id: '', due_date: todayISO(), priority: 'normal' });
  const [evOpen, setEvOpen] = useState(false);
  const [evForm, setEvForm] = useState({ title: '', type: 'meeting', starts_at: todayISO(), all_day: true, property_id: '', description: '' });
  const [confirmDelete, setConfirmDelete] = useState<Task | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === 'list') {
        const p = new URLSearchParams({ page: String(page), pageSize: '20' });
        if (q) p.set('q', q);
        Object.entries(filters).forEach(([k, v]) => { if (v) p.set(k, v); });
        const res = await api.get<Paginated<Task>>(`/tasks?${p.toString()}`);
        setRows(res.data); setPagination(res.pagination);
      } else {
        const from = ymd(new Date(cursor.getFullYear(), cursor.getMonth(), 1));
        const to = ymd(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0));
        const res = await api.get<{ data: CalendarEvent[] }>(`/events?from=${from}&to=${to}`);
        setEvents(res.data);
      }
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  }, [tab, page, q, filters, cursor]);

  useEffect(() => { const t = setTimeout(load, q ? 300 : 0); return () => clearTimeout(t); }, [load, q]);
  useEffect(() => {
    api.get<Paginated<Staff>>('/staff?pageSize=200').then((r) => setStaff(r.data)).catch(() => {});
    api.get<Paginated<Property>>('/properties?pageSize=100').then((r) => setProperties(r.data)).catch(() => {});
  }, []);

  const createTask = async () => {
    if (!form.title.trim()) { toast('Task title is required', 'error'); return; }
    try {
      const t = await api.post<Task>('/tasks', form);
      toast(`Task ${t.task_ref} created`);
      setFormOpen(false); load();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const advance = async (t: Task) => {
    const next = t.status === 'todo' ? 'in_progress' : t.status === 'in_progress' ? 'done' : 'verified';
    try { await api.patch(`/tasks/${t.id}`, { status: next }); toast(`Marked ${titleCase(next)}`); load(); }
    catch (e: any) { toast(e.message, 'error'); }
  };

  const removeTask = async () => {
    if (!confirmDelete) return;
    try { await api.del(`/tasks/${confirmDelete.id}`); toast('Task deleted'); setConfirmDelete(null); load(); }
    catch (e: any) { toast(e.message, 'error'); }
  };

  const createEvent = async () => {
    if (!evForm.title.trim() || !evForm.starts_at) { toast('Title and date are required', 'error'); return; }
    try {
      await api.post('/events', evForm);
      toast('Event added to calendar');
      setEvOpen(false); load();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const cols: Column<Task>[] = [
    { key: 'task_ref', header: 'Ref', render: (t) => <span className="font-mono text-xs font-bold text-gold-dark">{t.task_ref}</span> },
    {
      key: 'title', header: 'Task',
      render: (t) => (
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-neutral-800">{t.title}</p>
          {t.description && <p className="truncate text-[11px] text-neutral-400">{t.description}</p>}
        </div>
      ),
    },
    { key: 'assignee', header: 'Assigned To', render: (t) => <span className="text-xs text-neutral-600">{t.assignee_name || <span className="text-neutral-400">Unassigned</span>}</span> },
    { key: 'property', header: 'Property', render: (t) => <span className="text-xs text-neutral-600">{t.property_name || '—'}</span> },
    { key: 'due_date', header: 'Due', render: (t) => (
      <span className={`whitespace-nowrap text-xs ${t.due_date && new Date(t.due_date) < new Date() && !['done', 'verified'].includes(t.status) ? 'font-semibold text-red-600' : 'text-neutral-500'}`}>
        {fmtDate(t.due_date)}{t.due_date && <span className="ml-1 text-[10.5px] text-neutral-400">{relativeDay(t.due_date)}</span>}
      </span>
    ) },
    { key: 'priority', header: 'Priority', render: (t) => <PriorityPill value={t.priority} /> },
    { key: 'status', header: 'Status', render: (t) => <StatusPill value={t.status} /> },
    {
      key: 'actions', header: '', className: 'text-right',
      render: (t) => can('tasks.manage') && (
        <div className="flex justify-end gap-1">
          {!['verified'].includes(t.status) && (
            <button className="rounded p-1.5 text-neutral-400 hover:bg-emerald-50 hover:text-emerald-600" title="Advance status"
              onClick={(e) => { e.stopPropagation(); advance(t); }}>
              <CheckCircle2 size={14} />
            </button>
          )}
          <button className="rounded p-1.5 text-neutral-400 hover:bg-red-50 hover:text-red-600" title="Delete task"
            onClick={(e) => { e.stopPropagation(); setConfirmDelete(t); }}>
            <Trash2 size={14} />
          </button>
        </div>
      ),
    },
  ];

  // ---- calendar grid ----
  const grid = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7; // Monday-first
    const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    const cells: (string | null)[] = [];
    for (let i = 0; i < offset; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(ymd(new Date(cursor.getFullYear(), cursor.getMonth(), d)));
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [cursor]);

  const eventsByDay = useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {};
    for (const e of events) {
      const key = String(e.starts_at).slice(0, 10);
      (map[key] ||= []).push(e);
    }
    return map;
  }, [events]);

  const dayEvents = selectedDay ? eventsByDay[selectedDay] || [] : [];
  const today = todayISO();

  return (
    <div>
      <PageHeader
        title="Tasks & Calendar"
        subtitle="Africa/Johannesburg dates. Calendar also shows check-ins, cleaning and maintenance due dates."
        actions={can('tasks.manage') && (
          <>
            <button className="btn-ghost inline-flex items-center gap-1.5" onClick={() => setEvOpen(true)}>
              <CalendarDays size={14} /> Add Event
            </button>
            <button className="btn-gold inline-flex items-center gap-1.5" onClick={() => setFormOpen(true)}>
              <Plus size={15} /> New Task
            </button>
          </>
        )}
      />

      <div className="panel overflow-hidden">
        <div className="border-b border-line px-4 pt-2">
          <Tabs active={tab} onChange={(k) => setTab(k as any)} tabs={[
            { key: 'list', label: 'Task List', count: pagination.total },
            { key: 'calendar', label: 'Calendar', count: events.length },
          ]} />
        </div>

        {tab === 'list' ? (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
              <div className="relative min-w-[180px] flex-1">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search tasks…" aria-label="Search tasks" className="field !py-1.5 !pl-9 text-xs" />
              </div>
              <select aria-label="Status" className="field !w-auto !py-1.5 text-xs" value={filters.status}
                onChange={(e) => { setFilters({ ...filters, status: e.target.value }); setPage(1); }}>
                <option value="">All Statuses</option>
                {STATUSES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
              </select>
              <select aria-label="Priority" className="field !w-auto !py-1.5 text-xs" value={filters.priority}
                onChange={(e) => { setFilters({ ...filters, priority: e.target.value }); setPage(1); }}>
                <option value="">All Priorities</option>
                {['urgent', 'high', 'normal', 'low'].map((p) => <option key={p} value={p}>{titleCase(p)}</option>)}
              </select>
              <select aria-label="Assignee" className="field !w-auto !py-1.5 text-xs" value={filters.assigned_to}
                onChange={(e) => { setFilters({ ...filters, assigned_to: e.target.value }); setPage(1); }}>
                <option value="">All Staff</option>
                {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
              </select>
            </div>
            <DataTable rows={rows} columns={cols} loading={loading} rowKey={(t) => t.id}
              page={pagination.page} pageSize={pagination.pageSize} total={pagination.total}
              totalPages={pagination.totalPages} onPageChange={setPage}
              emptyTitle="No tasks" emptyHint="Create a task and assign it to a staff member." />
          </>
        ) : (
          <div className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button className="btn-ghost !px-2 !py-1.5" aria-label="Previous month"
                  onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}>
                  <ChevronLeft size={15} />
                </button>
                <p className="min-w-[150px] text-center text-sm font-bold text-neutral-800">
                  {MONTHS[cursor.getMonth()]} {cursor.getFullYear()}
                </p>
                <button className="btn-ghost !px-2 !py-1.5" aria-label="Next month"
                  onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}>
                  <ChevronRight size={15} />
                </button>
                <button className="btn-ghost !py-1.5 text-xs" onClick={() => { const d = new Date(); setCursor(new Date(d.getFullYear(), d.getMonth(), 1)); setSelectedDay(today); }}>
                  Today
                </button>
              </div>
              <span className="text-xs text-neutral-400">{events.length} events this month</span>
            </div>

            <div className="grid grid-cols-7 gap-1.5">
              {WEEKDAYS.map((w) => <div key={w} className="py-1 text-center text-[10.5px] font-bold uppercase tracking-wide text-neutral-400">{w}</div>)}
              {grid.map((day, i) => {
                const dayEvents = day ? eventsByDay[day] || [] : [];
                const isToday = day === today;
                return (
                  <button key={i} disabled={!day} onClick={() => day && setSelectedDay(day)}
                    className={`min-h-[86px] rounded-lg border p-1.5 text-left transition ${
                      !day ? 'border-transparent bg-neutral-50/40' :
                      selectedDay === day ? 'border-gold bg-gold-soft' :
                      isToday ? 'border-ink/30 bg-white' : 'border-line bg-white hover:border-gold'
                    }`}>
                    {day && (
                      <>
                        <span className={`text-[11px] font-bold ${isToday ? 'text-gold-dark' : 'text-neutral-500'}`}>
                          {Number(day.slice(8, 10))}
                        </span>
                        <div className="mt-1 space-y-0.5">
                          {dayEvents.slice(0, 3).map((e, idx) => (
                            <p key={idx} className="truncate rounded bg-neutral-100 px-1 py-0.5 text-[9.5px] text-neutral-600"
                              title={e.title}>
                              {e.title}
                            </p>
                          ))}
                          {dayEvents.length > 3 && <p className="text-[9px] text-neutral-400">+{dayEvents.length - 3} more</p>}
                        </div>
                      </>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="mt-4 rounded-lg border border-line">
              <div className="flex items-center justify-between border-b border-line px-3.5 py-2">
                <p className="text-xs font-bold uppercase tracking-wide text-neutral-500">
                  {selectedDay ? fmtDate(selectedDay) : 'Select a day'}
                </p>
                {selectedDay && can('tasks.manage') && (
                  <button className="btn-ghost !py-1 text-xs" onClick={() => { setEvForm({ ...evForm, starts_at: selectedDay }); setEvOpen(true); }}>
                    + Add event on this day
                  </button>
                )}
              </div>
              <div className="px-3.5 py-2.5">
                {!selectedDay && <p className="text-xs text-neutral-400">Click a day to see check-ins, cleaning, maintenance and meetings.</p>}
                {selectedDay && dayEvents.length === 0 && <p className="text-xs text-neutral-400">Nothing scheduled for this day.</p>}
                {dayEvents.map((e, idx) => (
                  <div key={idx} className="flex items-center gap-2 py-1.5 text-xs">
                    <span className="flex h-2 w-2 shrink-0 rounded-full bg-gold" />
                    <span className="font-medium text-neutral-700">{e.title}</span>
                    <span className="pill bg-neutral-100 text-neutral-500">{titleCase(e.type)}</span>
                    {e.property_name && <span className="text-neutral-400">{e.property_name}</span>}
                    {e.derived && <span className="text-[10px] text-neutral-400">(auto)</span>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* task form */}
      <Modal open={formOpen} onClose={() => setFormOpen(false)} title="New task" width="max-w-xl">
        <FormGrid>
          <div className="sm:col-span-2">
            <Field label="Title" required><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} autoFocus /></Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Description"><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="!min-h-16" /></Field>
          </div>
          <Field label="Assign to">
            <Select value={form.assigned_to} onChange={(e) => setForm({ ...form, assigned_to: e.target.value })}>
              <option value="">Unassigned</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </Select>
          </Field>
          <Field label="Department">
            <Select value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })}>
              <option value="">Any</option>
              {['Admissions', 'Finance', 'Maintenance', 'Housekeeping', 'Security', 'Management'].map((d) => <option key={d}>{d}</option>)}
            </Select>
          </Field>
          <Field label="Property">
            <Select value={form.property_id} onChange={(e) => setForm({ ...form, property_id: e.target.value })}>
              <option value="">All properties</option>
              {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
          <Field label="Due date"><Input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></Field>
          <Field label="Priority">
            <Select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
              {['low', 'normal', 'high', 'urgent'].map((p) => <option key={p} value={p}>{titleCase(p)}</option>)}
            </Select>
          </Field>
        </FormGrid>
        <FormActions>
          <button className="btn-ghost" onClick={() => setFormOpen(false)}>Cancel</button>
          <button className="btn-gold" onClick={createTask}>Create Task</button>
        </FormActions>
      </Modal>

      {/* event form */}
      <Modal open={evOpen} onClose={() => setEvOpen(false)} title="Add calendar event" width="max-w-lg">
        <FormGrid>
          <div className="sm:col-span-2">
            <Field label="Title" required><Input value={evForm.title} onChange={(e) => setEvForm({ ...evForm, title: e.target.value })} autoFocus /></Field>
          </div>
          <Field label="Type">
            <Select value={evForm.type} onChange={(e) => setEvForm({ ...evForm, type: e.target.value })}>
              {['meeting', 'inspection', 'maintenance', 'other'].map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
            </Select>
          </Field>
          <Field label="Date" required><Input type="date" value={evForm.starts_at} onChange={(e) => setEvForm({ ...evForm, starts_at: e.target.value })} /></Field>
          <Field label="Property">
            <Select value={evForm.property_id} onChange={(e) => setEvForm({ ...evForm, property_id: e.target.value })}>
              <option value="">All properties</option>
              {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
          <label className="flex items-end gap-2 pb-2 text-xs text-neutral-600">
            <input type="checkbox" checked={evForm.all_day} onChange={(e) => setEvForm({ ...evForm, all_day: e.target.checked })} className="accent-[#B8860B]" />
            All-day event
          </label>
          <div className="sm:col-span-2">
            <Field label="Description"><Textarea value={evForm.description} onChange={(e) => setEvForm({ ...evForm, description: e.target.value })} className="!min-h-16" /></Field>
          </div>
        </FormGrid>
        <FormActions>
          <button className="btn-ghost" onClick={() => setEvOpen(false)}>Cancel</button>
          <button className="btn-gold" onClick={createEvent}>Add Event</button>
        </FormActions>
      </Modal>

      <ConfirmDialog open={Boolean(confirmDelete)} onClose={() => setConfirmDelete(null)} onConfirm={removeTask}
        title="Delete task?" message={`This permanently deletes ${confirmDelete?.task_ref} — ${confirmDelete?.title}.`} confirmLabel="Delete Task" />
    </div>
  );
}
