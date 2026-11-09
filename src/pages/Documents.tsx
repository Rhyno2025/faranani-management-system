import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Upload, Search, FileText, Download, Trash2, Image as ImageIcon, FileSpreadsheet, File } from 'lucide-react';
import { api, uploadFile, downloadFile } from '../lib/api';
import { useAuth } from '../auth';
import {
  PageHeader, Field, Input, Select, FormActions, Modal, StatusPill, toast,
  ConfirmDialog, EmptyState,
} from '../components/ui';
import { DataTable, Column, TableToolbar } from '../components/DataTable';
import { fmtDateTime, titleCase } from '../lib/format';
import type { DocumentRow, Paginated } from '../lib/types';

const DOC_TYPES = ['General', 'Application', 'Agreement', 'Invoice', 'Receipt', 'Inspection', 'Maintenance', 'Property', 'Staff', 'Company'];
const ENTITY_TYPES = ['general', 'student', 'property', 'staff', 'application'];
const VISIBILITIES = ['internal', 'sensitive'];

function iconFor(mime: string | null, name: string) {
  const m = (mime || '').toLowerCase();
  if (m.includes('pdf')) return <FileText size={16} className="text-red-500" />;
  if (m.includes('image')) return <ImageIcon size={16} className="text-emerald-500" />;
  if (m.includes('sheet') || m.includes('excel') || name.endsWith('.csv')) return <FileSpreadsheet size={16} className="text-emerald-600" />;
  return <File size={16} className="text-neutral-500" />;
}

