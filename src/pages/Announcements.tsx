import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Search, Megaphone, Send, Trash2, Pencil } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../auth';
import {
  PageHeader, Field, Input, Select, Textarea, FormGrid, FormActions, Modal,
  StatusPill, toast, Tabs, ConfirmDialog, EmptyState, PriorityPill,
} from '../components/ui';
import { DataTable, Column, TableToolbar } from '../components/DataTable';
import { fmtDateTime, fmtDate, titleCase } from '../lib/format';
import type { Announcement, Paginated } from '../lib/types';

const AUDIENCES = ['all', 'staff', 'students'];
const EMPTY = { title: '', body: '', audience: 'all', priority: 'normal', status: 'draft', expires_at: '' };

export default function Announcements() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [rows, setRows] = useState<Announcement[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 20, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<'all' | 'published' | 'draft'>('all');
  const [page, setPage] = useState(1);

  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState<Announcement | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Announcement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ page: String(page), pageSize: '20' });
      if (q) p.set('q', q);
      if (tab !== 'all') p.set('status', tab);
      const res = await api.get<Paginated<Announcement>>(`/announcements?${p.toString()}`);
      setRows(res.data); setPagination(res.pagination);
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  }, [page, q, tab]);

  useEffect(() => { const t = setTimeout(load, q ? 300 : 0); return () => clearTimeout(t); }, [load, q]);

  const submit = async () => {
    if (!form.title.trim() || !form.body.trim()) { toast('Title and body are required', 'error'); return; }
    setSaving(true);
    try {
      if (editId) { await api.patch(`/announcements/${editId}`, form); toast('Announcement updated'); }
      else { await api.post('/announcements', form); toast(form.status === 'published' ? 'Announcement published & notified' : 'Draft saved'); }
      setFormOpen(false); setEditId(null); setForm({ ...EMPTY }); load();
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setSaving(false); }
  };

  const publish = async (a: Announcement) => {
    try { await api.patch(`/announcements/${a.id}`, { status: 'published' }); toast('Published & audience notified'); load(); }
    catch (e: any) { toast(e.message, 'error'); }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    try { await api.del(`/announcements/${deleteTarget.id}`); toast('Deleted'); setDeleteTarget(null); load(); }
    catch (e: any) { toast(e.message, 'error'); }
  };

  const openEdit = (a: Announcement) => {
    setForm({ title: a.title, body: a.body, audience: a.audience, priority: a.priority, status: a.status, expires_at: a.expires_at || '' });
    setEditId(a.id); setFormOpen(true);
  };

  const cols: Column<Announcement>[] = [
    {
      key: 'title', header: 'Announcement',
      render: (a) => (
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-gold-soft text-gold-dark"><Megaphone size={13} /></span>
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-neutral-800">{a.title}</p>
            <p className="truncate text-[11px] text-neutral-400">{a.body}</p>
          </div>
        </div>
      ),
    },
    { key: 'audience', header: 'Audience', render: (a) => <span className="pill bg-neutral-100 text-neutral-600">{titleCase(a.audience)}</span> },
    { key: 'priority', header: 'Priority', render: (a) => <PriorityPill value={a.priority === 'high' ? 'high' : a.priority === 'urgent' ? 'urgent' : 'normal'} /> },
    { key: 'author', header: 'Author', render: (a) => <span className="text-xs text-neutral-600">{a.author_name || '—'}</span> },
    { key: 'published_at', header: 'Published', render: (a) => <span className="whitespace-nowrap text-xs text-neutral-500">{fmtDateTime(a.published_at)}</span> },
    { key: 'status', header: 'Status', render: (a) => <StatusPill value={a.status} /> },
    {
      key: 'actions', header: '', className: 'text-right',
      render: (a) => can('announcements.manage') && (
        <div className="flex justify-end gap-1">
          {a.status === 'draft' && (
            <button className="btn-ghost !py-1 text-[11px]" onClick={(e) => { e.stopPropagation(); publish(a); }}>
              <Send size={11} className="mr-1 inline" />Publish
            </button>
          )}
          <button className="rounded p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700" title="Edit"
            onClick={(e) => { e.stopPropagation(); openEdit(a); }}><Pencil size={13} /></button>
          <button className="rounded p-1.5 text-neutral-400 hover:bg-red-50 hover:text-red-600" title="Delete"
            onClick={(e) => { e.stopPropagation(); setDeleteTarget(a); }}><Trash2 size={13} /></button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Announcements & Communication"
        subtitle="Draft vs published is explicit. Publishing notifies the selected audience."
        actions={can('announcements.manage') && (
          <button className="btn-gold inline-flex items-center gap-1.5" onClick={() => { setForm({ ...EMPTY }); setEditId(null); setFormOpen(true); }}>
            <Plus size={15} /> New Announcement
          </button>
        )}
      />

      <div className="panel overflow-hidden">
        <div className="border-b border-line px-4 pt-2">
          <Tabs active={tab} onChange={(k) => { setTab(k as any); setPage(1); }} tabs={[
            { key: 'all', label: 'All', count: pagination.total },
            { key: 'published', label: 'Published' },
            { key: 'draft', label: 'Drafts' },
          ]} />
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
          <div className="relative min-w-[200px] flex-1">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search announcements…" aria-label="Search announcements" className="field !py-1.5 !pl-9 text-xs" />
          </div>
        </div>
        <DataTable rows={rows} columns={cols} loading={loading} rowKey={(a) => a.id}
          onRowClick={(a) => setDetail(a)}
          page={pagination.page} pageSize={pagination.pageSize} total={pagination.total}
          totalPages={pagination.totalPages} onPageChange={setPage}
          emptyTitle="No announcements" emptyHint="Compose one to notify staff or students." />
      </div>

      {/* detail */}
      <Modal open={Boolean(detail)} onClose={() => setDetail(null)} title={detail?.title || ''} width="max-w-xl">
        {detail && (
          <div>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <StatusPill value={detail.status} />
              <span className="pill bg-neutral-100 text-neutral-600">{titleCase(detail.audience)}</span>
              <PriorityPill value={detail.priority === 'high' ? 'high' : detail.priority === 'urgent' ? 'urgent' : 'normal'} />
            </div>
            <div className="rounded-lg border border-line px-4 py-3 text-sm text-neutral-700">
              <p className="whitespace-pre-wrap">{detail.body}</p>
            </div>
            <div className="mt-3 flex justify-between text-xs text-neutral-500">
              <span>By {detail.author_name || '—'}</span>
              <span>{fmtDateTime(detail.published_at || detail.created_at)}</span>
            </div>
            <FormActions><button className="btn-ghost" onClick={() => setDetail(null)}>Close</button></FormActions>
          </div>
        )}
      </Modal>

      {/* form */}
      <Modal open={formOpen} onClose={() => setFormOpen(false)} title={editId ? 'Edit Announcement' : 'New Announcement'} width="max-w-2xl">
        <FormGrid>
          <div className="sm:col-span-2">
            <Field label="Title" required><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} autoFocus /></Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Message" required><Textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} /></Field>
          </div>
          <Field label="Audience">
            <Select value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })}>
              {AUDIENCES.map((a) => <option key={a} value={a}>{titleCase(a)}</option>)}
            </Select>
          </Field>
          <Field label="Priority">
            <Select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
              {['normal', 'high', 'urgent'].map((p) => <option key={p} value={p}>{titleCase(p)}</option>)}
            </Select>
          </Field>
          <Field label="Status">
            <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              <option value="draft">Draft</option>
              <option value="published">Published</option>
            </Select>
          </Field>
          <Field label="Expires on"><Input type="date" value={form.expires_at} onChange={(e) => setForm({ ...form, expires_at: e.target.value })} /></Field>
        </FormGrid>
        <FormActions>
          <button className="btn-ghost" onClick={() => setFormOpen(false)}>Cancel</button>
          <button className="btn-gold" onClick={submit} disabled={saving}>{saving ? 'Saving…' : editId ? 'Save Changes' : form.status === 'published' ? 'Publish' : 'Save Draft'}</button>
        </FormActions>
      </Modal>

      <ConfirmDialog open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} onConfirm={remove}
        title="Delete announcement?" message={`This removes "${deleteTarget?.title}" permanently.`} confirmLabel="Delete" />
    </div>
  );
}
