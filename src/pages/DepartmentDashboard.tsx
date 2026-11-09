import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Users, FileCheck, Building2, BedDouble, MessageSquareWarning,
  Wrench, Sparkles, Wallet, Contact, CalendarDays, FolderOpen, Megaphone,
  BarChart3, ScrollText, Settings as SettingsIcon, ArrowRight, ShieldCheck,
  KeyRound, Clock, BellRing, BadgeCheck, AlertTriangle,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../auth';
import { MODULES } from '../lib/access';
import { roleLabel } from '../lib/access';
import { fmtWhen, zar } from '../lib/format';
import { Spinner, ErrorNote, StatusPill } from '../components/ui';
import type { User } from '../lib/types';

const ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  '/': LayoutDashboard,
  '/students': Users,
  '/applications': FileCheck,
  '/properties': Building2,
  '/rooms': BedDouble,
  '/complaints': MessageSquareWarning,
  '/maintenance': Wrench,
  '/cleaning': Sparkles,
  '/finance': Wallet,
  '/hr': Contact,
  '/tasks': CalendarDays,
  '/documents': FolderOpen,
  '/announcements': Megaphone,
  '/reports': BarChart3,
  '/audit': ScrollText,
  '/settings': SettingsIcon,
};

interface WorkspaceResponse {
  user: User;
  permissions: string[];
  stats: Record<string, number>;
}