function humanSize(bytes: number | null): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function Documents() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [rows, setRows] = useState<DocumentRow[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 20, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [entityType, setEntityType] = useState('');
  const [page, setPage] = useState(1);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [meta, setMeta] = useState({ doc_type: 'General', entity_type: 'general', visibility: 'internal' });
  const [uploading, setUploading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DocumentRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ page: String(page), pageSize: '20' });
      if (q) p.set('q', q);
      if (entityType) p.set('entity_type', entityType);
      const res = await api.get<Paginated<DocumentRow>>(`/documents?${p.toString()}`);
      setRows(res.data); setPagination(res.pagination);
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  }, [page, q, entityType]);

  useEffect(() => { const t = setTimeout(load, q ? 300 : 0); return () => clearTimeout(t); }, [load, q]);

  const doUpload = async () => {
    if (!file) { toast('Choose a file first', 'error'); return; }
    setUploading(true);
    try {
      await uploadFile('/documents', file, meta);
      toast(`${file.name} uploaded`);
      setUploadOpen(false); setFile(null); load();
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setUploading(false); }
  };

  const doDownload = async (d: DocumentRow) => {
    try { await downloadFile(`/documents/${d.id}/download`, d.file_name); }
    catch (e: any) { toast(e.message, 'error'); }
  };

  const doDelete = async () => {
    if (!deleteTarget) return;
    try { await api.del(`/documents/${deleteTarget.id}`); toast('Document deleted'); setDeleteTarget(null); load(); }
    catch (e: any) { toast(e.message, 'error'); }
  };

  const cols: Column<DocumentRow>[] = [
    { key: 'file', header: 'File', render: (d) => (
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-100">{iconFor(d.mime, d.file_name)}</span>
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-neutral-800">{d.file_name}</p>
          <p className="text-[11px] text-neutral-400">{d.doc_ref} · {humanSize(d.size)}</p>
        </div>
      </div>
    ) },
    { key: 'doc_type', header: 'Type', render: (d) => <span className="pill bg-neutral-100 text-neutral-600">{d.doc_type || 'General'}</span> },
    { key: 'entity_type', header: 'Linked To', render: (d) => <span className="text-xs text-neutral-600">{titleCase(d.entity_type || 'general')}</span> },
    { key: 'uploader', header: 'Uploaded By', render: (d) => <span className="text-xs text-neutral-600">{d.uploader_name || '—'}</span> },
    { key: 'created_at', header: 'Date', render: (d) => <span className="whitespace-nowrap text-xs text-neutral-500">{fmtDateTime(d.created_at)}</span> },
    { key: 'visibility', header: 'Visibility', render: (d) => <StatusPill value={d.visibility === 'sensitive' ? 'escalated' : 'active'} label={titleCase(d.visibility)} /> },
    {
      key: 'actions', header: '', className: 'text-right',
      render: (d) => (
        <div className="flex justify-end gap-1">
          <button className="rounded p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-gold-dark" title="Download"
            onClick={(e) => { e.stopPropagation(); doDownload(d); }}><Download size={14} /></button>
          {can('documents.manage') && (
            <button className="rounded p-1.5 text-neutral-400 hover:bg-red-50 hover:text-red-600" title="Delete"
              onClick={(e) => { e.stopPropagation(); setDeleteTarget(d); }}><Trash2 size={14} /></button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Documents"
        subtitle="Private storage — every download is permission-checked and audited. No public URLs."
        actions={can('documents.manage') && (
          <button className="btn-gold inline-flex items-center gap-1.5" onClick={() => setUploadOpen(true)}>
            <Upload size={15} /> Upload Document
          </button>
        )}
      />

      <div className="panel overflow-hidden">
        <DataTable
          rows={rows} columns={cols} loading={loading} rowKey={(d) => d.id}
          page={pagination.page} pageSize={pagination.pageSize} total={pagination.total}
          totalPages={pagination.totalPages} onPageChange={setPage}
          emptyTitle="No documents stored" emptyHint="Upload applications, agreements, invoices, inspection reports or property documents."
          toolbar={
            <TableToolbar>
              <div className="relative min-w-[200px] flex-1">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search documents…" aria-label="Search documents" className="field !py-1.5 !pl-9 text-xs" />
              </div>
              <select value={entityType} onChange={(e) => { setEntityType(e.target.value); setPage(1); }} aria-label="Filter by link" className="field !w-auto !py-1.5 text-xs">
                <option value="">All documents</option>
                {ENTITY_TYPES.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
              </select>
            </TableToolbar>
          }
        />
      </div>

      <Modal open={uploadOpen} onClose={() => setUploadOpen(false)} title="Upload document" width="max-w-lg">
        <div className="space-y-3.5">
          <Field label="File" required hint="PDF, images, Word, Excel or CSV — max 10 MB">
            <input type="file" aria-label="Choose file"
              className="field !py-2 text-xs file:mr-3 file:rounded file:border-0 file:bg-gold-soft file:px-3 file:py-1 file:text-xs file:font-semibold file:text-gold-dark"
              onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </Field>
          <div className="grid gap-3.5 sm:grid-cols-3">
            <Field label="Document type">
              <Select value={meta.doc_type} onChange={(e) => setMeta({ ...meta, doc_type: e.target.value })}>
                {DOC_TYPES.map((t) => <option key={t}>{t}</option>)}
              </Select>
            </Field>
            <Field label="Linked to">
              <Select value={meta.entity_type} onChange={(e) => setMeta({ ...meta, entity_type: e.target.value })}>
                {ENTITY_TYPES.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
              </Select>
            </Field>
            <Field label="Visibility">
              <Select value={meta.visibility} onChange={(e) => setMeta({ ...meta, visibility: e.target.value })}>
                {VISIBILITIES.map((v) => <option key={v} value={v}>{titleCase(v)}</option>)}
              </Select>
            </Field>
          </div>
        </div>
        <FormActions>
          <button className="btn-ghost" onClick={() => setUploadOpen(false)}>Cancel</button>
          <button className="btn-gold" onClick={doUpload} disabled={uploading}>{uploading ? 'Uploading…' : 'Upload'}</button>
        </FormActions>
      </Modal>

      <ConfirmDialog open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} onConfirm={doDelete}
        title="Delete document?" message={`This permanently deletes ${deleteTarget?.file_name} and its stored file.`} confirmLabel="Delete" />
    </div>
  );
}
