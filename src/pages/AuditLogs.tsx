import { useCallback, useEffect, useState } from 'react';
import { Search, ShieldCheck, Download } from 'lucide-react';
import { api, downloadFile } from '../lib/api';
import { useAuth } from '../auth';
import { PageHeader, Field, Input, toast, StatusPill, Modal, FormActions, EmptyState } from '../components/ui';
import { DataTable, Column, TableToolbar } from '../components/DataTable';
import { fmtDateTime, titleCase } from '../lib/format';
import type { AuditEntry, Paginated } from '../lib/types';

const ACTIONS = ['auth', 'student', 'application', 'complaint', 'maintenance', 'cleaning', 'invoice', 'payment', 'expense', 'settings', 'user', 'document', 'task', 'room', 'property', 'report'];

export default function AuditLogs() {
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 25, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<AuditEntry | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ page: String(page), pageSize: '25' });
      if (q) p.set('q', q);
      if (action) p.set('action', action);
      const res = await api.get<Paginated<AuditEntry>>(`/audit?${p.toString()}`);
      setRows(res.data); setPagination(res.pagination);
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  }, [page, q, action]);

  useEffect(() => { const t = setTimeout(load, q ? 300 : 0); return () => clearTimeout(t); }, [load, q]);

  const cols: Column<AuditEntry>[] = [
    { key: 'created_at', header: 'When', render: (a) => <span className="whitespace-nowrap text-xs font-medium text-neutral-700">{fmtDateTime(a.created_at)}</span> },
    {
      key: 'user', header: 'User',
      render: (a) => (
        <div className="text-xs">
          <p className="font-medium text-neutral-800">{a.user_name || a.user_email || 'System'}</p>
          {a.user_name && <p className="text-[11px] text-neutral-400">{a.user_email}</p>}
        </div>
      ),
    },
    { key: 'action', header: 'Action', render: (a) => <span className="pill bg-neutral-100 text-neutral-700">{a.action}</span> },
    { key: 'summary', header: 'Summary', render: (a) => <span className="block max-w-[420px] truncate text-xs text-neutral-600" title={a.summary || ''}>{a.summary || '—'}</span> },
    { key: 'entity', header: 'Entity', render: (a) => <span className="text-xs text-neutral-500">{a.entity_type ? `${a.entity_type}` : '—'}</span> },
    { key: 'ip', header: 'IP', render: (a) => <span className="font-mono text-[11px] text-neutral-400">{a.ip || '—'}</span> },
    {
      key: 'actions', header: '', className: 'text-right',
      render: (a) => (
        <button className="rounded p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-gold-dark" title="View details"
          onClick={(e) => { e.stopPropagation(); setDetail(a); }}>
          <ShieldCheck size={14} />
        </button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Audit Logs"
        subtitle="Immutable trail of significant actions — authentication, record changes, exports and settings."
        actions={
          <span className="pill bg-gold-soft text-gold-dark">{pagination.total} events retained</span>
        }
      />

      <div className="panel overflow-hidden">
        <DataTable
          rows={rows} columns={cols} loading={loading} rowKey={(a) => a.id}
          onRowClick={(a) => setDetail(a)}
          page={pagination.page} pageSize={pagination.pageSize} total={pagination.total}
          totalPages={pagination.totalPages} onPageChange={setPage}
          emptyTitle="No audit entries" emptyHint="Significant system actions will appear here as staff use the system."
          toolbar={
            <TableToolbar>
              <div className="relative min-w-[220px] flex-1">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search summaries, actions, users…" aria-label="Search audit log" className="field !py-1.5 !pl-9 text-xs" />
              </div>
              <select value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} aria-label="Action filter" className="field !w-auto !py-1.5 text-xs">
                <option value="">All actions</option>
                {ACTIONS.map((a) => <option key={a} value={a}>{titleCase(a)}</option>)}
              </select>
            </TableToolbar>
          }
        />
      </div>

      <Modal open={Boolean(detail)} onClose={() => setDetail(null)} title="Audit entry" width="max-w-xl">
        {detail && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-2.5">
              <div className="rounded-lg border border-line px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Timestamp</p>
                <p className="text-xs font-semibold text-neutral-700">{fmtDateTime(detail.created_at)}</p>
              </div>
              <div className="rounded-lg border border-line px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Action</p>
                <p className="text-xs font-semibold text-neutral-700">{detail.action}</p>
              </div>
              <div className="rounded-lg border border-line px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">User</p>
                <p className="text-xs font-semibold text-neutral-700">{detail.user_name || 'System'} <span className="font-normal text-neutral-500">{detail.user_email}</span></p>
              </div>
              <div className="rounded-lg border border-line px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">IP address</p>
                <p className="font-mono text-xs text-neutral-700">{detail.ip || '—'}</p>
              </div>
            </div>
            <div className="rounded-lg border border-line px-3.5 py-2.5">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Summary</p>
              <p className="text-xs text-neutral-700">{detail.summary || '—'}</p>
            </div>
            {detail.details && (
              <div className="rounded-lg border border-line px-3.5 py-2.5">
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Details</p>
                <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all text-[11px] text-neutral-600">{detail.details}</pre>
              </div>
            )}
            <FormActions><button className="btn-ghost" onClick={() => setDetail(null)}>Close</button></FormActions>
          </div>
        )}
      </Modal>
    </div>
  );
}
