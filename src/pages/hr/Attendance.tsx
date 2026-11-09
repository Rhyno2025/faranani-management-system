import { useCallback, useEffect, useState } from 'react';
import { LogIn, LogOut, Search, CalendarClock, Plus } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../auth';
import {
  Field, Input, Select, FormGrid, FormActions, Modal, StatusPill, toast, MiniStat, EmptyState,
} from '../../components/ui';
import { DataTable, Column, TableToolbar } from '../../components/DataTable';
import { fmtDate, fmtDateTime, monthStartISO, todayISO, titleCase } from '../../lib/format';
import { sastClock } from '../../lib/format';

export function Attendance() {
  const { can, user } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 25, total: 0, totalPages: 1 });
  const [from, setFrom] = useState(monthStartISO());
  const [to, setTo] = useState(todayISO());
  const [clockState, setClockState] = useState<any>(null);
  const [clocking, setClocking] = useState(false);

  const [entryOpen, setEntryOpen] = useState(false);
  const [entryForm, setEntryForm] = useState({ staff_id: '', work_date: todayISO(), clock_in: '', clock_out: '', status: 'present', note: '', correction_note: '' });
  const [employees, setEmployees] = useState<any[]>([]);
  const [shifts, setShifts] = useState<any[]>([]);
  const [shiftOpen, setShiftOpen] = useState(false);
  const [shiftForm, setShiftForm] = useState({ staff_id: '', shift_date: todayISO(), name: 'Standard', start_time: '08:00', end_time: '17:00' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ from, to, page: String(page), pageSize: '25' });
      if (q) p.set('q', q);
      const r = await api.get<any>(`/hr/attendance?${p.toString()}`);
      setRows(r.data); setPagination(r.pagination); setSummary(r.summary);
      const sh = await api.get<any>(`/hr/shifts?from=${from}&to=${to}`);
      setShifts(sh.data || []);
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  }, [from, to, page, q]);

  useEffect(() => { const t = setTimeout(load, q ? 300 : 0); return () => clearTimeout(t); }, [load, q]);

  const loadEmployees = async () => {
    try { setEmployees((await api.get<any>('/hr/employees?pageSize=300')).data); } catch { setEmployees([]); }
  };

  const clock = async (action: 'in' | 'out') => {
    setClocking(true);
    try {
      const r = await api.post<any>('/hr/attendance/clock', { action });
      setClockState(r);
      toast(action === 'in' ? `Clocked in at ${r.clock_in.slice(11, 16)}` : `Clocked out at ${r.clock_out.slice(11, 16)}`);
      load();
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setClocking(false); }
  };

  const saveEntry = async () => {
    if (!entryForm.staff_id || !entryForm.work_date) { toast('Employee and date are required', 'error'); return; }
    try { await api.post('/hr/attendance', entryForm); toast('Attendance recorded'); setEntryOpen(false); load(); }
    catch (e: any) { toast(e.message, 'error'); }
  };

  const saveShift = async () => {
    if (!shiftForm.staff_id) { toast('Select an employee', 'error'); return; }
    try { await api.post('/hr/shifts', shiftForm); toast('Shift scheduled'); setShiftOpen(false); load(); }
    catch (e: any) { toast(e.message, 'error'); }
  };

  const cols: Column<any>[] = [
    { key: 'full_name', header: 'Employee', render: (r) => (
      <div>
        <p className="text-xs font-semibold text-neutral-800">{r.full_name}</p>
        <p className="text-[11px] text-neutral-400">{r.employee_ref} · {r.department || '—'}</p>
      </div>
    ) },
    { key: 'work_date', header: 'Date', render: (r) => <span className="whitespace-nowrap text-xs">{fmtDate(r.work_date)}</span> },
    { key: 'clock_in', header: 'In', render: (r) => <span className="font-mono text-xs">{r.clock_in ? r.clock_in.slice(11, 16) : '—'}</span> },
    { key: 'clock_out', header: 'Out', render: (r) => <span className="font-mono text-xs">{r.clock_out ? r.clock_out.slice(11, 16) : '—'}</span> },
    { key: 'worked_minutes', header: 'Hours', render: (r) => <span className="text-xs">{(Math.round((r.worked_minutes || 0) / 6) / 10).toFixed(1)}</span> },
    { key: 'late_minutes', header: 'Late', render: (r) => <span className={`text-xs ${r.late_minutes > 0 ? 'font-semibold text-red-600' : 'text-neutral-500'}`}>{r.late_minutes > 0 ? `${r.late_minutes}m` : '—'}</span> },
    { key: 'overtime_minutes', header: 'OT', render: (r) => <span className="text-xs text-neutral-600">{r.overtime_minutes > 0 ? `${Math.round(r.overtime_minutes / 6) / 10}h` : '—'}</span> },
    { key: 'source', header: 'Source', render: (r) => <span className="pill bg-neutral-100 text-neutral-500">{r.source === 'manual' ? 'Manual' : r.source}</span> },
    { key: 'status', header: 'Status', render: (r) => <StatusPill value={r.status} /> },
  ];

  return (
    <div className="space-y-4">
      {/* clock strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-neutral-50 px-4 py-3">
        <div>
          <p className="text-xs font-semibold text-neutral-700">Today · {fmtDate(todayISO())} · {sastClock()}</p>
          <p className="text-[11px] text-neutral-500">
            {clockState?.clock_in ? `Clocked in ${clockState.clock_in.slice(11, 16)}${clockState.clock_out ? ` · out ${clockState.clock_out.slice(11, 16)}` : ''}` : 'Timestamps are recorded by the server — biometric devices are not connected.'}
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn-ghost inline-flex items-center gap-1.5" disabled={clocking} onClick={() => clock('in')}><LogIn size={14} /> Clock In</button>
          <button className="btn-gold inline-flex items-center gap-1.5" disabled={clocking} onClick={() => clock('out')}><LogOut size={14} /> Clock Out</button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <MiniStat label="Records" value={summary?.records ?? 0} />
        <MiniStat label="Present" value={summary?.present ?? 0} tone="green" />
        <MiniStat label="Late" value={summary?.late ?? 0} tone="red" />
        <MiniStat label="Absent" value={summary?.absent ?? 0} tone="gold" />
        <MiniStat label="Overtime hours" value={Math.round((summary?.overtime || 0) / 6) / 10} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-neutral-500">Attendance register · {pagination.total} record(s)</p>
        <div className="flex gap-2">
          <button className="btn-ghost inline-flex items-center gap-1.5" onClick={() => { setShiftForm({ ...shiftForm, staff_id: '' }); setShiftOpen(true); loadEmployees(); }}>
            <CalendarClock size={14} /> Schedule shift
          </button>
          {can('hr.attendance') && (
            <button className="btn-gold inline-flex items-center gap-1.5" onClick={() => { setEntryForm({ ...entryForm, staff_id: '' }); setEntryOpen(true); loadEmployees(); }}>
              <Plus size={14} /> Manual entry / correction
            </button>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-line">
        <DataTable
          rows={rows} columns={cols} loading={loading} rowKey={(r) => r.id}
          page={pagination.page} pageSize={pagination.pageSize} total={pagination.total} totalPages={pagination.totalPages}
          onPageChange={setPage}
          emptyTitle="No attendance recorded" emptyHint="Clock events and authorised manual entries will appear here."
          toolbar={
            <TableToolbar>
              <div className="relative min-w-[180px] flex-1">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search employee…" aria-label="Search attendance" className="field !py-1.5 !pl-9 text-xs" />
              </div>
              <input type="date" aria-label="From" className="field !w-auto !py-1.5 text-xs" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} />
              <input type="date" aria-label="To" className="field !w-auto !py-1.5 text-xs" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} />
            </TableToolbar>
          }
        />
      </div>

      {shifts.length > 0 && (
        <div className="rounded-xl border border-line">
          <p className="border-b border-line px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-neutral-500">Scheduled shifts in range</p>
          <ul className="divide-y divide-neutral-100">
            {shifts.map((s) => (
              <li key={s.id} className="flex items-center justify-between px-4 py-2 text-xs">
                <span className="font-medium text-neutral-800">{s.full_name}</span>
                <span className="text-neutral-500">{fmtDate(s.shift_date)} · {s.name} · {s.start_time}–{s.end_time}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Modal open={entryOpen} onClose={() => setEntryOpen(false)} title="Manual attendance / correction" width="max-w-xl">
        <FormGrid>
          <div className="sm:col-span-2">
            <Field label="Employee" required>
              <Select value={entryForm.staff_id} onChange={(e) => setEntryForm({ ...entryForm, staff_id: e.target.value })}>
                <option value="">Select employee…</option>
                {employees.map((s) => <option key={s.id} value={s.id}>{s.employee_ref} — {s.full_name}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Work date" required><Input type="date" value={entryForm.work_date} onChange={(e) => setEntryForm({ ...entryForm, work_date: e.target.value })} /></Field>
          <Field label="Status">
            <Select value={entryForm.status} onChange={(e) => setEntryForm({ ...entryForm, status: e.target.value })}>
              {['present', 'absent', 'leave', 'holiday', 'remote', 'sick'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
            </Select>
          </Field>
          <Field label="Clock in (HH:MM)"><Input value={entryForm.clock_in} onChange={(e) => setEntryForm({ ...entryForm, clock_in: e.target.value })} placeholder="08:00" /></Field>
          <Field label="Clock out (HH:MM)"><Input value={entryForm.clock_out} onChange={(e) => setEntryForm({ ...entryForm, clock_out: e.target.value })} placeholder="17:00" /></Field>
          <div className="sm:col-span-2"><Field label="Note"><Input value={entryForm.note} onChange={(e) => setEntryForm({ ...entryForm, note: e.target.value })} /></Field></div>
          <div className="sm:col-span-2">
            <Field label="Correction reason" hint="Required when correcting an existing record — recorded timestamps are never changed silently.">
              <Input value={entryForm.correction_note} onChange={(e) => setEntryForm({ ...entryForm, correction_note: e.target.value })} />
            </Field>
          </div>
        </FormGrid>
        <FormActions>
          <button className="btn-ghost" onClick={() => setEntryOpen(false)}>Cancel</button>
          <button className="btn-gold" onClick={saveEntry}>Save Record</button>
        </FormActions>
      </Modal>

      <Modal open={shiftOpen} onClose={() => setShiftOpen(false)} title="Schedule shift" width="max-w-lg">
        <FormGrid>
          <div className="sm:col-span-2">
            <Field label="Employee" required>
              <Select value={shiftForm.staff_id} onChange={(e) => setShiftForm({ ...shiftForm, staff_id: e.target.value })}>
                <option value="">Select employee…</option>
                {employees.map((s) => <option key={s.id} value={s.id}>{s.employee_ref} — {s.full_name}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Date" required><Input type="date" value={shiftForm.shift_date} onChange={(e) => setShiftForm({ ...shiftForm, shift_date: e.target.value })} /></Field>
          <Field label="Shift name"><Input value={shiftForm.name} onChange={(e) => setShiftForm({ ...shiftForm, name: e.target.value })} /></Field>
          <Field label="Start"><Input type="time" value={shiftForm.start_time} onChange={(e) => setShiftForm({ ...shiftForm, start_time: e.target.value })} /></Field>
          <Field label="End"><Input type="time" value={shiftForm.end_time} onChange={(e) => setShiftForm({ ...shiftForm, end_time: e.target.value })} /></Field>
        </FormGrid>
        <FormActions>
          <button className="btn-ghost" onClick={() => setShiftOpen(false)}>Cancel</button>
          <button className="btn-gold" onClick={saveShift}>Schedule</button>
        </FormActions>
      </Modal>
    </div>
  );
}
