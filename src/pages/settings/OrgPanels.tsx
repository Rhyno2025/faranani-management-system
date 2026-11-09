import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Save, Building2, Plus, Pencil, Trash2, ShieldCheck, Search, Database,
  Download, Info, CheckCircle2, Loader2,
} from 'lucide-react';
import { api, downloadFile } from '../../lib/api';
import {
  Spinner, ErrorNote, Modal, Field, Input, Select, Textarea, ConfirmDialog,
  toast, EmptyState,
} from '../../components/ui';
import { roleLabel } from '../../lib/access';
import type { DepartmentRow, PermissionDef, RoleDef } from './types';

// ------------------------------- General ----------------------------------

interface CompanySettings {
  name: string; tagline: string; email: string; phone: string;
  address: string; city: string; province: string; timezone: string; currency: string;
}

interface NotificationSettings {
  new_application: boolean; new_complaint: boolean; urgent_complaint: boolean;
  payment_recorded: boolean; overdue_tasks: boolean; cleaning_overdue: boolean; email_enabled: boolean;
}

interface PortalSettings { application_enabled: boolean; complaint_enabled: boolean }

const COMPANY_FIELDS: { key: keyof CompanySettings; label: string; type?: string }[] = [
  { key: 'name', label: 'Company name' },
  { key: 'tagline', label: 'Tagline' },
  { key: 'email', label: 'Contact email', type: 'email' },
  { key: 'phone', label: 'Contact phone' },
  { key: 'address', label: 'Street address' },
  { key: 'city', label: 'City' },
  { key: 'province', label: 'Province' },
  { key: 'timezone', label: 'Timezone' },
  { key: 'currency', label: 'Currency' },
];

const NOTIFICATION_FIELDS: { key: keyof NotificationSettings; label: string }[] = [
  { key: 'new_application', label: 'New student application' },
  { key: 'new_complaint', label: 'New complaint logged' },
  { key: 'urgent_complaint', label: 'Urgent complaint escalation' },
  { key: 'payment_recorded', label: 'Payment recorded' },
  { key: 'overdue_tasks', label: 'Overdue tasks' },
  { key: 'cleaning_overdue', label: 'Overdue cleaning tasks' },
  { key: 'email_enabled', label: 'Send notifications by email (requires email API)' },
];

