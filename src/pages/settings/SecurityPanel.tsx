import { useCallback, useEffect, useState } from 'react';
import {
  ShieldCheck, Save, Loader2, RefreshCw, Lock, KeyRound, MonitorSmartphone,
  ScrollText, ExternalLink, Search, BadgeCheck,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../auth';
import {
  Spinner, ErrorNote, Field, Input, toast, StatusPill, EmptyState,
} from '../../components/ui';
import { fmtWhen } from '../../lib/format';
import { roleLabel } from '../../lib/access';
import type { AuditRow, LoginEvent, SecurityPolicy } from './types';

// ------------------------------- Security ----------------------------------

export function SecurityPanel() {
  const [policy, setPolicy] = useState<SecurityPolicy | null>(null);
  const [stats, setStats] = useState<{ sessions_active: number; failed_24h: number; locked: number } | null>(null);
  const [events, setEvents] = useState<LoginEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'all' | 'fail' | 'success'>('all');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [sec, ev] = await Promise.all([
        api.get<{ policy: SecurityPolicy; sessions_active: number; failed_24h: number; locked: number }>('/settings/security'),
        api.get<{ data: LoginEvent[] }>('/settings/login-events?limit=60'),
      ]);
      setPolicy(sec.policy);
      setStats({ sessions_active: sec.sessions_active, failed_24h: sec.failed_24h, locked: sec.locked });
      setEvents(ev.data);
    } catch (e: any) {
      setError(e.message || 'Could not load security settings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!policy) return;
    setSaving(true);
    try {
      const res = await api.post<{ policy: SecurityPolicy }>('/settings/security', policy);
      setPolicy(res.policy);
      toast('Security policy saved');
      await load();
    } catch (e: any) {
      toast(e.message || 'Could not save security policy', 'error');
    } finally {
      setSaving(false);
    }
  };

  const visibleEvents = events.filter((e) => {
    if (filter === 'fail') return !e.success;
    if (filter === 'success') return Boolean(e.success);
    return true;
  });

  if (loading) return <Spinner label="Loading security settings…" />;
  if (error) return <ErrorNote message={error} />;

  return (
    <div className="space-y-4">
      <div className="grid gap-2.5 sm:grid-cols-3">
        {[
          { label: 'Active sessions', value: stats?.sessions_active ?? 0, icon: MonitorSmartphone },
          { label: 'Failed sign-ins (24h)', value: stats?.failed_24h ?? 0, icon: Lock },
          { label: 'Locked accounts', value: stats?.locked ?? 0, icon: KeyRound },
        ].map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.label} className="panel flex items-center gap-3 px-4 py-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gold-soft text-gold-dark"><Icon size={15} /></span>
              <div>
                <p className="text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">{s.label}</p>
                <p className="text-lg font-bold tabular-nums text-neutral-900">{s.value}</p>
              </div>
            </div>
          );
        })}
      </div>

      {policy && (
        <div className="panel px-5 py-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-bold text-neutral-800"><ShieldCheck size={15} className="text-gold" /> Login & authentication policy</h3>
            <button onClick={save} disabled={saving} className="btn-gold !py-1.5 text-xs">
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save policy
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Failed attempts before lockout">
              <Input
                type="number"
                min={1}
                value={policy.max_failed_attempts}
                onChange={(e) => setPolicy({ ...policy, max_failed_attempts: Number(e.target.value) })}
              />
            </Field>
            <Field label="Lockout duration (minutes)">
              <Input
                type="number"
                min={1}
                value={policy.lockout_minutes}
                onChange={(e) => setPolicy({ ...policy, lockout_minutes: Number(e.target.value) })}
              />
            </Field>
            <Field label="Session lifetime (hours)" hint="720 hours = 30 days">
              <Input
                type="number"
                min={1}
                value={policy.session_hours}
                onChange={(e) => setPolicy({ ...policy, session_hours: Number(e.target.value) })}
              />
            </Field>
            <Field label="Minimum password length">
              <Input
                type="number"
                min={8}
                value={policy.min_password_length}
                onChange={(e) => setPolicy({ ...policy, min_password_length: Number(e.target.value) })}
              />
            </Field>
          </div>
          <div className="mt-3 flex flex-wrap gap-4 text-xs text-neutral-600">
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={policy.require_strong_password}
                onChange={(e) => setPolicy({ ...policy, require_strong_password: e.target.checked })}
                className="h-3.5 w-3.5 accent-[#c9a227]"
              />
              Require mixed character classes
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={policy.mfa_available}
                onChange={(e) => setPolicy({ ...policy, mfa_available: e.target.checked })}
                className="h-3.5 w-3.5 accent-[#c9a227]"
              />
              Mark multi-factor as available for employees
            </label>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-neutral-500">
            Password policy changes apply to new passwords and resets. Existing sessions keep their current expiry.
            Locked accounts can be released from the Users section or the Administration overview.
          </p>
        </div>
      )}

      <div className="panel overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          <h3 className="flex items-center gap-2 text-xs font-bold text-neutral-800"><ScrollText size={14} className="text-gold" /> Authentication activity</h3>
          <div className="flex items-center gap-1.5">
            {(['all', 'success', 'fail'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-md px-2 py-1 text-[11px] font-semibold ${
                  filter === f ? 'bg-ink text-gold' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                }`}
              >
                {f === 'all' ? 'All' : f === 'fail' ? 'Failed' : 'Successful'}
              </button>
            ))}
            <button onClick={load} className="btn-ghost !p-1.5"><RefreshCw size={12} /></button>
          </div>
        </div>
        <div className="max-h-80 overflow-y-auto">
          <table className="data-table">
            <thead><tr><th>Account</th><th>Result</th><th>Reason</th><th>IP</th><th>When</th></tr></thead>
            <tbody>
              {visibleEvents.map((e) => (
                <tr key={e.id}>
                  <td>
                    <p className="text-[12px] font-medium text-neutral-800">{e.full_name || e.email}</p>
                    <p className="text-[10.5px] text-neutral-400">{e.email}</p>
                  </td>
                  <td>
                    <span className={`pill ${e.success ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                      {e.success ? 'success' : 'failed'}
                    </span>
                  </td>
                  <td className="text-[11px] text-neutral-600">{(e.reason || '—').replace(/_/g, ' ')}</td>
                  <td className="font-mono text-[10.5px] text-neutral-500">{e.ip || '—'}</td>
                  <td className="text-[11px] text-neutral-500">{fmtWhen(e.created_at)}</td>
                </tr>
              ))}
              {visibleEvents.length === 0 && <tr><td colSpan={5}><EmptyState title="No sign-in events for this filter" /></td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// -------------------------------- Account ----------------------------------

export function AccountPanel({ forceChange }: { forceChange: boolean }) {
  const { user, refresh } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setError('');
    if (!current || !next) { setError('Enter your current and new password.'); return; }
    if (next !== confirm) { setError('The new passwords do not match.'); return; }
    if (next.length < 8) { setError('The new password must be at least 8 characters.'); return; }
    setSaving(true);
    try {
      await api.post('/auth/change-password', { current_password: current, new_password: next });
      toast('Password changed');
      setCurrent(''); setNext(''); setConfirm('');
      await refresh();
    } catch (e: any) {
      setError(e.message || 'Could not change the password.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {forceChange && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[12.5px] text-amber-800">
          This account is using a temporary password. Set a permanent password below before continuing.
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="panel px-5 py-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-neutral-800"><BadgeCheck size={15} className="text-gold" /> My profile</h3>
          <dl className="space-y-2 text-[12px]">
            {[
              ['Full name', user?.full_name],
              ['Email', user?.email],
              ['Username', user?.username || '—'],
              ['Role', roleLabel(user?.role || '')],
              ['Department', user?.department || 'Unassigned'],
              ['Job title', user?.job_title || '—'],
              ['Employee number', user?.employee_ref || '—'],
            ].map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-3 border-b border-neutral-100 pb-1.5 last:border-0">
                <dt className="text-neutral-500">{k}</dt>
                <dd className="text-right font-medium text-neutral-800">{v || '—'}</dd>
              </div>
            ))}
            <div className="flex items-center justify-between gap-3">
              <dt className="text-neutral-500">Account status</dt>
              <dd><StatusPill value={user?.status || 'active'} /></dd>
            </div>
          </dl>
        </div>

        <div className="panel px-5 py-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-neutral-800"><KeyRound size={15} className="text-gold" /> Change password</h3>
          {error && <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-[11.5px] text-red-700">{error}</p>}
          <div className="space-y-3">
            <Field label="Current password" required>
              <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
            </Field>
            <Field label="New password" required hint="At least 8 characters with mixed character classes">
              <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
            </Field>
            <Field label="Confirm new password" required>
              <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </Field>
            <button onClick={submit} disabled={saving} className="btn-gold w-full !py-2 text-xs">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {saving ? 'Saving…' : 'Update password'}
            </button>
          </div>
          <p className="mt-3 text-[10.5px] leading-relaxed text-neutral-400">
            Changing your password signs out your other sessions. Multi-factor authentication is only enabled when the administrator turns it on.
          </p>
        </div>
      </div>
    </div>
  );
}

// --------------------------------- Audit -----------------------------------

export function AuditPanel() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const pageSize = 20;

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get<{ data: AuditRow[]; pagination: { total: number } }>(
        `/audit?page=${page}&pageSize=${pageSize}${query ? `&q=${encodeURIComponent(query)}` : ''}`
      );
      setRows(res.data);
      setTotal(res.pagination.total);
    } catch (e: any) {
      setError(e.message || 'Could not load the audit log.');
    } finally {
      setLoading(false);
    }
  }, [page, query]);

  useEffect(() => { load(); }, [load]);

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPage(1); }}
            placeholder="Search action, summary or user…"
            className="field !py-1.5 !pl-8 text-xs"
          />
        </div>
        <Link to="/audit" className="btn-ghost !py-1.5 text-xs"><ExternalLink size={13} /> Full audit page</Link>
      </div>

      {error && <ErrorNote message={error} />}

      <div className="panel overflow-hidden">
        {loading ? <Spinner label="Loading audit log…" /> : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead><tr><th>Action</th><th>Summary</th><th>User</th><th>IP</th><th>When</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td><span className="pill bg-neutral-100 font-mono text-neutral-600">{r.action}</span></td>
                    <td className="max-w-md text-[11.5px] text-neutral-700">{r.summary || '—'}</td>
                    <td className="text-[11px] text-neutral-500">{r.user_name || r.user_email || 'system'}</td>
                    <td className="font-mono text-[10.5px] text-neutral-500">{r.ip || '—'}</td>
                    <td className="text-[11px] text-neutral-500">{fmtWhen(r.created_at)}</td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={5}><EmptyState title="No audit entries match" /></td></tr>}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex items-center justify-between border-t border-line px-4 py-2 text-[11px] text-neutral-500">
          <span>{total} entries · page {page} of {pages}</span>
          <div className="flex gap-1">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="btn-ghost !py-1 text-[11px] disabled:opacity-40">Previous</button>
            <button disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="btn-ghost !py-1 text-[11px] disabled:opacity-40">Next</button>
          </div>
        </div>
      </div>
    </div>
  );
}
