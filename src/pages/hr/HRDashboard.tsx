import { useEffect, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts';
import {
  Users, UserCheck, CalendarOff, Clock, Cake, Award, FileWarning, Briefcase,
  GraduationCap, Wallet, AlertTriangle, ChevronRight,
} from 'lucide-react';
import { api } from '../../lib/api';
import { EmptyState, MiniStat, Spinner, StatusPill, PanelHeader } from '../../components/ui';
import { fmtDate, titleCase } from '../../lib/format';

interface Dash {
  generated_at: string;
  counts: Record<string, number>;
  attendance: Record<string, number>;
  on_leave_now: { full_name: string; employee_ref: string; leave_type: string }[];
  birthdays: { id: string; full_name: string; date_of_birth: string }[];
  anniversaries: { id: string; full_name: string; hired_at: string }[];
  contract_alerts: { id: string; full_name: string; job_title: string; contract_end: string }[];
  trend: { month: string; hires: number; exits: number }[];
  latest_payroll: { period_key: string; label: string; status: string; net_total: number; employee_count: number } | null;
  training: { total: number; completed: number };
}

function Stat({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number | string; tone?: string }) {
  return (
    <div className="rounded-xl border border-line bg-white px-3.5 py-3">
      <div className="flex items-center gap-2 text-neutral-400">{icon}<span className="text-[10.5px] font-semibold uppercase tracking-wide">{label}</span></div>
      <p className={`mt-1 text-xl font-bold ${tone || 'text-neutral-900'}`}>{value}</p>
    </div>
  );
}

export function HRDashboard({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const [data, setData] = useState<Dash | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get<Dash>('/hr/dashboard')
      .then((r) => { setData(r); setError(null); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spinner label="Loading HR dashboard…" />;
  if (error) return <EmptyState icon={<AlertTriangle size={22} />} title="Could not load the HR dashboard" hint={error} />;
  if (!data) return null;

  const c = data.counts;
  const a = data.attendance;
  const noEmployees = c.total === 0;

  return (
    <div className="space-y-5">
      {noEmployees && (
        <EmptyState
          icon={<Users size={22} />}
          title="No employee records yet"
          hint="The HR dashboard shows live figures once employees are added. Start by creating an employee record — every statistic below is calculated from stored data."
          action={<button className="btn-gold" onClick={() => onNavigate('employees')}>Add first employee</button>}
        />
      )}

      {/* headline counts */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat icon={<Users size={14} />} label="Employees" value={c.total} />
        <Stat icon={<UserCheck size={14} />} label="Active" value={c.active} tone="text-emerald-600" />
        <Stat icon={<CalendarOff size={14} />} label="On leave today" value={a.on_leave_today} tone="text-amber-600" />
        <Stat icon={<Clock size={14} />} label="Present today" value={a.today_present} />
        <Stat icon={<FileWarning size={14} />} label="Pending leave" value={c.pending_leave} tone="text-amber-600" />
        <Stat icon={<Briefcase size={14} />} label="Open vacancies" value={c.open_requisitions} />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat icon={<Award size={14} />} label="Contracts expiring (60d)" value={c.contracts_expiring} tone={c.contracts_expiring ? 'text-red-600' : 'text-neutral-900'} />
        <Stat icon={<Clock size={14} />} label="Late this month" value={a.month_late} tone={a.month_late ? 'text-orange-600' : 'text-neutral-900'} />
        <Stat icon={<FileWarning size={14} />} label="Pending reviews" value={c.pending_reviews} />
        <Stat icon={<AlertTriangle size={14} />} label="Open HR cases" value={c.open_cases} tone={c.open_cases ? 'text-red-600' : 'text-neutral-900'} />
        <Stat icon={<GraduationCap size={14} />} label="Overdue onboarding" value={c.overdue_tasks} tone={c.overdue_tasks ? 'text-orange-600' : 'text-neutral-900'} />
        <Stat icon={<Wallet size={14} />} label="Terminated (total)" value={c.terminated} />
      </div>

      {/* charts */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="panel lg:col-span-2">
          <PanelHeader title="Workforce trend" sub="Hires and exits per month, from employee and exit records" />
          <div className="h-64 px-3 py-3">
            {data.trend.every((t) => t.hires === 0 && t.exits === 0) ? (
              <EmptyState title="No workforce movement recorded" hint="Hires and exits will appear here as employee records change." />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                  <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="hires" name="Hires" fill="#16a34a" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="exits" name="Exits" fill="#dc2626" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="panel">
          <PanelHeader title="This month" sub="Attendance totals from recorded events" />
          <div className="grid grid-cols-2 gap-2 p-4">
            <MiniStat label="Records" value={a.month_records} />
            <MiniStat label="Present" value={a.month_present} tone="green" />
            <MiniStat label="Late arrivals" value={a.month_late} tone="red" />
            <MiniStat label="On leave" value={a.on_leave_today} tone="gold" />
            <MiniStat label="Hours worked" value={Math.round((a.month_worked_minutes || 0) / 60)} />
            <MiniStat label="Overtime hours" value={Math.round((a.month_overtime_minutes || 0) / 60)} tone="gold" />
          </div>
        </div>
      </div>

      {/* lists */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="panel">
          <PanelHeader title="Upcoming birthdays" sub="Next 30 days" />
          <div className="p-3">
            {data.birthdays.length === 0 && <EmptyState title="No birthdays in the next 30 days" hint="Requires a date of birth on the employee record." />}
            <ul className="space-y-2">
              {data.birthdays.map((b) => (
                <li key={b.id} className="flex items-center gap-2 text-xs">
                  <Cake size={14} className="text-gold" />
                  <span className="flex-1 font-medium text-neutral-800">{b.full_name}</span>
                  <span className="text-neutral-400">{fmtDate(b.date_of_birth)}</span>
                </li>
              ))}
            </ul>
          </div>

          <PanelHeader title="Work anniversaries" sub="Next 30 days" />
          <div className="p-3">
            {data.anniversaries.length === 0 && <EmptyState title="No anniversaries in the next 30 days" />}
            <ul className="space-y-2">
              {data.anniversaries.map((x) => (
                <li key={x.id} className="flex items-center gap-2 text-xs">
                  <Award size={14} className="text-gold" />
                  <span className="flex-1 font-medium text-neutral-800">{x.full_name}</span>
                  <span className="text-neutral-400">{fmtDate(x.hired_at)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="panel">
          <PanelHeader title="Contract & probation alerts" sub="Ending within 60 days" />
          <div className="p-3">
            {data.contract_alerts.length === 0 && <EmptyState title="No contracts expiring soon" />}
            <ul className="space-y-2">
              {data.contract_alerts.map((x) => (
                <li key={x.id} className="flex items-center gap-2 text-xs">
                  <FileWarning size={14} className="text-red-500" />
                  <span className="flex-1">
                    <span className="block font-medium text-neutral-800">{x.full_name}</span>
                    <span className="text-neutral-400">{x.job_title}</span>
                  </span>
                  <span className="text-red-600">{fmtDate(x.contract_end)}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="border-t border-line p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Currently on leave</p>
            {data.on_leave_now.length === 0 && <p className="mt-2 text-xs text-neutral-400">Nobody on approved leave today.</p>}
            <ul className="mt-2 space-y-1.5">
              {data.on_leave_now.map((l, i) => (
                <li key={i} className="flex items-center justify-between text-xs">
                  <span className="text-neutral-700">{l.full_name}</span>
                  <span className="pill bg-amber-100 text-amber-700">{l.leave_type}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="panel">
          <PanelHeader title="Payroll & training" />
          <div className="space-y-3 p-4">
            {data.latest_payroll ? (
              <div className="rounded-lg border border-line bg-neutral-50 px-3 py-2.5">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold text-neutral-800">{data.latest_payroll.label}</p>
                  <StatusPill value={data.latest_payroll.status} />
                </div>
                <p className="mt-1 text-[11px] text-neutral-500">
                  {data.latest_payroll.employee_count} employee(s) · net R{Number(data.latest_payroll.net_total).toLocaleString()}
                </p>
                <button className="btn-ghost mt-2 !py-1 text-[11px]" onClick={() => onNavigate('payroll')}>
                  Open payroll <ChevronRight size={12} className="ml-1 inline" />
                </button>
              </div>
            ) : (
              <EmptyState title="No payroll processed" hint="Payroll periods appear once one is created." />
            )}

            <div className="rounded-lg border border-line bg-neutral-50 px-3 py-2.5">
              <p className="text-xs font-bold text-neutral-800">Training completion</p>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-neutral-200">
                <div
                  className="h-full bg-gold"
                  style={{ width: `${data.training.total ? Math.round((data.training.completed / data.training.total) * 100) : 0}%` }}
                />
              </div>
              <p className="mt-1.5 text-[11px] text-neutral-500">
                {data.training.completed} of {data.training.total} enrolments completed
              </p>
            </div>

            <div className="rounded-lg border border-line px-3 py-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Recruitment</p>
              <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                <div><p className="text-lg font-bold text-neutral-800">{c.open_requisitions}</p><p className="text-[10px] text-neutral-400">Vacancies</p></div>
                <div><p className="text-lg font-bold text-neutral-800">{c.applicants}</p><p className="text-[10px] text-neutral-400">Applicants</p></div>
                <div><p className="text-lg font-bold text-neutral-800">{c.exits_12m}</p><p className="text-[10px] text-neutral-400">Exits (12m)</p></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <p className="text-right text-[11px] text-neutral-400">
        Refreshed {new Date(data.generated_at).toLocaleTimeString()} · figures from live records
      </p>
    </div>
  );
}