export function GeneralPanel() {
  const [company, setCompany] = useState<CompanySettings | null>(null);
  const [notifications, setNotifications] = useState<NotificationSettings | null>(null);
  const [portal, setPortal] = useState<PortalSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [demoMode, setDemoMode] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get<{ settings: any; demo_mode: boolean }>('/settings');
      setCompany(res.settings.company || {});
      setNotifications(res.settings.notifications || {});
      setPortal(res.settings.portal || {});
      setDemoMode(Boolean(res.demo_mode));
    } catch (e: any) {
      setError(e.message || 'Could not load general settings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!company) return;
    if (!company.name.trim()) { toast('Company name is required.', 'error'); return; }
    setSaving(true);
    try {
      await api.post('/settings', { company, notifications, portal });
      toast('General settings saved');
    } catch (e: any) {
      toast(e.message || 'Could not save settings', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Spinner label="Loading company settings…" />;
  if (error) return <ErrorNote message={error} />;

  return (
    <div className="space-y-4">
      <div className="panel px-5 py-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold text-neutral-800">Company profile</h3>
          <span className={`pill ${demoMode ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-700'}`}>
            {demoMode ? 'demo mode' : 'live data'}
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {COMPANY_FIELDS.map((f) => (
            <Field key={f.key} label={f.label}>
              <Input
                type={f.type || 'text'}
                value={company?.[f.key] || ''}
                onChange={(e) => setCompany({ ...(company as CompanySettings), [f.key]: e.target.value })}
              />
            </Field>
          ))}
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="panel px-5 py-4">
          <h3 className="mb-3 text-sm font-bold text-neutral-800">Notifications</h3>
          <div className="space-y-2">
            {NOTIFICATION_FIELDS.map((f) => (
              <label key={f.key} className="flex items-center gap-2 text-[12px] text-neutral-700">
                <input
                  type="checkbox"
                  checked={Boolean(notifications?.[f.key])}
                  onChange={(e) => setNotifications({ ...(notifications as NotificationSettings), [f.key]: e.target.checked })}
                  className="h-3.5 w-3.5 accent-[#c9a227]"
                />
                {f.label}
              </label>
            ))}
          </div>
        </div>

        <div className="panel px-5 py-4">
          <h3 className="mb-3 text-sm font-bold text-neutral-800">Student portal</h3>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-[12px] text-neutral-700">
              <input
                type="checkbox"
                checked={Boolean(portal?.application_enabled)}
                onChange={(e) => setPortal({ ...(portal as PortalSettings), application_enabled: e.target.checked })}
                className="h-3.5 w-3.5 accent-[#c9a227]"
              />
              Accept online applications
            </label>
            <label className="flex items-center gap-2 text-[12px] text-neutral-700">
              <input
                type="checkbox"
                checked={Boolean(portal?.complaint_enabled)}
                onChange={(e) => setPortal({ ...(portal as PortalSettings), complaint_enabled: e.target.checked })}
                className="h-3.5 w-3.5 accent-[#c9a227]"
              />
              Accept online complaints
            </label>
          </div>
          <p className="mt-3 rounded-lg bg-neutral-50 px-3 py-2 text-[11px] leading-relaxed text-neutral-500">
            Portal toggles control the public student-facing forms. They do not grant staff access.
          </p>
        </div>
      </div>

      <div className="flex justify-end">
        <button onClick={save} disabled={saving} className="btn-gold !py-2 text-xs">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          {saving ? 'Saving…' : 'Save general settings'}
        </button>
      </div>
    </div>
  );
}

// ----------------------------- Departments ---------------------------------

const ROUTE_OPTIONS = [
  { value: '/', label: 'Executive overview' },
  { value: '/dashboard', label: 'Departmental dashboard' },
  { value: '/students', label: 'Students' },
  { value: '/applications', label: 'Admissions' },
  { value: '/properties', label: 'Properties' },
  { value: '/rooms', label: 'Rooms & beds' },
  { value: '/complaints', label: 'Complaints' },
  { value: '/maintenance', label: 'Maintenance' },
  { value: '/cleaning', label: 'Cleaning & housekeeping' },
  { value: '/finance', label: 'Finance' },
  { value: '/hr', label: 'Human resources' },
  { value: '/reports', label: 'Reports' },
];

interface DeptForm { name: string; code: string; dashboard_route: string; description: string }
const EMPTY_DEPT: DeptForm = { name: '', code: '', dashboard_route: '/dashboard', description: '' };

export function DepartmentsPanel() {
  const [rows, setRows] = useState<DepartmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DepartmentRow | null>(null);
  const [form, setForm] = useState<DeptForm>(EMPTY_DEPT);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<DepartmentRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get<{ data: DepartmentRow[] }>('/settings/departments');
      setRows(res.data);
    } catch (e: any) {
      setError(e.message || 'Could not load departments.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openNew = () => { setEditing(null); setForm(EMPTY_DEPT); setOpen(true); };
  const openEdit = (d: DepartmentRow) => {
    setEditing(d);
    setForm({
      name: d.name, code: d.code || '',
      dashboard_route: d.dashboard_route || '/dashboard',
      description: d.description || '',
    });
    setOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) { toast('Department name is required.', 'error'); return; }
    setSaving(true);
    try {
      if (editing) {
        await api.patch(`/settings/departments/${editing.id}`, form);
        toast('Department updated');
      } else {
        await api.post('/settings/departments', form);
        toast('Department created');
      }
      setOpen(false);
      await load();
    } catch (e: any) {
      toast(e.message || 'Could not save department', 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    try {
      await api.del(`/settings/departments/${deleting.id}`);
      toast('Department removed');
      setDeleting(null);
      await load();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  if (loading) return <Spinner label="Loading departments…" />;
  if (error) return <ErrorNote message={error} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-neutral-500">
          Departments determine each employee's landing dashboard. Renaming a department moves its employees with it.
        </p>
        <button onClick={openNew} className="btn-gold !py-1.5 text-xs"><Plus size={14} /> Add department</button>
      </div>

      <div className="panel overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr><th>Department</th><th>Code</th><th>Landing dashboard</th><th>Employees</th><th>Accounts</th><th className="text-right">Actions</th></tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id}>
                  <td>
                    <p className="text-[12.5px] font-semibold text-neutral-800">{d.name}</p>
                    {d.description && <p className="text-[10.5px] text-neutral-400">{d.description}</p>}
                  </td>
                  <td><span className="pill bg-neutral-100 text-neutral-600">{d.code || '—'}</span></td>
                  <td className="font-mono text-[11px] text-neutral-600">{d.dashboard_route || '/dashboard'}</td>
                  <td className="tabular-nums text-[12px]">{d.staff_count}</td>
                  <td className="tabular-nums text-[12px]">{d.user_count}</td>
                  <td>
                    <div className="flex justify-end gap-1">
                      <button onClick={() => openEdit(d)} className="btn-ghost !p-1.5"><Pencil size={13} /></button>
                      <button onClick={() => setDeleting(d)} className="btn-ghost !p-1.5 text-red-600"><Trash2 size={13} /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={6}><EmptyState title="No departments yet" /></td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'Edit department' : 'Add department'} width="max-w-lg">
        <div className="space-y-3.5">
          <Field label="Department name" required>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Short code" hint="e.g. HR, FIN, HK">
            <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} />
          </Field>
          <Field label="Landing dashboard">
            <Select value={form.dashboard_route} onChange={(e) => setForm({ ...form, dashboard_route: e.target.value })}>
              {ROUTE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </Select>
          </Field>
          <Field label="Description">
            <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="!min-h-16" />
          </Field>
          <div className="flex justify-end gap-2 border-t border-line pt-3">
            <button onClick={() => setOpen(false)} className="btn-ghost !py-1.5 text-xs">Cancel</button>
            <button onClick={save} disabled={saving} className="btn-gold !py-1.5 text-xs">{saving ? 'Saving…' : 'Save department'}</button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
        title="Delete department"
        message={`Delete ${deleting?.name || ''}? This is refused while employees still belong to it.`}
        confirmLabel="Delete"
      />
    </div>
  );
}

// -------------------------- Roles & permissions -----------------------------

export function RolesPanel() {
  const [roles, setRoles] = useState<RoleDef[]>([]);
  const [permissions, setPermissions] = useState<PermissionDef[]>([]);
  const [current, setCurrent] = useState<Record<string, string[]>>({});
  const [role, setRole] = useState('hr_officer');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get<{ roles: RoleDef[]; permissions: PermissionDef[]; current: Record<string, string[]> }>('/roles');
      setRoles(res.roles);
      setPermissions(res.permissions);
      setCurrent(res.current);
    } catch (e: any) {
      setError(e.message || 'Could not load roles.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!current[role]) return;
    setSelected(new Set(current[role]));
  }, [role, current]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return permissions.filter((p) => !q || p.key.includes(q) || p.label.toLowerCase().includes(q) || p.category.toLowerCase().includes(q));
  }, [permissions, search]);

  const groups = useMemo(() => {
    const map = new Map<string, PermissionDef[]>();
    for (const p of filtered) {
      const list = map.get(p.category) || [];
      list.push(p);
      map.set(p.category, list);
    }
    return [...map.entries()];
  }, [filtered]);

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const save = async () => {
    if (role === 'super_admin') { toast('The Super Administrator role cannot be restricted.', 'error'); return; }
    setSaving(true);
    try {
      await api.put(`/roles/${role}/permissions`, { permissions: [...selected] });
      toast(`Default permissions saved for ${roleLabel(role)}`);
      await load();
    } catch (e: any) {
      toast(e.message || 'Could not save role permissions', 'error');
    } finally {
      setSaving(false);
    }
  };

  const resetToDefaults = () => {
    if (!current[role]) return;
    setSelected(new Set(current[role]));
    toast('Restored the saved grants for this role', 'info');
  };

  if (loading) return <Spinner label="Loading roles…" />;
  if (error) return <ErrorNote message={error} />;

  return (
    <div className="space-y-4">
      <div className="panel px-4 py-3">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Role">
            <Select value={role} onChange={(e) => setRole(e.target.value)} className="!w-64">
              {roles.map((r) => <option key={r.name} value={r.name}>{r.label}</option>)}
            </Select>
          </Field>
          <div className="relative min-w-44 flex-1">
            <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter permissions…" className="field !py-1.5 !pl-8 text-xs" />
          </div>
          <span className="pill bg-gold-soft text-gold-dark">{selected.size} granted</span>
          <button onClick={resetToDefaults} className="btn-ghost !py-1.5 text-xs">Discard changes</button>
          <button onClick={save} disabled={saving || role === 'super_admin'} className="btn-gold !py-1.5 text-xs">
            {saving ? 'Saving…' : 'Save role permissions'}
          </button>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-neutral-500">
          {role === 'super_admin'
            ? 'The Super Administrator always has unrestricted access and cannot be limited.'
            : `These are the default grants for every employee with the ${roleLabel(role)} role. Personal overrides on an individual account take precedence.`}
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {groups.map(([category, list]) => (
          <div key={category} className="panel overflow-hidden">
            <p className="border-b border-line bg-neutral-50 px-3.5 py-2 text-[10.5px] font-bold uppercase tracking-wide text-neutral-500">{category}</p>
            <div className="space-y-1 px-3.5 py-2.5">
              {list.map((p) => {
                const checked = selected.has(p.key) || role === 'super_admin';
                const saved = current[role]?.includes(p.key);
                return (
                  <label key={p.key} className="flex items-start gap-2 rounded px-1 py-1 text-[12px] hover:bg-neutral-50">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={role === 'super_admin'}
                      onChange={() => toggle(p.key)}
                      className="mt-0.5 h-3.5 w-3.5 accent-[#c9a227]"
                    />
                    <span className="min-w-0">
                      <span className="block font-medium text-neutral-700">{p.label}</span>
                      <span className="block font-mono text-[10px] text-neutral-400">
                        {p.key}{saved !== checked ? ' · unsaved change' : ''}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ------------------------------- System ------------------------------------

export function SystemPanel() {
  const [settings, setSettings] = useState<any>(null);
  const [health, setHealth] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [backingUp, setBackingUp] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [s, h] = await Promise.all([
        api.get('/settings'),
        api.get('/health'),
      ]);
      setSettings(s);
      setHealth(h);
    } catch (e: any) {
      setError(e.message || 'Could not load system information.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const downloadBackup = async () => {
    setBackingUp(true);
    try {
      await downloadFile('/settings/backup', 'faranani-backup.db');
      toast('Backup downloaded');
    } catch (e: any) {
      toast(e.message || 'Backup failed', 'error');
    } finally {
      setBackingUp(false);
    }
  };

  if (loading) return <Spinner label="Loading system information…" />;
  if (error) return <ErrorNote message={error} />;

  const company = settings?.settings?.company || {};
  const retention = settings?.settings?.retention || {};

  return (
    <div className="space-y-4">
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="panel px-5 py-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-neutral-800"><Info size={15} className="text-gold" /> System information</h3>
          <dl className="space-y-2 text-[12px]">
            {[
              ['Application', 'Faranani Property Group Management System'],
              ['Version', '1.0.0'],
              ['Environment', import.meta.env.PROD ? 'production' : 'development'],
              ['Database engine', 'SQLite (node:sqlite)'],
              ['Timezone', company.timezone || 'Africa/Johannesburg'],
              ['Currency', company.currency || 'ZAR'],
              ['Data mode', settings?.demo_mode ? 'demo' : 'live'],
              ['API status', health?.ok ? 'healthy' : 'unreachable'],
              ['Server time', health?.time || '—'],
            ].map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-3 border-b border-neutral-100 pb-1.5 last:border-0">
                <dt className="text-neutral-500">{k}</dt>
                <dd className="text-right font-medium text-neutral-800">{v}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="panel px-5 py-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-neutral-800"><Database size={15} className="text-gold" /> Record counts & retention</h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {Object.entries(settings?.counts || {}).map(([k, v]) => (
              <div key={k} className="rounded-lg border border-line bg-neutral-50/60 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">{k.replace(/_/g, ' ')}</p>
                <p className="text-sm font-bold tabular-nums text-neutral-800">{String(v)}</p>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <span className="pill bg-neutral-100 text-neutral-600">Audit retention {retention.audit_keep_years || 5} years</span>
            <span className="pill bg-neutral-100 text-neutral-600">Student archive {retention.archive_students_after_months || 84} months</span>
          </div>
          <button onClick={downloadBackup} disabled={backingUp} className="btn-ghost mt-3 w-full !py-2 text-xs">
            {backingUp ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
            {backingUp ? 'Preparing backup…' : 'Download database backup'}
          </button>
          <p className="mt-2 text-[10.5px] leading-relaxed text-neutral-400">
            The backup is a consistent snapshot created with VACUUM INTO. Store it securely — it contains company records.
          </p>
        </div>
      </div>

      <div className="panel px-5 py-4">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-neutral-800"><CheckCircle2 size={15} className="text-gold" /> Security posture</h3>
        <div className="flex flex-wrap gap-1.5">
          <span className="pill bg-emerald-100 text-emerald-700">Scrypt password hashing</span>
          <span className="pill bg-emerald-100 text-emerald-700">HttpOnly session cookies</span>
          <span className="pill bg-emerald-100 text-emerald-700">Server-enforced permissions</span>
          <span className="pill bg-emerald-100 text-emerald-700">Lockout after repeated failures</span>
          <span className="pill bg-emerald-100 text-emerald-700">Encrypted API credentials</span>
          <span className="pill bg-neutral-100 text-neutral-600">Multi-factor: {settings?.settings?.security?.mfa_available ? 'available' : 'not enabled'}</span>
        </div>
        <p className="mt-2 text-[10.5px] leading-relaxed text-neutral-500">
          API keys are encrypted with AES-256-GCM before storage and are never returned to the browser. Access is enforced in the API layer, not only by hiding menu items.
        </p>
      </div>
    </div>
  );
}
