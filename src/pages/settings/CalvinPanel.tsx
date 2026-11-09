import { useCallback, useEffect, useState } from 'react';
import {
  Bot, Volume2, Mic, Brain, Trash2, Save, Loader2, PlugZap, ShieldCheck, AlertTriangle,
} from 'lucide-react';
import { api } from '../../lib/api';
import {
  Spinner, ErrorNote, Field, Input, Select, toast, EmptyState, ConfirmDialog,
} from '../../components/ui';
import { fmtWhen } from '../../lib/format';
import { ConfigManager } from './ConfigManager';
import type { MemoryRow, MemorySettings, VoiceSettings } from './types';

const LANGUAGES = [
  { value: 'en-ZA', label: 'English (South Africa)' },
  { value: 'en-GB', label: 'English (United Kingdom)' },
  { value: 'en-US', label: 'English (United States)' },
  { value: 'af-ZA', label: 'Afrikaans (South Africa)' },
  { value: 'zu-ZA', label: 'isiZulu (South Africa)' },
];

export function CalvinPanel() {
  const [voice, setVoice] = useState<VoiceSettings | null>(null);
  const [memory, setMemory] = useState<MemorySettings | null>(null);
  const [memories, setMemories] = useState<MemoryRow[]>([]);
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState<MemoryRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [v, m, s] = await Promise.all([
        api.get<{ voice: VoiceSettings; memory: MemorySettings }>('/settings/voice'),
        api.get<{ data: MemoryRow[] }>('/settings/memory'),
        api.get<any>('/calvin/status').catch(() => null),
      ]);
      setVoice(v.voice);
      setMemory(v.memory);
      setMemories(m.data);
      setStatus(s);
    } catch (e: any) {
      setError(e.message || 'Could not load CALVIN configuration.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveVoice = async () => {
    if (!voice || !memory) return;
    setSaving(true);
    try {
      await api.post('/settings/voice', { voice, memory });
      toast('Voice and memory settings saved');
      await load();
    } catch (e: any) {
      toast(e.message || 'Could not save settings', 'error');
    } finally {
      setSaving(false);
    }
  };

  const removeMemory = async () => {
    if (!deleting) return;
    try {
      await api.del(`/settings/memory/${deleting.id}`);
      toast('Memory entry deleted');
      setDeleting(null);
      await load();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  if (loading) return <Spinner label="Loading CALVIN configuration…" />;
  if (error) return <ErrorNote message={error} />;

  return (
    <div className="space-y-4">
      <div className="panel px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-bold text-neutral-800"><Bot size={16} className="text-gold" /> Assistant status</h3>
            <p className="mt-1 max-w-2xl text-[11.5px] leading-relaxed text-neutral-500">
              CALVIN uses the primary provider below. If it fails and a backup provider is enabled, the backup is tried automatically.
              Tools run with the signed-in employee's permissions, so a cleaner cannot retrieve payroll.
            </p>
          </div>
          <span className={`pill ${status?.configured ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800'}`}>
            {status?.configured ? 'Connected' : 'Not configured'}
          </span>
        </div>
        <div className="mt-3 grid gap-2 text-[11.5px] sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-line bg-neutral-50/60 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Provider</p>
            <p className="font-semibold text-neutral-800">{status?.provider || '—'}</p>
          </div>
          <div className="rounded-lg border border-line bg-neutral-50/60 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Model</p>
            <p className="font-semibold text-neutral-800">{status?.model || '—'}</p>
          </div>
          <div className="rounded-lg border border-line bg-neutral-50/60 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Configuration source</p>
            <p className="font-semibold text-neutral-800">{status?.source === 'environment' ? 'server .env' : status?.source === 'settings' ? 'Settings (encrypted)' : '—'}</p>
          </div>
          <div className="rounded-lg border border-line bg-neutral-50/60 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Available tools</p>
            <p className="font-semibold text-neutral-800">{status?.available_tools ?? 0} of {status?.tools ?? 0}</p>
          </div>
        </div>
      </div>

      <div className="panel px-5 py-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-bold text-neutral-800"><PlugZap size={15} className="text-gold" /> AI provider configuration</h3>
        </div>
        <ConfigManager
          kind="ai"
          description="Add one or more AI providers. Keys are encrypted with AES-256-GCM before storage and are never returned to the browser. Use Test to verify the URL, key and model before relying on it."
        />
      </div>

      {voice && memory && (
        <div className="panel px-5 py-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-sm font-bold text-neutral-800"><Volume2 size={15} className="text-gold" /> Voice & memory</h3>
            <button onClick={saveVoice} disabled={saving} className="btn-gold !py-1.5 text-xs">
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save settings
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Speech recognition language">
              <Select value={voice.recognition_language} onChange={(e) => setVoice({ ...voice, recognition_language: e.target.value })}>
                {LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
              </Select>
            </Field>
            <Field label="Preferred voice name" hint="Exact browser voice name; blank = best match">
              <Input value={voice.voice_name} onChange={(e) => setVoice({ ...voice, voice_name: e.target.value })} placeholder="e.g. Microsoft David" />
            </Field>
            <Field label="Speech rate" hint={`${voice.speech_rate.toFixed(2)}×`}>
              <input
                type="range" min={0.5} max={1.6} step={0.05}
                value={voice.speech_rate}
                onChange={(e) => setVoice({ ...voice, speech_rate: Number(e.target.value) })}
                className="w-full accent-[#c9a227]"
              />
            </Field>
            <Field label="Speech pitch" hint={voice.speech_pitch.toFixed(2)}>
              <input
                type="range" min={0.5} max={1.5} step={0.02}
                value={voice.speech_pitch}
                onChange={(e) => setVoice({ ...voice, speech_pitch: Number(e.target.value) })}
                className="w-full accent-[#c9a227]"
              />
            </Field>
          </div>

          <div className="mt-3 flex flex-wrap gap-4 text-xs text-neutral-600">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={voice.input_enabled} onChange={(e) => setVoice({ ...voice, input_enabled: e.target.checked })} className="h-3.5 w-3.5 accent-[#c9a227]" />
              <Mic size={12} /> Allow voice input
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={voice.output_enabled} onChange={(e) => setVoice({ ...voice, output_enabled: e.target.checked })} className="h-3.5 w-3.5 accent-[#c9a227]" />
              <Volume2 size={12} /> Speak replies aloud
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={voice.wake_word_enabled} onChange={(e) => setVoice({ ...voice, wake_word_enabled: e.target.checked })} className="h-3.5 w-3.5 accent-[#c9a227]" />
              Wake word: {voice.wake_word}
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={memory.enabled} onChange={(e) => setMemory({ ...memory, enabled: e.target.checked })} className="h-3.5 w-3.5 accent-[#c9a227]" />
              <Brain size={12} /> Long-term memory
            </label>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Memory retention (days)">
              <Input
                type="number" min={1}
                value={memory.retention_days}
                onChange={(e) => setMemory({ ...memory, retention_days: Number(e.target.value) })}
              />
            </Field>
            <Field label="Max facts per employee">
              <Input
                type="number" min={1}
                value={memory.max_entries_per_user}
                onChange={(e) => setMemory({ ...memory, max_entries_per_user: Number(e.target.value) })}
              />
            </Field>
            <label className="mt-5 flex items-center gap-1.5 text-xs text-neutral-600">
              <input type="checkbox" checked={memory.user_memory} onChange={(e) => setMemory({ ...memory, user_memory: e.target.checked })} className="h-3.5 w-3.5 accent-[#c9a227]" />
              Employee-specific memory
            </label>
            <label className="mt-5 flex items-center gap-1.5 text-xs text-neutral-600">
              <input type="checkbox" checked={memory.department_memory} onChange={(e) => setMemory({ ...memory, department_memory: e.target.checked })} className="h-3.5 w-3.5 accent-[#c9a227]" />
              Shared department memory (admin-authored)
            </label>
          </div>

          <div className="mt-3 flex items-start gap-2 rounded-lg bg-neutral-50 px-3 py-2 text-[11px] leading-relaxed text-neutral-500">
            <ShieldCheck size={13} className="mt-0.5 shrink-0 text-gold" />
            <span>
              Voice recognition identifies a device, not a person. It is never treated as authentication: every action still requires a signed-in session and server-enforced permissions.
            </span>
          </div>
        </div>
      )}

      <div className="panel overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <h3 className="flex items-center gap-2 text-xs font-bold text-neutral-800"><Brain size={14} className="text-gold" /> Stored CALVIN memory</h3>
          <span className="pill bg-neutral-100 text-neutral-600">{memories.length} entries</span>
        </div>
        <div className="max-h-72 overflow-y-auto">
          <table className="data-table">
            <thead><tr><th>Employee</th><th>Fact</th><th>Scope</th><th>Updated</th><th /></tr></thead>
            <tbody>
              {memories.map((m) => (
                <tr key={m.id}>
                  <td className="text-[11.5px] text-neutral-700">{m.full_name || m.email || 'Department'}</td>
                  <td>
                    <p className="text-[11.5px] font-medium text-neutral-800">{m.memory_key}</p>
                    <p className="text-[11px] text-neutral-500">{m.content}</p>
                  </td>
                  <td><span className="pill bg-neutral-100 text-neutral-600">{m.scope}</span></td>
                  <td className="text-[10.5px] text-neutral-500">{fmtWhen(m.updated_at)}</td>
                  <td>
                    <button onClick={() => setDeleting(m)} className="btn-ghost !p-1.5 text-red-600"><Trash2 size={12} /></button>
                  </td>
                </tr>
              ))}
              {memories.length === 0 && (
                <tr><td colSpan={5}><EmptyState icon={<Brain size={18} />} title="No memory stored yet" hint="Employees can ask CALVIN to remember facts such as their preferred name." /></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-line bg-white px-4 py-3 text-[11px] leading-relaxed text-neutral-500">
        <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-500" />
        <span>
          Memory is stored per employee on the server and cleared after the retention window. Department memory is only visible to employees whose role permits it. Never store passwords or API keys in memory.
        </span>
      </div>

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={removeMemory}
        title="Delete memory entry"
        message={`Delete “${deleting?.memory_key || ''}”? CALVIN will no longer recall this fact.`}
        confirmLabel="Delete"
      />
    </div>
  );
}

export function IntegrationsPanel() {
  return (
    <div className="space-y-4">
      <div className="panel px-5 py-4">
        <h3 className="mb-2 text-sm font-bold text-neutral-800">Email API</h3>
        <ConfigManager
          kind="email"
          description="Transactional email provider used for notifications when email delivery is enabled. Test performs a real request to the base URL with your key and reports the HTTP result honestly."
        />
      </div>
      <div className="panel px-5 py-4">
        <h3 className="mb-2 text-sm font-bold text-neutral-800">Other integrations</h3>
        <ConfigManager
          kind="other"
          description="Additional services (storage, SMS gateways, custom APIs). Credentials are encrypted at rest. Connection tests only verify that the endpoint is reachable and accepts the credential — not that every operation is supported."
        />
      </div>
    </div>
  );
}
