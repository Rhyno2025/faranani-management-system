import { useCallback, useEffect, useState } from 'react';
import {
  BarChart3, FileText, Download, Table2, ChevronLeft, ChevronRight, Search, Printer,
} from 'lucide-react';
import { api, downloadFile } from '../lib/api';
import { useAuth } from '../auth';
import { PageHeader, Field, Select, toast, EmptyState, Spinner, PanelHeader } from '../components/ui';
import { fmtDate, todayISO, monthStartISO, titleCase, zar } from '../lib/format';
import type { Property, Paginated } from '../lib/types';

interface ReportDef { kind: string; label: string; desc: string; perm: string; }

const REPORTS: ReportDef[] = [
  { kind: 'registrations', label: 'Student Registrations', desc: 'Registered students with contact details and status.', perm: 'students.view' },
  { kind: 'admissions', label: 'Admissions', desc: 'Applications received, decisions and dates.', perm: 'applications.view' },
  { kind: 'occupancy', label: 'Occupancy', desc: 'Bed-level occupancy with occupants and stay dates.', perm: 'rooms.view' },
  { kind: 'property_performance', label: 'Property Performance', desc: 'Per-property beds, occupancy, students and complaints.', perm: 'reports.view' },
  { kind: 'complaints', label: 'Complaints & Resolution', desc: 'Ticket history, SLA and resolution times.', perm: 'complaints.view' },
  { kind: 'maintenance', label: 'Maintenance', desc: 'Jobs, assignees, deadlines and costs.', perm: 'maintenance.view' },
  { kind: 'cleaning', label: 'Cleaning Completion', desc: 'Daily cleaning tasks, cleaners and inspections.', perm: 'cleaning.view' },
  { kind: 'income_expenses', label: 'Income & Expenses', desc: 'Monthly income vs operating expenses in ZAR.', perm: 'finance.view' },
  { kind: 'balances', label: 'Outstanding Balances', desc: 'Student accounts: invoiced, paid and balance.', perm: 'finance.view' },
  { kind: 'tasks', label: 'Staff Tasks', desc: 'Task assignments, priorities and due dates.', perm: 'tasks.view' },
];

