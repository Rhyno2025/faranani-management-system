import { useCallback, useEffect, useState } from 'react';
import {
  Plus, RefreshCw, Trash2, Pencil, PlugZap, Star, ShieldCheck, AlertTriangle, Loader2, KeyRound,
} from 'lucide-react';
import { api } from '../../lib/api';
import {
  Spinner, EmptyState, ErrorNote, Modal, Field, Input, Select, Textarea,
  ConfirmDialog, toast,
} from '../../components/ui';
import { fmtWhen } from '../../lib/format';
import type { ApiConfig, ProviderDef } from './types';

interface FormState {
  provider: string;
  name: string;
  base_url: string;
  api_key: string;
  model: string;
  api_version: string;
  org_id: string;
  extra_headers: string;
  max_tokens: string;
  temperature: string;
  timeout_ms: string;
  enabled: boolean;
  is_primary: boolean;
  is_backup: boolean;
}

const EMPTY: FormState = {
  provider: 'openai', name: '', base_url: 'https://api.openai.com/v1', api_key: '',
  model: 'gpt-4o-mini', api_version: '', org_id: '', extra_headers: '',
  max_tokens: '', temperature: '', timeout_ms: '45000',
  enabled: true, is_primary: true, is_backup: false,
};

const KIND_PROVIDERS: Record<string, ProviderDef[]> = {
  email: [
    { key: 'resend', label: 'Resend', base_url: 'https://api.resend.com', model: '' },
    { key: 'sendgrid', label: 'SendGrid', base_url: 'https://api.sendgrid.com', model: '' },
    { key: 'mailgun', label: 'Mailgun', base_url: 'https://api.mailgun.net', model: '' },
    { key: 'smtp-relay', label: 'SMTP relay (HTTP bridge)', base_url: '', model: '' },
    { key: 'custom', label: 'Custom email API', base_url: '', model: '' },
  ],
  other: [
    { key: 'custom', label: 'Custom service', base_url: '', model: '' },
    { key: 'storage', label: 'Object storage API', base_url: '', model: '' },
    { key: 'sms', label: 'SMS gateway', base_url: '', model: '' },
  ],
};

