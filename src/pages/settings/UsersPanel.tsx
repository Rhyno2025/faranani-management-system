import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Plus, Search, KeyRound, ShieldCheck, UserX, Pencil, Users, Upload, Copy,
  ChevronLeft, ChevronRight, Loader2, UserCheck, Ban, AlertTriangle, Table2, Check, Minus,
} from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../auth';
import {
  Spinner, ErrorNote, Modal, Field, Input, Select, ConfirmDialog, toast,
  StatusPill, EmptyState,
} from '../../components/ui';
import { fmtWhen, initials } from '../../lib/format';
import { roleLabel } from '../../lib/access';
import type { DepartmentRow, PermissionDef, RoleDef, UserRow } from './types';

const PAGE_SIZE = 8;

const MATRIX_COLUMNS = [
  { key: 'students.view', label: 'Students' },
  { key: 'applications.view', label: 'Admissions' },
  { key: 'properties.view', label: 'Properties' },
  { key: 'rooms.view', label: 'Rooms' },
  { key: 'complaints.view', label: 'Complaints' },
  { key: 'maintenance.view', label: 'Maintenance' },
  { key: 'cleaning.view', label: 'Cleaning' },
  { key: 'finance.view', label: 'Finance' },
  { key: 'finance.gl.view', label: 'Ledger' },
  { key: 'hr.dashboard', label: 'HR' },
  { key: 'hr.payroll.view', label: 'Payroll' },
  { key: 'reports.view', label: 'Reports' },
  { key: 'users.manage', label: 'Users' },
  { key: 'settings.manage', label: 'Settings' },
  { key: 'audit.view', label: 'Audit' },
  { key: 'ai.use', label: 'CALVIN' },
];

interface UserForm {
  full_name: string;
  email: string;
  username: string;
  phone: string;
  employee_ref: string;
  department: string;
  job_title: string;
  role: string;
  password: string;
  confirm: string;
  status: string;
  must_change: boolean;
}

const EMPTY_FORM: UserForm = {
  full_name: '', email: '', username: '', phone: '', employee_ref: '',
  department: '', job_title: '', role: 'employee', password: '', confirm: '',
  status: 'active', must_change: true,
};