export default function Reports() {
  const { can } = useAuth();
  const [kind, setKind] = useState<string>('registrations');
  const [from, setFrom] = useState(monthStartISO());
  const [to, setTo] = useState(todayISO());
  const [propertyId, setPropertyId] = useState('');
  const [properties, setProperties] = useState<Property[]>([]);
  const [data, setData] = useState<{ headers: string[]; rows: any[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const PAGE = 25;

  useEffect(() => {
    api.get<Paginated<Property>>('/properties?pageSize=100').then((r) => setProperties(r.data)).catch(() => {});
  }, []);

  const available = REPORTS.filter((r) => can(r.perm));

  const load = useCallback(async () => {
    setLoading(true); setPageIndex(0);
    try {
      const p = new URLSearchParams();
      if (from) p.set('from', from);
      if (to) p.set('to', to);
      if (propertyId) p.set('property_id', propertyId);
      const res = await api.get<{ headers: string[]; rows: any[] }>(`/reports/${kind}?${p.toString()}`);
      setData(res);
    } catch (e: any) { toast(e.message, 'error'); setData(null); }
    finally { setLoading(false); }
  }, [kind, from, to, propertyId]);

  useEffect(() => { load(); }, [load]);

  const exportCsv = async () => {
    try {
      const p = new URLSearchParams({ format: 'csv' });
      if (from) p.set('from', from);
      if (to) p.set('to', to);
      if (propertyId) p.set('property_id', propertyId);
      await downloadFile(`/reports/${kind}?${p.toString()}`, `faranani-${kind}.csv`);
      toast('CSV exported');
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const printable = () => window.print();
  const visible = data?.rows.slice(pageIndex * PAGE, pageIndex * PAGE + PAGE) || [];
  const pages = data ? Math.max(1, Math.ceil(data.rows.length / PAGE)) : 1;
  const current = REPORTS.find((r) => r.kind === kind);

  return (
    <div>
      <PageHeader
        title="Reports & Analytics"
        subtitle="Every report runs against live records and respects your permissions — exports included."
        actions={
          <>
            <button className="btn-ghost inline-flex items-center gap-1.5" onClick={printable}>
              <Printer size={14} /> Print / PDF
            </button>
            {can('reports.export') && (
              <button className="btn-gold inline-flex items-center gap-1.5" onClick={exportCsv} disabled={!data}>
                <Download size={15} /> Export CSV
              </button>
            )}
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-2.5 rounded-xl border border-line bg-white px-4 py-3">
        <div className="min-w-[220px]">
          <Field label="Report">
            <Select value={kind} onChange={(e) => setKind(e.target.value)}>
              {available.map((r) => <option key={r.kind} value={r.kind}>{r.label}</option>)}
            </Select>
          </Field>
        </div>
        <div><Field label="From"><input type="date" className="field" value={from} onChange={(e) => setFrom(e.target.value)} /></Field></div>
        <div><Field label="To"><input type="date" className="field" value={to} onChange={(e) => setTo(e.target.value)} /></Field></div>
        <div className="min-w-[180px]">
          <Field label="Property">
            <select className="field" value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
              <option value="">All properties</option>
              {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
        </div>
        <button className="btn-gold !py-2" onClick={load}><Search size={14} className="mr-1 inline" />Run Report</button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {available.map((r) => (
          <button key={r.kind} onClick={() => setKind(r.kind)}
            className={`panel flex items-start gap-3 px-4 py-3 text-left transition hover:border-gold ${kind === r.kind ? 'border-gold ring-1 ring-gold/30' : ''}`}>
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${kind === r.kind ? 'bg-gold-soft text-gold-dark' : 'bg-neutral-100 text-neutral-500'}`}>
              <BarChart3 size={16} />
            </span>
            <span>
              <span className="block text-xs font-bold text-neutral-800">{r.label}</span>
              <span className="mt-0.5 block text-[11px] text-neutral-500">{r.desc}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="panel mt-4 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3.5">
          <div>
            <h3 className="text-sm font-bold text-neutral-800">{current?.label}</h3>
            <p className="mt-0.5 text-xs text-neutral-500">
              {fmtDate(from)} – {fmtDate(to)}{propertyId ? ` · ${properties.find((p) => p.id === propertyId)?.name}` : ' · All properties'}
              {data ? ` · ${data.rows.length} record${data.rows.length === 1 ? '' : 's'}` : ''}
            </p>
          </div>
          <span className="pill bg-gold-soft text-gold-dark">Permission-filtered</span>
        </div>

        {loading ? <Spinner /> : !data || !data.rows.length ? (
          <EmptyState title="No records for this selection"
            hint="Widen the date range or choose another report. Empty results reflect real data — nothing is fabricated." />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>{data.headers.map((h) => <th key={h}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {visible.map((row, i) => (
                    <tr key={i}>
                      {data.headers.map((h) => {
                        const raw = row[h];
                        const isMoney = /ZAR|Balance|Amount|Cost|Income|Expenses|Net/i.test(h);
                        const isNumeric = typeof raw === 'number';
                        return (
                          <td key={h} className={isMoney || isNumeric ? 'text-right tabular-nums' : ''}>
                            {raw === null || raw === undefined || raw === '' ? <span className="text-neutral-300">—</span> :
                              isMoney && typeof raw === 'string' && !Number.isNaN(Number(raw)) ? <span className="font-semibold">{zar(Number(raw), 2)}</span> :
                              isMoney && typeof raw === 'number' ? <span className="font-semibold">{zar(raw, 2)}</span> :
                              String(raw)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between px-4 py-3 text-xs text-neutral-500">
              <span>Showing {pageIndex * PAGE + 1}–{Math.min((pageIndex + 1) * PAGE, data.rows.length)} of {data.rows.length}</span>
              <div className="flex items-center gap-1">
                <button className="btn-ghost !px-2 !py-1" disabled={pageIndex === 0} onClick={() => setPageIndex(pageIndex - 1)} aria-label="Previous page">
                  <ChevronLeft size={13} />
                </button>
                <span className="px-2 font-medium text-neutral-700">Page {pageIndex + 1} of {pages}</span>
                <button className="btn-ghost !px-2 !py-1" disabled={pageIndex >= pages - 1} onClick={() => setPageIndex(pageIndex + 1)} aria-label="Next page">
                  <ChevronRight size={13} />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
