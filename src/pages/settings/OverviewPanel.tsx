import { useCallback, useEffect, useState } from 'react';
import {
  Users, UserCheck, Ban, Building2, ShieldAlert, KeyRound, ArrowRight,
  Activity, Unlock, UserPlus, RefreshCw,
} from 'lucide-react';
import { api } from '../../lib/api';
import { Spinner, ErrorNote, StatusPill, EmptyState, toast } from '../../components/ui';
import { fmtWhen } from '../../lib/format';
import { roleLabel } from '../../lib/access';
import type { OverviewData } from './types';

export function OverviewPanel({ goTo }: { goTo: (section: string) => void }) {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [unlocking, setUnlocking] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await api.get<OverviewData>('/settings/overview'));
    } catch (e: any) {
      setError(e.message || 'Could not load administration statistics.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const unlock = async (id: string) => {
    setUnlocking(id);
    try {
      await api.patch(`/users/${id}`, { unlock: true });
      toast('Account unlocked');
      await load();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setUnlocking(null);
    }
  };

  if (loading && !data) return <Spinner label="Loading control centre…" />;
  if (!data) return <ErrorNote message={error || 'No data available.'} />;

  const kpis = [
    { label: 'Employees', value: data.users.total, icon: Users, tone: 'text-neutral-900' },
    { label: 'Active accounts', value: data.users.active, icon: UserCheck, tone: 'text-emerald-600' },
    { label: 'Suspended', value: data.users.suspended, icon: Ban, tone: 'text-amber-600' },
    { label: 'Departments', value: data.departments, icon: Building2, tone: 'text-neutral-900' },
    { label: 'Failed logins (24h)', value: data.failed_logins_24h, icon: ShieldAlert, tone: data.failed_logins_24h > 0 ? 'text-red-600' : 'text-neutral-900' },
    { label: 'Locked accounts', value: data.locked_accounts.length, icon: KeyRound, tone: data.locked_accounts.length > 0 ? 'text-red-600' : 'text-neutral-900' },
  ];

  const maxDept = Math.max(1, ...data.users_by_department.map((d) => d.c));

  return (
    <div className="space-y-4">
      {error && <ErrorNote message={error} />}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-neutral-500">
          Live view of accounts, departments, sign-in activity and administrative changes.
        </p>
        <button onClick={load} className="btn-ghost !py-1.5 text-xs"><RefreshCw size={13} /> Refresh</button>
      </div>

      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {kpis.map((k) => {
          const Icon = k.icon;
          return (
            <div key={k.label} className="panel px-3.5 py-3">
              <div className="flex items-center justify-between">
                <p className="text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">{k.label}</p>
                <Icon size={14} className="text-gold" />
              </div>
              <p className={`mt-1 text-xl font-bold tabular-nums ${k.tone}`}>{k.value}</p>
            </div>
          );
        })}
      </div>

      {(data.locked_accounts.length > 0 || data.suspicious_emails.length > 0) && (
        <div className="panel border-red-200">
          <div className="flex items-center gap-2 border-b border-red-100 bg-red-50 px-4 py-2.5 text-xs font-bold text-red-700">
            <ShieldAlert size={14} /> Security alerts
          </div>
          <div className="space-y-2 px-4 py-3">
            {data.locked_accounts.map((l) => (
              <div key={l.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="text-neutral-700">
                  <strong>{l.full_name}</strong> ({l.email}) is locked until {fmtWhen(l.locked_until)}
                </span>
                <button onClick={() => unlock(l.id)} disabled={unlocking === l.id} className="btn-ghost !py-1 text-[11px]">
                  <Unlock size={12} /> Unlock
                </button>
              </div>
            ))}
            {data.suspicious_emails.map((s) => (
              <p key={s.email} className="text-xs text-red-700">
                {s.c} failed attempts in 24 hours for <strong>{s.email}</strong>
              </p>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-3 xl:grid-cols-2">
        <div className="panel overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <h3 className="flex items-center gap-2 text-xs font-bold text-neutral-800"><Activity size={14} className="text-gold" /> Recent sign-in activity</h3>
            <button onClick={() => goTo('security')} className="text-[11px] font-semibold text-gold-dark hover:underline">View all</button>
          </div>
          <table className="data-table">
            <thead><tr><th>Account</th><th>Result</th><th>When</th></tr></thead>
            <tbody>
              {data.recent_logins.map((l) => (
                <tr key={l.id}>
                  <td>
                    <p className="text-[12px] font-medium text-neutral-800">{l.full_name || l.email}</p>
                    <p className="text-[10.5px] text-neutral-400">{l.ip || 'no IP'}</p>
                  </td>
                  <td>
                    <span className={`pill ${l.success ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                      {l.success ? 'success' : (l.reason || 'failed').replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="text-[11px] text-neutral-500">{fmtWhen(l.created_at)}</td>
                </tr>
              ))}
              {data.recent_logins.length === 0 && (
                <tr><td colSpan={3}><EmptyState title="No sign-in activity yet" /></td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="panel overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <h3 className="flex items-center gap-2 text-xs font-bold text-neutral-800"><UserPlus size={14} className="text-gold" /> Recently created accounts</h3>
            <button onClick={() => goTo('users')} className="text-[11px] font-semibold text-gold-dark hover:underline">Manage users</button>
          </div>
          <table className="data-table">
            <thead><tr><th>Employee</th><th>Role</th><th>Status</th></tr></thead>
            <tbody>
              {data.recent_accounts.map((u) => (
                <tr key={u.id}>
                  <td>
                    <p className="text-[12px] font-medium text-neutral-800">{u.full_name}</p>
                    <p className="text-[10.5px] text-neutral-400">{u.email} · {u.department || 'Unassigned'}</p>
                  </td>
                  <td className="text-[11px] text-neutral-600">{roleLabel(u.role)}</td>
                  <td><StatusPill value={u.status} /></td>
                </tr>
              ))}
              {data.recent_accounts.length === 0 && (
                <tr><td colSpan={3}><EmptyState title="No accounts yet" /></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <div className="panel px-4 py-3">
          <h3 className="mb-3 text-xs font-bold text-neutral-800">Accounts by department</h3>
          <div className="space-y-2">
            {data.users_by_department.map((d) => (
              <div key={d.department} className="flex items-center gap-2">
                <span className="w-32 shrink-0 truncate text-[11.5px] text-neutral-600">{d.department}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-100">
                  <div className="h-full rounded-full bg-gold" style={{ width: `${Math.max(4, (d.c / maxDept) * 100)}%` }} />
                </div>
                <span className="w-7 text-right text-[11px] font-semibold tabular-nums text-neutral-700">{d.c}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5 border-t border-line pt-2.5">
            {data.users_by_role.slice(0, 8).map((r) => (
              <span key={r.role} className="pill bg-neutral-100 text-neutral-600">{roleLabel(r.role)} · {r.c}</span>
            ))}
          </div>
        </div>

        <div className="panel overflow-hidden">
          <div className="border-b border-line px-4 py-2.5">
            <h3 className="text-xs font-bold text-neutral-800">Recent administrative changes</h3>
          </div>
          <div className="max-h-64 divide-y divide-neutral-100 overflow-y-auto">
            {data.recent_changes.map((c, i) => (
              <div key={i} className="px-4 py-2">
                <p className="text-[11.5px] text-neutral-700">{c.summary || c.action}</p>
                <p className="text-[10.5px] text-neutral-400">{c.user_email || 'system'} · {fmtWhen(c.created_at)}</p>
              </div>
            ))}
            {data.recent_changes.length === 0 && (
              <EmptyState title="No changes recorded yet" />
            )}
          </div>
          <button onClick={() => goTo('audit')} className="flex w-full items-center justify-center gap-1 border-t border-line py-2 text-[11px] font-semibold text-gold-dark hover:bg-gold-soft/40">
            Open audit log <ArrowRight size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}