export function ConfigManager({ kind, description }: { kind: 'ai' | 'email' | 'other'; description: string }) {
  const [configs, setConfigs] = useState<ApiConfig[]>([]);
  const [providers, setProviders] = useState<ProviderDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<ApiConfig | 'new' | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; status: string; message: string; elapsed_ms?: number } | null>(null);
  const [deleting, setDeleting] = useState<ApiConfig | null>(null);
  const [clearKey, setClearKey] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get<{ data: ApiConfig[]; providers: ProviderDef[] }>(`/settings/api-configs?kind=${kind}`);
      setConfigs(res.data);
      setProviders(res.providers || []);
    } catch (e: any) {
      setError(e.message || 'Could not load configurations.');
    } finally {
      setLoading(false);
    }
  }, [kind]);

  useEffect(() => { load(); }, [load]);

  const openNew = () => {
    const list = kind === 'ai' ? providers : KIND_PROVIDERS[kind] || KIND_PROVIDERS.other;
    const first = list[0] || { key: 'custom', base_url: '', model: '' };
    setForm({
      ...EMPTY,
      provider: first.key,
      base_url: first.base_url || '',
      model: first.model || '',
      name: '',
      is_primary: configs.length === 0,
    });
    setClearKey(false);
    setTestResult(null);
    setEditing('new');
  };

  const openEdit = (cfg: ApiConfig) => {
    setForm({
      provider: cfg.provider,
      name: cfg.name,
      base_url: cfg.base_url,
      api_key: '',
      model: cfg.model,
      api_version: cfg.api_version,
      org_id: cfg.org_id,
      extra_headers: cfg.extra_headers,
      max_tokens: cfg.max_tokens === null ? '' : String(cfg.max_tokens),
      temperature: cfg.temperature === null ? '' : String(cfg.temperature),
      timeout_ms: String(cfg.timeout_ms || 45000),
      enabled: cfg.enabled,
      is_primary: cfg.is_primary,
      is_backup: cfg.is_backup,
    });
    setClearKey(false);
    setTestResult(null);
    setEditing(cfg);
  };

  const providerOptions = kind === 'ai'
    ? providers
    : KIND_PROVIDERS[kind] || KIND_PROVIDERS.other;

  const applyProvider = (key: string) => {
    const preset = providerOptions.find((p) => p.key === key);
    setForm((f) => ({
      ...f,
      provider: key,
      base_url: preset?.base_url || f.base_url,
      model: preset?.model || f.model,
    }));
  };

  const payload = () => ({
    kind,
    provider: form.provider,
    name: form.name.trim(),
    base_url: form.base_url.trim(),
    api_key: form.api_key,
    model: form.model,
    api_version: form.api_version,
    org_id: form.org_id,
    extra_headers: form.extra_headers,
    max_tokens: form.max_tokens === '' ? null : Number(form.max_tokens),
    temperature: form.temperature === '' ? null : Number(form.temperature),
    timeout_ms: Number(form.timeout_ms) || 45000,
    enabled: form.enabled,
    is_primary: kind === 'ai' ? form.is_primary : false,
    is_backup: kind === 'ai' ? form.is_backup : false,
    clear_key: clearKey,
  });

  const validate = (): string | null => {
    if (!form.name.trim()) return 'Give this configuration a clear name.';
    if (!/^https?:\/\//i.test(form.base_url.trim())) return 'Base URL must start with http:// or https://.';
    if (editing === 'new' && !form.api_key.trim()) return 'An API key is required for a new configuration.';
    return null;
  };

  const testDraft = async () => {
    const problem = validate();
    if (problem) { toast(problem, 'error'); return; }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api.post<{ ok: boolean; status: string; message: string; elapsed_ms?: number }>(
        '/settings/api-configs/test',
        { ...payload(), api_key: form.api_key || (editing !== 'new' && editing ? undefined : '') }
      );
      setTestResult(res);
    } catch (e: any) {
      setTestResult({ ok: false, status: 'error', message: e.message || 'Test failed.' });
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    const problem = validate();
    if (problem) { toast(problem, 'error'); return; }
    setSaving(true);
    try {
      if (editing === 'new') {
        await api.post('/settings/api-configs', payload());
        toast('Configuration added');
      } else if (editing) {
        const body: Record<string, unknown> = payload();
        if (!form.api_key) delete body.api_key;
        await api.patch(`/settings/api-configs/${editing.id}`, body);
        toast('Configuration updated');
      }
      setEditing(null);
      await load();
    } catch (e: any) {
      toast(e.message || 'Could not save configuration', 'error');
    } finally {
      setSaving(false);
    }
  };

  const testSaved = async (cfg: ApiConfig) => {
    setTesting(true);
    try {
      const res = await api.post<{ ok: boolean; status: string; message: string }>(`/settings/api-configs/${cfg.id}/test`, {});
      toast(res.ok ? res.message : `Test failed: ${res.message}`, res.ok ? 'success' : 'error');
      await load();
    } catch (e: any) {
      toast(e.message || 'Test failed', 'error');
    } finally {
      setTesting(false);
    }
  };

  const toggleField = async (cfg: ApiConfig, field: 'enabled' | 'is_primary') => {
    try {
      await api.patch(`/settings/api-configs/${cfg.id}`, { [field]: !cfg[field] });
      await load();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await api.del(`/settings/api-configs/${deleting.id}`);
      toast('Configuration removed');
      setDeleting(null);
      await load();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  if (loading) return <Spinner label="Loading configurations…" />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-xs leading-relaxed text-neutral-500">{description}</p>
        <button onClick={openNew} className="btn-gold !py-1.5 text-xs">
          <Plus size={14} /> Add configuration
        </button>
      </div>

      {error && <ErrorNote message={error} />}

      {configs.length === 0 && !error && (
        <div className="panel">
          <EmptyState
            icon={<KeyRound size={20} />}
            title="No configuration yet"
            hint="Add the provider URL and API key here. Keys are encrypted on the server and never returned to the browser."
            action={<button onClick={openNew} className="btn-gold">Add configuration</button>}
          />
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        {configs.map((cfg) => {
          const lastTone = cfg.last_test_status === 'connected' ? 'text-emerald-600'
            : cfg.last_test_status ? 'text-red-600' : 'text-neutral-400';
          return (
            <div key={cfg.id} className="panel px-4 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <h4 className="truncate text-sm font-bold text-neutral-800">{cfg.name}</h4>
                    {cfg.is_primary && <span className="pill bg-gold-soft text-gold-dark"><Star size={10} /> Primary</span>}
                    {cfg.is_backup && <span className="pill bg-sky-100 text-sky-700">Backup</span>}
                    <span className={`pill ${cfg.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-neutral-200 text-neutral-600'}`}>
                      {cfg.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-[11.5px] text-neutral-500">
                    {cfg.provider_label} · {cfg.model || 'no model'} · {cfg.base_url}
                  </p>
                  <p className="mt-0.5 text-[11px] text-neutral-400">
                    Key {cfg.has_key ? `stored ${cfg.key_hint}` : 'not set'} · timeout {cfg.timeout_ms} ms
                  </p>
                </div>
                <button onClick={() => openEdit(cfg)} className="btn-ghost !p-1.5" title="Edit">
                  <Pencil size={13} />
                </button>
              </div>

              <div className={`mt-2 flex items-center gap-1.5 text-[11px] ${lastTone}`}>
                {cfg.last_test_status === 'connected'
                  ? <ShieldCheck size={12} />
                  : cfg.last_test_status ? <AlertTriangle size={12} /> : <PlugZap size={12} />}
                <span className="flex-1">
                  {cfg.last_test_status
                    ? `${cfg.last_test_status.replace(/_/g, ' ')} — ${fmtWhen(cfg.last_test_at)}`
                    : 'Connection has not been tested yet'}
                </span>
              </div>
              {cfg.last_test_message && (
                <p className="mt-1 line-clamp-2 text-[11px] text-neutral-500">{cfg.last_test_message}</p>
              )}

              <div className="mt-3 flex flex-wrap gap-1.5 border-t border-line pt-2.5">
                <button onClick={() => testSaved(cfg)} disabled={testing} className="btn-ghost !py-1 text-[11px]">
                  {testing ? <Loader2 size={12} className="animate-spin" /> : <PlugZap size={12} />} Test
                </button>
                {kind === 'ai' && (
                  <button onClick={() => toggleField(cfg, 'is_primary')} className="btn-ghost !py-1 text-[11px]">
                    <Star size={12} /> {cfg.is_primary ? 'Primary' : 'Set primary'}
                  </button>
                )}
                <button onClick={() => toggleField(cfg, 'enabled')} className="btn-ghost !py-1 text-[11px]">
                  <RefreshCw size={12} /> {cfg.enabled ? 'Disable' : 'Enable'}
                </button>
                <button onClick={() => setDeleting(cfg)} className="!py-1 text-[11px] font-semibold text-red-600 hover:underline">
                  <Trash2 size={12} className="inline" /> Remove
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'Add configuration' : 'Edit configuration'}
        width="max-w-2xl"
      >
        <div className="space-y-3.5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Provider" required>
              <Select value={form.provider} onChange={(e) => applyProvider(e.target.value)}>
                {providerOptions.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                {!providerOptions.some((p) => p.key === form.provider) && (
                  <option value={form.provider}>{form.provider}</option>
                )}
              </Select>
            </Field>
            <Field label="Display name" required hint="e.g. Primary OpenAI account">
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Base URL" required hint="Full API root, e.g. https://generativelanguage.googleapis.com/v1beta">
              <Input value={form.base_url} onChange={(e) => setForm({ ...form, base_url: e.target.value })} />
            </Field>
            <Field label={editing === 'new' ? 'API key' : 'API key (leave blank to keep)'} required={editing === 'new'}>
              <Input
                type="password"
                autoComplete="new-password"
                value={form.api_key}
                onChange={(e) => setForm({ ...form, api_key: e.target.value })}
                placeholder={editing !== 'new' && editing ? (editing.key_hint || 'Stored key') : 'Paste the key'}
              />
            </Field>
            {kind === 'ai' && (
              <>
                <Field label="Model">
                  <Input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
                </Field>
                <Field label="API version" hint="Anthropic uses 2023-06-01; Gemini usually empty">
                  <Input value={form.api_version} onChange={(e) => setForm({ ...form, api_version: e.target.value })} />
                </Field>
                <Field label="Organisation ID" hint="Optional — OpenAI organisation header">
                  <Input value={form.org_id} onChange={(e) => setForm({ ...form, org_id: e.target.value })} />
                </Field>
                <Field label="Max output tokens">
                  <Input value={form.max_tokens} onChange={(e) => setForm({ ...form, max_tokens: e.target.value })} inputMode="numeric" />
                </Field>
                <Field label="Temperature" hint="0 = deterministic, 1 = creative">
                  <Input value={form.temperature} onChange={(e) => setForm({ ...form, temperature: e.target.value })} />
                </Field>
              </>
            )}
            <Field label="Request timeout (ms)">
              <Input value={form.timeout_ms} onChange={(e) => setForm({ ...form, timeout_ms: e.target.value })} inputMode="numeric" />
            </Field>
          </div>

          <Field label="Additional headers" hint='Optional JSON, e.g. {"X-Custom":"value"}'>
            <Textarea
              value={form.extra_headers}
              onChange={(e) => setForm({ ...form, extra_headers: e.target.value })}
              placeholder='{"X-Custom":"value"}'
              className="!min-h-16 font-mono !text-xs"
            />
          </Field>

          <div className="flex flex-wrap items-center gap-4 text-xs text-neutral-600">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} className="h-3.5 w-3.5 accent-[#c9a227]" />
              Enabled
            </label>
            {kind === 'ai' && (
              <>
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={form.is_primary} onChange={(e) => setForm({ ...form, is_primary: e.target.checked, is_backup: e.target.checked ? false : form.is_backup })} className="h-3.5 w-3.5 accent-[#c9a227]" />
                  Primary provider
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={form.is_backup} onChange={(e) => setForm({ ...form, is_backup: e.target.checked, is_primary: e.target.checked ? false : form.is_primary })} className="h-3.5 w-3.5 accent-[#c9a227]" />
                  Backup provider (used if primary fails)
                </label>
              </>
            )}
            {editing !== 'new' && editing && (
              <label className="flex items-center gap-1.5 text-red-600">
                <input type="checkbox" checked={clearKey} onChange={(e) => setClearKey(e.target.checked)} className="h-3.5 w-3.5" />
                Remove stored key
              </label>
            )}
          </div>

          {testResult && (
            <div className={`rounded-lg border px-3 py-2.5 text-xs ${testResult.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
              <p className="font-semibold">{testResult.ok ? 'Connection successful' : 'Connection failed'} · {testResult.status.replace(/_/g, ' ')}</p>
              <p className="mt-0.5">{testResult.message}{testResult.elapsed_ms ? ` (${testResult.elapsed_ms} ms)` : ''}</p>
            </div>
          )}

          <div className="flex flex-wrap justify-between gap-2 border-t border-line pt-3">
            <button onClick={testDraft} disabled={testing || saving} className="btn-ghost !py-1.5 text-xs">
              {testing ? <Loader2 size={13} className="animate-spin" /> : <PlugZap size={13} />}
              {testing ? 'Testing…' : 'Test connection'}
            </button>
            <div className="flex gap-2">
              <button onClick={() => setEditing(null)} className="btn-ghost !py-1.5 text-xs">Cancel</button>
              <button onClick={save} disabled={saving} className="btn-gold !py-1.5 text-xs">
                {saving ? 'Saving…' : 'Save configuration'}
              </button>
            </div>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        title="Remove configuration"
        message={`Remove “${deleting?.name || ''}”? CALVIN or integrations using it will stop working until another provider is configured.`}
        confirmLabel="Remove"
      />
    </div>
  );
}