export function UsersPanel() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<RoleDef[]>([]);
  const [permissions, setPermissions] = useState<PermissionDef[]>([]);
  const [departments, setDepartments] = useState<DepartmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [page, setPage] = useState(1);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [form, setForm] = useState<UserForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [permUser, setPermUser] = useState<UserRow | null>(null);
  const [permSelected, setPermSelected] = useState<Set<string>>(new Set());
  const [permRoleBase, setPermRoleBase] = useState<Set<string>>(new Set());
  const [permSearch, setPermSearch] = useState('');
  const [permLoading, setPermLoading] = useState(false);
  const [permSaving, setPermSaving] = useState(false);

  const [resetUser, setResetUser] = useState<UserRow | null>(null);
  const [tempPassword, setTempPassword] = useState('');
  const [resetting, setResetting] = useState(false);

  const [deactivating, setDeactivating] = useState<UserRow | null>(null);
  const [matrixOpen, setMatrixOpen] = useState(false);

  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResults, setBulkResults] = useState<{ line: string; ok: boolean; message: string }[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [u, r, d] = await Promise.all([
        api.get<{ data: UserRow[] }>('/users'),
        api.get<{ roles: RoleDef[]; permissions: PermissionDef[] }>('/roles'),
        api.get<{ data: DepartmentRow[] }>('/settings/departments'),
      ]);
      setUsers(u.data);
      setRoles(r.roles);
      setPermissions(r.permissions);
      setDepartments(d.data);
    } catch (e: any) {
      setError(e.message || 'Could not load user accounts.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (roleFilter && u.role !== roleFilter) return false;
      if (statusFilter && u.status !== statusFilter) return false;
      if (deptFilter && (u.department || 'Unassigned') !== deptFilter) return false;
      if (!q) return true;
      return [u.full_name, u.email, u.username, u.employee_ref, u.department, u.job_title]
        .filter(Boolean).some((v) => String(v).toLowerCase().includes(q));
    });
  }, [users, search, roleFilter, statusFilter, deptFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => { if (page > totalPages) setPage(1); }, [page, totalPages]);

  const counts = useMemo(() => ({
    total: users.length,
    active: users.filter((u) => u.status === 'active').length,
    suspended: users.filter((u) => u.status === 'suspended').length,
    deactivated: users.filter((u) => u.status === 'deactivated').length,
    mustChange: users.filter((u) => Boolean(u.must_change_password)).length,
  }), [users]);

  const openNew = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM, department: departments[0]?.name || '' });
    setFormOpen(true);
  };

  const openEdit = (u: UserRow) => {
    setEditing(u);
    setForm({
      full_name: u.full_name,
      email: u.email,
      username: u.username || '',
      phone: u.phone || '',
      employee_ref: u.employee_ref || '',
      department: u.department || '',
      job_title: u.job_title || '',
      role: u.role,
      password: '',
      confirm: '',
      status: u.status,
      must_change: Boolean(u.must_change_password),
    });
    setFormOpen(true);
  };

  const submitForm = async () => {
    if (!form.full_name.trim() || !form.email.trim()) {
      toast('Full name and email are required.', 'error'); return;
    }
    if (!editing) {
      if (!form.password) { toast('Set an initial password (or use bulk registration).', 'error'); return; }
      if (form.password !== form.confirm) { toast('Passwords do not match.', 'error'); return; }
    } else if (form.password && form.password !== form.confirm) {
      toast('Passwords do not match.', 'error'); return;
    }
    setSaving(true);
    try {
      if (editing) {
        const body: Record<string, unknown> = {
          full_name: form.full_name.trim(),
          email: form.email.trim(),
          username: form.username.trim(),
          phone: form.phone,
          department: form.department,
          job_title: form.job_title,
          must_change_password: form.must_change,
          status: form.status,
          unlock: true,
        };
        if (form.role !== editing.role && editing.id !== me?.id) body.role = form.role;
        if (editing.id === me?.id) delete body.status;
        if (form.password) body.password = form.password;
        await api.patch(`/users/${editing.id}`, body);
        toast('Employee account updated');
      } else {
        const res = await api.post<{ id: string }>('/users', {
          full_name: form.full_name.trim(),
          email: form.email.trim(),
          username: form.username.trim() || undefined,
          phone: form.phone,
          employee_ref: form.employee_ref || undefined,
          department: form.department,
          job_title: form.job_title,
          role: form.role,
          password: form.password,
          must_change_password: form.must_change,
        });
        toast(`Account created for ${form.email.trim()}${res.id ? '' : ''}`);
      }
      setFormOpen(false);
      await load();
    } catch (e: any) {
      toast(e.message || 'Could not save the account', 'error');
    } finally {
      setSaving(false);
    }
  };

  const openPermissions = async (u: UserRow) => {
    setPermUser(u);
    setPermSearch('');
    setPermLoading(true);
    try {
      const res = await api.get<{ role_permissions: string[]; effective: string[] }>(`/users/${u.id}/permissions`);
      setPermRoleBase(new Set(res.role_permissions));
      setPermSelected(new Set(res.effective));
    } catch (e: any) {
      toast(e.message, 'error');
      setPermRoleBase(new Set(u.permissions));
      setPermSelected(new Set(u.permissions));
    } finally {
      setPermLoading(false);
    }
  };

  const togglePerm = (key: string) => {
    setPermSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const savePermissions = async () => {
    if (!permUser) return;
    setPermSaving(true);
    try {
      await api.put(`/users/${permUser.id}/permissions`, { permissions: [...permSelected] });
      toast('Permissions updated');
      setPermUser(null);
      await load();
    } catch (e: any) {
      toast(e.message || 'Could not update permissions', 'error');
    } finally {
      setPermSaving(false);
    }
  };

  const doReset = async () => {
    if (!resetUser) return;
    setResetting(true);
    setTempPassword('');
    try {
      const res = await api.post<{ temporary_password: string }>(`/users/${resetUser.id}/reset-password`, {});
      setTempPassword(res.temporary_password);
      await load();
    } catch (e: any) {
      toast(e.message || 'Could not reset the password', 'error');
      setResetUser(null);
    } finally {
      setResetting(false);
    }
  };

  const doDeactivate = async () => {
    if (!deactivating) return;
    try {
      await api.del(`/users/${deactivating.id}`);
      toast('Account deactivated');
      setDeactivating(null);
      await load();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast('Copied'); }
    catch { toast('Copy failed — select the text manually', 'error'); }
  };

  const runBulk = async () => {
    const lines = bulkText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) { toast('Paste at least one employee row.', 'error'); return; }
    setBulkBusy(true);
    const results: { line: string; ok: boolean; message: string }[] = [];
    for (const line of lines) {
      const parts = line.split(',').map((p) => p.trim());
      const [full_name, email, role, department, job_title, password] = parts;
      const initial = password || `Fg-${Math.random().toString(36).slice(2, 10)}!9`;
      if (!full_name || !email) {
        results.push({ line, ok: false, message: 'Needs at least full name and email.' });
        continue;
      }
      try {
        await api.post('/users', {
          full_name, email,
          role: role || 'employee',
          department: department || '',
          job_title: job_title || '',
          password: initial,
          must_change_password: true,
        });
        results.push({ line: email, ok: true, message: `Created · temporary password: ${initial}` });
      } catch (e: any) {
        results.push({ line: email, ok: false, message: e.message || 'Failed' });
      }
    }
    setBulkResults(results);
    setBulkBusy(false);
    await load();
  };

  const filteredPerms = useMemo(() => {
    const q = permSearch.trim().toLowerCase();
    return permissions.filter((p) => !q || p.key.includes(q) || p.label.toLowerCase().includes(q) || p.category.toLowerCase().includes(q));
  }, [permissions, permSearch]);

  const permGroups = useMemo(() => {
    const map = new Map<string, PermissionDef[]>();
    for (const p of filteredPerms) {
      const list = map.get(p.category) || [];
      list.push(p);
      map.set(p.category, list);
    }
    return [...map.entries()];
  }, [filteredPerms]);

  if (loading) return <Spinner label="Loading employee accounts…" />;

  return (
    <div className="space-y-4">
      {error && <ErrorNote message={error} />}

      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-5">
        {[
          { label: 'Total accounts', value: counts.total, icon: Users },
          { label: 'Active', value: counts.active, icon: UserCheck },
          { label: 'Suspended', value: counts.suspended, icon: Ban },
          { label: 'Deactivated', value: counts.deactivated, icon: UserX },
          { label: 'Must change password', value: counts.mustChange, icon: AlertTriangle },
        ].map((k) => {
          const Icon = k.icon;
          return (
            <div key={k.label} className="panel flex items-center gap-3 px-3.5 py-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gold-soft text-gold-dark"><Icon size={15} /></span>
              <div>
                <p className="text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">{k.label}</p>
                <p className="text-lg font-bold tabular-nums text-neutral-900">{k.value}</p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search name, email, employee number…"
            className="field !py-1.5 !pl-8 text-xs"
          />
        </div>
        <Select value={roleFilter} onChange={(e) => { setRoleFilter(e.target.value); setPage(1); }} className="!w-auto !py-1.5 text-xs">
          <option value="">All roles</option>
          {roles.map((r) => <option key={r.name} value={r.name}>{r.label}</option>)}
        </Select>
        <Select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} className="!w-auto !py-1.5 text-xs">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
          <option value="deactivated">Deactivated</option>
        </Select>
        <Select value={deptFilter} onChange={(e) => { setDeptFilter(e.target.value); setPage(1); }} className="!w-auto !py-1.5 text-xs">
          <option value="">All departments</option>
          {departments.map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
          <option value="Unassigned">Unassigned</option>
        </Select>
        <button onClick={() => setMatrixOpen(true)} className="btn-ghost !py-1.5 text-xs"><Table2 size={13} /> Permission matrix</button>
        <button onClick={() => setBulkOpen(true)} className="btn-ghost !py-1.5 text-xs"><Upload size={13} /> Bulk register</button>
        <button onClick={openNew} className="btn-gold !py-1.5 text-xs"><Plus size={14} /> New employee account</button>
      </div>

      <div className="panel overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Department / title</th>
                <th>Role</th>
                <th>Status</th>
                <th>Last sign-in</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {current.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink text-[10px] font-bold text-gold">
                        {initials(u.full_name)}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-[12.5px] font-semibold text-neutral-800">{u.full_name}</p>
                        <p className="truncate text-[11px] text-neutral-500">{u.email}</p>
                        <p className="text-[10px] text-neutral-400">{u.employee_ref || 'No employee record'}</p>
                      </div>
                    </div>
                  </td>
                  <td>
                    <p className="text-[12px] font-medium text-neutral-700">{u.department || 'Unassigned'}</p>
                    <p className="text-[11px] text-neutral-500">{u.job_title || '—'}</p>
                  </td>
                  <td>
                    <span className="pill bg-neutral-100 text-neutral-600">{roleLabel(u.role)}</span>
                    {u.revoked_permissions.length > 0 && (
                      <p className="mt-1 text-[10px] text-amber-600">{u.revoked_permissions.length} revoked</p>
                    )}
                  </td>
                  <td>
                    <StatusPill value={u.status} />
                    {u.locked_until && new Date(u.locked_until).getTime() > Date.now() && (
                      <p className="mt-1 text-[10px] font-semibold text-red-600">Locked</p>
                    )}
                    {Boolean(u.must_change_password) && (
                      <p className="mt-1 text-[10px] text-amber-600">Temp password</p>
                    )}
                  </td>
                  <td className="text-[11px] text-neutral-500">
                    {u.last_login_at ? fmtWhen(u.last_login_at) : 'Never'}
                  </td>
                  <td>
                    <div className="flex flex-wrap justify-end gap-1">
                      <button onClick={() => openPermissions(u)} title="Permissions" className="btn-ghost !p-1.5"><ShieldCheck size={13} /></button>
                      <button onClick={() => { setResetUser(u); setTempPassword(''); }} title="Reset password" className="btn-ghost !p-1.5"><KeyRound size={13} /></button>
                      <button onClick={() => openEdit(u)} title="Edit" className="btn-ghost !p-1.5"><Pencil size={13} /></button>
                      {u.id !== me?.id && u.status === 'active' && (
                        <button onClick={() => setDeactivating(u)} title="Deactivate" className="btn-ghost !p-1.5 text-red-600"><UserX size={13} /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {current.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <EmptyState title="No accounts match" hint="Adjust the filters or create a new employee account." />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-[11px] text-neutral-500">
          <span>{filtered.length} account(s) · page {page} of {totalPages}</span>
          <div className="flex gap-1">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="btn-ghost !p-1.5 disabled:opacity-40"><ChevronLeft size={13} /></button>
            <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="btn-ghost !p-1.5 disabled:opacity-40"><ChevronRight size={13} /></button>
          </div>
        </div>
      </div>

      {/* create / edit */}
      <Modal open={formOpen} onClose={() => setFormOpen(false)} title={editing ? 'Edit employee account' : 'Register employee account'} width="max-w-2xl">
        <div className="space-y-3.5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Full name" required>
              <Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
            </Field>
            <Field label="Official email" required>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
            <Field label="Username" hint="Optional alternate sign-in name">
              <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
            </Field>
            <Field label="Phone number">
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </Field>
            <Field label="Employee number" hint={editing ? 'Linked employee record' : 'Blank generates FAR-EMP-####'}>
              <Input value={form.employee_ref} onChange={(e) => setForm({ ...form, employee_ref: e.target.value })} disabled={!!editing} />
            </Field>
            <Field label="Department">
              <Select value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })}>
                <option value="">Unassigned</option>
                {departments.map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
              </Select>
            </Field>
            <Field label="Job title">
              <Input value={form.job_title} onChange={(e) => setForm({ ...form, job_title: e.target.value })} />
            </Field>
            <Field label="Role" required>
              <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} disabled={editing?.id === me?.id}>
                {roles
                  .filter((r) => r.name !== 'super_admin' || me?.role === 'super_admin')
                  .map((r) => <option key={r.name} value={r.name}>{r.label}</option>)}
              </Select>
            </Field>
            {editing && (
              <Field label="Account status">
                <Select
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                  disabled={editing.id === me?.id}
                >
                  <option value="active">Active</option>
                  <option value="suspended">Suspended</option>
                  <option value="deactivated">Deactivated</option>
                </Select>
              </Field>
            )}
            <Field label={editing ? 'New password (optional)' : 'Initial password'} required={!editing}>
              <Input type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </Field>
            <Field label="Confirm password">
              <Input type="password" autoComplete="new-password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} />
            </Field>
          </div>

          <label className="flex items-center gap-2 text-xs text-neutral-600">
            <input type="checkbox" checked={form.must_change} onChange={(e) => setForm({ ...form, must_change: e.target.checked })} className="h-3.5 w-3.5 accent-[#c9a227]" />
            Require a password change at first sign-in (recommended)
          </label>

          {!editing && (
            <p className="rounded-lg bg-neutral-50 px-3 py-2 text-[11px] leading-relaxed text-neutral-500">
              The employee is registered with their own credentials. They only see the modules granted to their role and personal permissions.
            </p>
          )}

          <div className="flex justify-end gap-2 border-t border-line pt-3">
            <button onClick={() => setFormOpen(false)} className="btn-ghost !py-1.5 text-xs">Cancel</button>
            <button onClick={submitForm} disabled={saving} className="btn-gold !py-1.5 text-xs">
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Create account'}
            </button>
          </div>
        </div>
      </Modal>

      {/* permission matrix */}
      <Modal open={matrixOpen} onClose={() => setMatrixOpen(false)} title="Permission matrix — employees × modules" width="max-w-5xl">
        <div className="space-y-2.5">
          <p className="text-[11.5px] leading-relaxed text-neutral-500">
            Effective access after role defaults and personal grants/revocations. A tick means the module is reachable for that employee; the server still enforces the underlying permissions on every request.
          </p>
          <div className="max-h-[60vh] overflow-auto rounded-lg border border-line">
            <table className="w-full border-collapse text-[11px]">
              <thead className="sticky top-0 z-10 bg-neutral-50">
                <tr>
                  <th className="sticky left-0 z-20 min-w-40 bg-neutral-50 px-2.5 py-2 text-left font-semibold text-neutral-600">Employee</th>
                  {MATRIX_COLUMNS.map((c) => (
                    <th key={c.key} className="whitespace-nowrap px-1.5 py-2 text-center font-semibold text-neutral-500">{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => (
                  <tr key={u.id} className="border-t border-neutral-100">
                    <td className="sticky left-0 z-10 bg-white px-2.5 py-1.5">
                      <p className="truncate font-semibold text-neutral-800">{u.full_name}</p>
                      <p className="truncate text-[10px] text-neutral-400">{u.department || 'Unassigned'} · {roleLabel(u.role)}</p>
                    </td>
                    {MATRIX_COLUMNS.map((c) => {
                      const allowed = u.role === 'super_admin' || u.permissions.includes(c.key);
                      return (
                        <td key={c.key} className="px-1.5 py-1.5 text-center">
                          {allowed
                            ? <Check size={12} className="mx-auto text-emerald-600" />
                            : <Minus size={12} className="mx-auto text-neutral-200" />}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={MATRIX_COLUMNS.length + 1}><EmptyState title="No employees match the current filters" /></td></tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-[10.5px] text-neutral-400">Filters applied on the Users table also narrow this matrix.</p>
        </div>
      </Modal>

      {/* permissions */}
      <Modal open={!!permUser} onClose={() => setPermUser(null)} title={`Permissions — ${permUser?.full_name || ''}`} width="max-w-3xl">
        {permLoading ? <Spinner label="Loading permissions…" /> : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-40 flex-1">
                <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                <input value={permSearch} onChange={(e) => setPermSearch(e.target.value)} placeholder="Filter permissions…" className="field !py-1.5 !pl-8 text-xs" />
              </div>
              <span className="pill bg-gold-soft text-gold-dark">{permSelected.size} selected</span>
              <button onClick={() => setPermSelected(new Set(permRoleBase))} className="btn-ghost !py-1 text-[11px]">Reset to role default</button>
            </div>
            <p className="text-[11px] text-neutral-500">
              Role default grants {permRoleBase.size} permissions. Ticks outside the default are personal grants; unticking a default revokes it for this employee only.
            </p>
            <div className="max-h-[52vh] space-y-3 overflow-y-auto pr-1">
              {permGroups.map(([category, list]) => (
                <div key={category} className="rounded-lg border border-line">
                  <p className="border-b border-line bg-neutral-50 px-3 py-1.5 text-[10.5px] font-bold uppercase tracking-wide text-neutral-500">{category}</p>
                  <div className="grid gap-1 px-3 py-2 sm:grid-cols-2">
                    {list.map((p) => {
                      const checked = permSelected.has(p.key);
                      const isExtra = checked && !permRoleBase.has(p.key);
                      return (
                        <label key={p.key} className="flex items-start gap-2 rounded px-1 py-1 text-[11.5px] hover:bg-neutral-50">
                          <input type="checkbox" checked={checked} onChange={() => togglePerm(p.key)} className="mt-0.5 h-3.5 w-3.5 accent-[#c9a227]" />
                          <span className="min-w-0">
                            <span className="block font-medium text-neutral-700">{p.label}</span>
                            <span className="block font-mono text-[10px] text-neutral-400">{p.key}{isExtra ? ' · granted' : ''}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2 border-t border-line pt-3">
              <button onClick={() => setPermUser(null)} className="btn-ghost !py-1.5 text-xs">Cancel</button>
              <button onClick={savePermissions} disabled={permSaving} className="btn-gold !py-1.5 text-xs">
                {permSaving ? 'Saving…' : 'Save permissions'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* reset password */}
      <Modal open={!!resetUser} onClose={() => setResetUser(null)} title="Reset password" width="max-w-md">
        <div className="space-y-3">
          {!tempPassword ? (
            <>
              <p className="text-sm text-neutral-600">
                Generate a temporary password for <strong>{resetUser?.email}</strong>. Their existing sessions will be signed out and they must change it at next sign-in.
              </p>
              <div className="flex justify-end gap-2 border-t border-line pt-3">
                <button onClick={() => setResetUser(null)} className="btn-ghost !py-1.5 text-xs">Cancel</button>
                <button onClick={doReset} disabled={resetting} className="btn-gold !py-1.5 text-xs">
                  {resetting ? <Loader2 size={13} className="animate-spin" /> : <KeyRound size={13} />} Generate password
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-neutral-600">Share this temporary password securely. It is shown only once.</p>
              <div className="flex items-center gap-2 rounded-lg border border-gold/40 bg-gold-soft/40 px-3 py-2.5">
                <code className="flex-1 text-sm font-bold text-gold-dark">{tempPassword}</code>
                <button onClick={() => copy(tempPassword)} className="btn-ghost !p-1.5"><Copy size={13} /></button>
              </div>
              <div className="flex justify-end">
                <button onClick={() => setResetUser(null)} className="btn-gold !py-1.5 text-xs">Done</button>
              </div>
            </>
          )}
        </div>
      </Modal>

      {/* bulk registration */}
      <Modal open={bulkOpen} onClose={() => setBulkOpen(false)} title="Bulk employee registration" width="max-w-2xl">
        <div className="space-y-3">
          <p className="text-[11.5px] leading-relaxed text-neutral-500">
            One employee per line. Order: <code>full name, email, role, department, job title, password</code>.
            Role, department, job title and password are optional — a secure temporary password is generated when omitted.
            Every account must change its password at first sign-in.
          </p>
          <textarea
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            rows={6}
            placeholder={'Thandi Nkosi, thandi@faranani.co.za, receptionist, Reception, Front Desk\nSipho Dlamini, sipho@faranani.co.za, cleaner, Housekeeping, Cleaner'}
            className="field !min-h-32 font-mono !text-[11.5px]"
          />
          {bulkResults.length > 0 && (
            <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-line p-2">
              {bulkResults.map((r, i) => (
                <p key={i} className={`text-[11px] ${r.ok ? 'text-emerald-700' : 'text-red-600'}`}>
                  {r.ok ? '✓' : '✗'} <span className="font-mono">{r.line}</span> — {r.message}
                </p>
              ))}
            </div>
          )}
          <div className="flex justify-end gap-2 border-t border-line pt-3">
            <button onClick={() => setBulkOpen(false)} className="btn-ghost !py-1.5 text-xs">Close</button>
            <button onClick={runBulk} disabled={bulkBusy} className="btn-gold !py-1.5 text-xs">
              {bulkBusy ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
              {bulkBusy ? 'Registering…' : 'Register employees'}
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deactivating}
        onClose={() => setDeactivating(null)}
        onConfirm={doDeactivate}
        title="Deactivate account"
        message={`Deactivate ${deactivating?.email || ''}? They will be signed out immediately and cannot sign in again until reactivated.`}
        confirmLabel="Deactivate"
      />
    </div>
  );
}