export default function DepartmentDashboard() {
  const { user, permissions, can } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<WorkspaceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await api.get<WorkspaceResponse>('/workspace'));
    } catch (e: any) {
      setError(e.message || 'Could not load your workspace.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const modules = useMemo(
    () => MODULES.filter((m) => m.to !== '/' && (!m.perm || can(m.perm))),
    [can]
  );

  const stats = data?.stats || {};
  const kpis: { label: string; value: string | number; tone?: string }[] = [];
  if (stats.my_open_tasks !== undefined) kpis.push({ label: 'My open tasks', value: stats.my_open_tasks });
  if (stats.my_open_jobs !== undefined) kpis.push({ label: 'My open jobs', value: stats.my_open_jobs });
  if (stats.my_cleaning_today !== undefined) kpis.push({ label: 'Cleaning due today', value: stats.my_cleaning_today });
  if (stats.my_pending_leave !== undefined) kpis.push({ label: 'My pending leave', value: stats.my_pending_leave });
  if (stats.leave_awaiting_approval !== undefined) kpis.push({ label: 'Leave awaiting approval', value: stats.leave_awaiting_approval });
  if (stats.open_complaints !== undefined) kpis.push({ label: 'Open complaints', value: stats.open_complaints });
  if (stats.active_students !== undefined) kpis.push({ label: 'Active students', value: stats.active_students });
  if (stats.outstanding_receivables !== undefined) kpis.push({ label: 'Outstanding receivables', value: zar(stats.outstanding_receivables) });
  if (stats.unread_notifications !== undefined) kpis.push({ label: 'Unread notifications', value: stats.unread_notifications });

  if (loading && !data) return <Spinner label="Preparing your workspace…" />;

  return (
    <div className="space-y-5">
      {/* header */}
      <div className="panel overflow-hidden">
        <div className="bg-ink px-5 py-5 text-white sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-gold">
                {user?.department || 'Faranani Property Group'}
              </p>
              <h1 className="mt-1 text-xl font-bold sm:text-2xl">
                Good day, {user?.full_name?.split(' ')[0] || 'colleague'}
              </h1>
              <p className="mt-1 text-[12.5px] text-white/60">
                {roleLabel(user?.role || '')}
                {user?.job_title ? ` · ${user.job_title}` : ''}
                {user?.employee_ref ? ` · ${user.employee_ref}` : ''}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[10.5px] uppercase tracking-wide text-white/40">Last sign-in</p>
              <p className="text-[12.5px] font-semibold text-white/85">
                {user?.last_login_at ? fmtWhen(user.last_login_at) : 'This is your first session'}
              </p>
              <div className="mt-2 flex justify-end">
                <span className="pill bg-gold-soft text-gold-dark">{permissions.length} permissions</span>
              </div>
            </div>
          </div>
        </div>
        {user?.must_change_password && (
          <div className="flex flex-wrap items-center gap-3 border-b border-amber-200 bg-amber-50 px-5 py-3 text-[12.5px] text-amber-800">
            <AlertTriangle size={15} />
            <span className="flex-1">You are using a temporary password. Set a permanent password to secure your account.</span>
            <button onClick={() => navigate('/settings?tab=account&force=1')} className="btn-gold !py-1.5 text-xs">
              Change password
            </button>
          </div>
        )}
      </div>

      {error && <ErrorNote message={error} />}

      {/* KPI tiles */}
      {kpis.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {kpis.map((k) => (
            <div key={k.label} className="panel px-4 py-3">
              <p className="text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">{k.label}</p>
              <p className="mt-1 text-xl font-bold tabular-nums text-neutral-900">{k.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* modules */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-neutral-800">Your modules</h2>
            <p className="text-xs text-neutral-500">
              Only the departments and functions assigned to your role are shown.
            </p>
          </div>
          <span className="pill bg-neutral-100 text-neutral-600">{modules.length} available</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {modules.map((m) => {
            const Icon = ICONS[m.to] || LayoutDashboard;
            return (
              <Link
                key={m.to}
                to={m.to}
                className="group panel flex items-start gap-3 px-4 py-3.5 transition hover:-translate-y-0.5 hover:border-gold/50 hover:shadow-md"
              >
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gold-soft text-gold-dark">
                  <Icon size={17} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-[13px] font-bold text-neutral-800">
                    {m.label}
                    <ArrowRight size={13} className="text-neutral-300 transition group-hover:translate-x-0.5 group-hover:text-gold" />
                  </span>
                  <span className="mt-0.5 block text-[11.5px] leading-relaxed text-neutral-500">{m.description}</span>
                </span>
              </Link>
            );
          })}
          {modules.length === 0 && (
            <div className="panel col-span-full px-5 py-8 text-center text-sm text-neutral-500">
              No modules have been assigned to your account yet. Contact a Super Administrator.
            </div>
          )}
        </div>
      </div>

      {/* access summary */}
      <div className="grid gap-3 lg:grid-cols-3">
        <div className="panel px-5 py-4 lg:col-span-2">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-neutral-800">
            <ShieldCheck size={15} className="text-gold" /> Access summary
          </h3>
          <p className="text-xs text-neutral-500">
            Permissions are enforced on the server for every request — hiding a menu item is not the only control.
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {permissions.map((p) => (
              <span key={p} className="pill bg-neutral-100 text-neutral-600">{p}</span>
            ))}
          </div>
        </div>
        <div className="panel px-5 py-4">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-neutral-800">
            <KeyRound size={15} className="text-gold" /> Account
          </h3>
          <dl className="space-y-2 text-[12px]">
            <div className="flex items-center justify-between gap-2">
              <dt className="text-neutral-500">Email</dt>
              <dd className="truncate font-medium text-neutral-800">{user?.email}</dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-neutral-500">Status</dt>
              <dd><StatusPill value={user?.status || 'active'} /></dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-neutral-500">Department</dt>
              <dd className="font-medium text-neutral-800">{user?.department || 'Unassigned'}</dd>
            </div>
          </dl>
          <button onClick={() => navigate('/settings?tab=account')} className="btn-ghost mt-3 w-full !py-1.5 text-xs">
            <BadgeCheck size={13} /> Account settings
          </button>
        </div>
      </div>

      {/* quick links */}
      <div className="flex flex-wrap gap-2 text-xs">
        {can('announcements.view') && (
          <Link to="/announcements" className="btn-ghost !py-1.5"><Megaphone size={13} /> Announcements</Link>
        )}
        {can('tasks.view') && (
          <Link to="/tasks" className="btn-ghost !py-1.5"><Clock size={13} /> My tasks</Link>
        )}
        {can('documents.view') && (
          <Link to="/documents" className="btn-ghost !py-1.5"><FolderOpen size={13} /> Documents</Link>
        )}
        <Link to="/settings?tab=account" className="btn-ghost !py-1.5"><BellRing size={13} /> Notifications</Link>
      </div>
    </div>
  );
}
