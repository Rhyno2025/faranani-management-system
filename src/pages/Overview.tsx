import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Users, BedDouble, FileText, MessageSquareWarning, Wallet, TrendingUp, TrendingDown,
  Building2, AlertTriangle, CalendarClock, Sparkles, Download, ArrowRight,
  ClipboardCheck, UserCheck, Wrench, Megaphone, Activity, CircleAlert,
} from 'lucide-react';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  BarChart, Bar, Legend, PieChart, Pie, Cell,
} from 'recharts';
import { api, downloadFile } from '../lib/api';
import { useAuth } from '../auth';
import { StatusPill, PriorityPill, Spinner, EmptyState, toast, PanelHeader } from '../components/ui';
import { DataTable, Column } from '../components/DataTable';
import {
  zar, zarShort, fmtWhen, fmtDate, todayISO, monthStartISO, monthEndISO, titleCase, relativeDay,
} from '../lib/format';
import type { DashboardSummary, Complaint } from '../lib/types';

const GOLD = '#c9a227';
const GOLD_SOFT = '#e6c86a';
const INK = '#16161a';
const GREEN = '#16a34a';
const RED = '#dc2626';
const AMBER = '#f59e0b';
const SKY = '#0ea5e9';

function chartHasData(rows: any[] | undefined, keys: string[]): boolean {
  if (!Array.isArray(rows) || rows.length === 0) return false;
  return rows.some((row) => keys.some((k) => Number(row?.[k]) !== 0));
}

function ChartEmpty({ height = 250 }: { height?: number }) {
  return (
    <div
      className="flex items-center justify-center px-6 text-center text-[11.5px] leading-relaxed text-neutral-400"
      style={{ height }}
    >
      No data available. Information will appear here once records have been entered.
    </div>
  );
}

interface PanelData {
  todays_tasks: any[];
  upcoming_checkinout: any[];
  applications_attention: any[];
  recent_complaints: any[];
  priority_maintenance: any[];
  overdue_payments: any[];
  recent_activity: any[];
  announcements: any[];
  alerts: { level: string; title: string; ref?: string; at: string; link: string }[];
}

export default function Overview() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();

  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [panels, setPanels] = useState<PanelData | null>(null);
  const [occupancy, setOccupancy] = useState<any>(null);
  const [occTrend, setOccTrend] = useState<any[]>([]);
  const [appChart, setAppChart] = useState<any[]>([]);
  const [finChart, setFinChart] = useState<any[]>([]);
  const [compChart, setCompChart] = useState<{ by_category: any[]; by_status: any[]; open_total: number; avg_resolution_hours: number | null } | null>(null);
  const [properties, setProperties] = useState<any[]>([]);
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [cleaningToday, setCleaningToday] = useState<any[]>([]);
  const [openJobs, setOpenJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [propertyId, setPropertyId] = useState(params.get('property_id') || '');
  const [from, setFrom] = useState(params.get('from') || monthStartISO());
  const [to, setTo] = useState(params.get('to') || monthEndISO());
  const [months, setMonths] = useState(10);
  const [compSearch, setCompSearch] = useState('');
  const [compStatus, setCompStatus] = useState('');
  const [compPage, setCompPage] = useState(1);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (propertyId) p.set('property_id', propertyId);
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    return p.toString();
  }, [propertyId, from, to]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const suffix = qs ? `?${qs}` : '';
      const results = await Promise.allSettled([
        api.get<DashboardSummary>(`/dashboard/summary${suffix}`),
        api.get<PanelData>('/dashboard/panels'),
        api.get('/occupancy'),
        api.get<{ data: any[] }>(`/dashboard/charts/occupancy-trend?months=${months}`),
        api.get<{ data: any[] }>(`/dashboard/charts/applications?months=${months}`),
        api.get<{ data: any[] }>(`/dashboard/charts/financial?months=${months}`),
        api.get('/dashboard/charts/complaints'),
        api.get<{ data: any[] }>('/properties?pageSize=100'),
        api.get<{ data: Complaint[] }>(`/complaints?pageSize=25${propertyId ? `&property_id=${propertyId}` : ''}`),
        api.get<{ data: any[] }>(`/cleaning/tasks?date=${todayISO()}&pageSize=50`),
        api.get<{ data: any[] }>('/maintenance?open=true&pageSize=100'),
      ]);
      const pick = <T,>(r: PromiseSettledResult<T>): T | null => (r.status === 'fulfilled' ? r.value : null);
      setSummary(pick(results[0]));
      setPanels(pick(results[1]));
      setOccupancy(pick(results[2]));
      setOccTrend(pick(results[3])?.data || []);
      setAppChart(pick(results[4])?.data || []);
      setFinChart(pick(results[5])?.data || []);
      setCompChart(pick(results[6]));
      setProperties(pick(results[7])?.data || []);
      setComplaints(pick(results[8])?.data || []);
      setCleaningToday(pick(results[9])?.data || []);
      setOpenJobs(pick(results[10])?.data || []);
    } finally {
      setLoading(false);
    }
  }, [qs, months, propertyId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const next = new URLSearchParams();
    if (propertyId) next.set('property_id', propertyId);
    if (from) next.set('from', from);
    if (to) next.set('to', to);
    setParams(next, { replace: true });
  }, [propertyId, from, to, setParams]);

  const exportReport = async () => {
    try {
      await downloadFile(`/reports/property_performance?format=csv${propertyId ? `&property_id=${propertyId}` : ''}`,
        `faranani-overview-${todayISO()}.csv`);
      toast('Overview report exported to CSV');
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const timeline = useMemo(() => {
    const items: { time: string; title: string; sub: string; status: string }[] = [];
    for (const t of panels?.todays_tasks || []) {
      items.push({
        time: t.due_date ? new Date(`${t.due_date}T08:00:00`).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', hour12: false }) : '08:00',
        title: t.title, sub: t.assignee_name || t.department || 'Unassigned', status: t.priority === 'urgent' ? 'in_progress' : 'todo',
      });
    }
    for (const c of cleaningToday) {
      items.push({ time: c.due_time || '09:00', title: `Cleaning · ${c.area_name}`, sub: c.cleaner_name || 'Unassigned', status: c.status });
    }
    for (const p of panels?.upcoming_checkinout || []) {
      if (p.check_in_date === todayISO()) {
        items.push({ time: '09:30', title: `Student check-in · ${p.full_name}`, sub: p.property_name || '', status: 'pending' });
      }
    }
    return items.sort((a, b) => a.time.localeCompare(b.time)).slice(0, 7);
  }, [panels, cleaningToday]);

  if (loading && !summary) return <Spinner label="Loading executive overview…" />;

  const s = summary!;
  const occupancyPct = s?.occupancy_pct ?? 0;

  const kpis = [
    {
      label: 'Total Students', value: (s?.total_students ?? 0).toLocaleString(),
      delta: s?.student_delta_pct ?? 0, icon: Users, tint: '#fdf1dc', iconColor: '#b45309',
      to: '/students', sub: `${s?.active_students ?? 0} active now`,
    },
    {
      label: 'Occupancy Rate', value: `${occupancyPct}%`, delta: null, icon: BedDouble, tint: '#e2f5ea', iconColor: '#15803d',
      to: '/rooms', sub: `${s?.occupied_beds ?? 0} of ${s?.total_beds ?? 0} beds`,
    },
    {
      label: 'Pending Applications', value: (s?.pending_applications ?? 0).toLocaleString(), delta: null, icon: FileText, tint: '#fdf1dc', iconColor: '#b45309',
      to: '/applications?status=submitted', sub: `${s?.awaiting_approval ?? 0} awaiting approval`,
    },
    {
      label: 'Open Complaints', value: (s?.open_complaints ?? 0).toLocaleString(), delta: s?.complaint_delta_pct ?? 0, invert: true,
      icon: MessageSquareWarning, tint: '#fdeaea', iconColor: '#b91c1c',
      to: '/complaints?open=true', sub: `${s?.urgent_complaints ?? 0} urgent`,
    },
    {
      label: 'Available Beds', value: (s?.available_beds ?? 0).toLocaleString(), delta: null, icon: BedDouble, tint: '#e4f1fb', iconColor: '#0369a1',
      to: '/rooms', sub: `of ${s?.total_beds ?? 0} total beds`,
    },
    {
      label: 'Outstanding Balances', value: zar(s?.outstanding_balances ?? 0), delta: null, icon: Wallet, tint: '#fdf1dc', iconColor: '#a16207',
      to: '/finance?tab=balances', sub: 'student accounts in arrears',
    },
  ];

  const secondary = [
    { label: 'Properties', value: s?.total_properties ?? 0, icon: Building2, to: '/properties' },
    { label: 'Buildings', value: s?.total_buildings ?? 0, icon: Building2, to: '/properties' },
    { label: 'Urgent Maintenance', value: s?.urgent_maintenance ?? 0, icon: Wrench, to: '/maintenance?open=true', tone: (s?.urgent_maintenance ?? 0) > 0 ? 'text-red-600' : '' },
    { label: 'Payments (period)', value: zar(s?.payments_received ?? 0), icon: Wallet, to: '/finance?tab=payments' },
    { label: 'Overdue Tasks', value: s?.overdue_tasks ?? 0, icon: CalendarClock, to: '/tasks?due=' + todayISO(), tone: (s?.overdue_tasks ?? 0) > 0 ? 'text-orange-600' : '' },
    { label: 'Cleaning Awaiting', value: s?.cleaning_pending ?? 0, icon: Sparkles, to: '/cleaning' },
    { label: 'Awaiting Approval', value: s?.awaiting_approval ?? 0, icon: UserCheck, to: '/applications?status=under_review' },
    { label: 'Avg Resolution', value: compChart?.avg_resolution_hours != null ? `${compChart.avg_resolution_hours}h` : '—', icon: Activity, to: '/reports' },
  ];

  const donutColors = [GOLD, AMBER, '#64748b', RED, SKY, GREEN, '#8b5cf6', '#0f766e', '#78716c'];

  const filteredComplaints = complaints.filter((c) => {
    if (compStatus && c.status !== compStatus) return false;
    if (compSearch) {
      const q = compSearch.toLowerCase();
      return c.ticket_ref.toLowerCase().includes(q)
        || c.subject.toLowerCase().includes(q)
        || (c.student_name || '').toLowerCase().includes(q)
        || (c.student_ref || '').toLowerCase().includes(q);
    }
    return true;
  });
  const compPageSize = 5;
  const compTotalPages = Math.max(1, Math.ceil(filteredComplaints.length / compPageSize));
  const compRows = filteredComplaints.slice((compPage - 1) * compPageSize, compPage * compPageSize);

  const alertTint: Record<string, string> = {
    URGENT: 'text-red-600', HIGH: 'text-orange-600', APPLICATIONS: 'text-sky-600',
    FINANCE: 'text-gold-dark', HOUSEKEEPING: 'text-emerald-600',
  };

  const complaintCols: Column<Complaint>[] = [
    { key: 'ticket_ref', header: 'Ticket ID', render: (c) => <span className="font-semibold text-neutral-700">{c.ticket_ref}</span> },
    { key: 'student', header: 'Student / Reference', render: (c) => <span className="text-neutral-600">{c.student_ref ? `Student ${c.student_ref}` : 'Walk-in'}</span> },
    { key: 'room', header: 'Property / Room', render: (c) => <span className="text-neutral-600">{c.property_name || '—'}{c.room_number ? ` / Room ${c.room_number}` : ''}</span> },
    { key: 'subject', header: 'Complaint', render: (c) => <span className="block max-w-[180px] truncate font-medium text-neutral-700" title={c.subject}>{c.subject}</span> },
    { key: 'priority', header: 'Priority', render: (c) => <PriorityPill value={c.priority} /> },
    { key: 'dept', header: 'Assigned Department', render: (c) => <span className="text-neutral-600">{c.assigned_dept || '—'}</span> },
    { key: 'created_at', header: 'Date Submitted', render: (c) => <span className="whitespace-nowrap text-neutral-500">{fmtWhen(c.created_at)}</span> },
    { key: 'status', header: 'Status', render: (c) => <StatusPill value={c.status} /> },
  ];

  return (
    <div className="space-y-5">
      {/* ---------- header ---------- */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Executive Overview</h1>
          <p className="mt-0.5 text-sm text-neutral-500">
            Monitor student accommodation, property operations and business performance.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={propertyId} onChange={(e) => setPropertyId(e.target.value)}
            aria-label="Filter by property" className="field !w-auto min-w-[160px]">
            <option value="">All Properties</option>
            {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <div className="flex items-center gap-1.5">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Period from" className="field !w-auto" />
            <span className="text-neutral-400">–</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Period to" className="field !w-auto" />
          </div>
          <button onClick={exportReport} className="btn-gold inline-flex items-center gap-1.5">
            <Download size={14} /> Export Report
          </button>
          <span className="pill inline-flex bg-emerald-100 text-emerald-700" title="Connected to the live database">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" /> Live System
          </span>
        </div>
      </div>

      {/* ---------- KPI cards ---------- */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {kpis.map((k) => {
          const Icon = k.icon;
          const up = (k.delta ?? 0) >= 0;
          const good = k.invert ? !up : up;
          return (
            <button key={k.label} className="kpi" onClick={() => navigate(k.to)}>
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full" style={{ background: k.tint }}>
                  <Icon size={19} style={{ color: k.iconColor }} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11.5px] font-semibold text-neutral-500">{k.label}</p>
                  <p className="mt-0.5 text-[26px] font-bold leading-tight tracking-tight text-neutral-900">{k.value}</p>
                  <div className="mt-0.5 flex items-center gap-1 text-[11px]">
                    {k.delta !== null && k.delta !== undefined && (
                      <span className={`inline-flex items-center gap-0.5 font-bold ${good ? 'text-emerald-600' : 'text-red-600'}`}>
                        {up ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                        {up ? '↑' : '↓'} {Math.abs(k.delta)}%
                      </span>
                    )}
                    <span className="truncate text-neutral-400">{k.sub}</span>
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* ---------- secondary metrics ---------- */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 xl:grid-cols-8">
        {secondary.map((m) => {
          const Icon = m.icon;
          return (
            <button key={m.label} onClick={() => navigate(m.to)}
              className="panel flex items-center gap-2.5 px-3 py-2.5 text-left transition hover:border-gold/50 hover:shadow-sm">
              <Icon size={15} className="shrink-0 text-gold" />
              <span className="min-w-0">
                <span className="block truncate text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">{m.label}</span>
                <span className={`block truncate text-sm font-bold ${m.tone || 'text-neutral-800'}`}>{m.value}</span>
              </span>
            </button>
          );
        })}
      </div>

      {/* ---------- charts row 1 ---------- */}
      <div className="grid gap-4 xl:grid-cols-3">
        {/* Occupancy trend */}
        <div className="panel xl:col-span-1">
          <PanelHeader title="Occupancy Overview"
            sub={`Last ${months} months · derived from bed allocations`}
            right={
              <select value={months} onChange={(e) => setMonths(Number(e.target.value))} aria-label="Chart range" className="field !w-auto !py-1 text-xs">
                <option value={6}>6 months</option>
                <option value={10}>10 months</option>
                <option value={12}>12 months</option>
              </select>
            } />
          <div className="px-3 py-4" style={{ height: 250 }}>
            {!chartHasData(occTrend, ['pct']) ? <ChartEmpty /> : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={occTrend} margin={{ top: 6, right: 12, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="occFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={GOLD} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={GOLD} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#eeeeea" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#8b8b84' }} axisLine={false} tickLine={false} />
                <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11, fill: '#8b8b84' }} axisLine={false} tickLine={false} />
                <Tooltip formatter={(v: any) => [`${v}%`, 'Occupancy']} contentStyle={{ borderRadius: 10, border: '1px solid #e8e8e3', fontSize: 12 }} />
                <Area type="monotone" dataKey="pct" stroke={GOLD} strokeWidth={2.5} fill="url(#occFill)" name="Occupancy Rate" dot={{ r: 3, fill: GOLD, strokeWidth: 0 }} activeDot={{ r: 5 }} />
              </AreaChart>
            </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Applications chart */}
        <div className="panel xl:col-span-1">
          <PanelHeader title="Student Applications & Admissions" sub="Received vs approved vs rejected" />
          <div className="px-3 py-4" style={{ height: 250 }}>
            {!chartHasData(appChart, ['received', 'approved', 'rejected']) ? <ChartEmpty /> : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={appChart} margin={{ top: 6, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eeeeea" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#8b8b84' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#8b8b84' }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e8e8e3', fontSize: 12 }} cursor={{ fill: 'rgba(201,162,39,.07)' }} />
                <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={8} />
                <Bar dataKey="received" name="Applications Received" fill={GOLD} radius={[3, 3, 0, 0]} barSize={9} />
                <Bar dataKey="approved" name="Approved" fill={GREEN} radius={[3, 3, 0, 0]} barSize={9} />
                <Bar dataKey="rejected" name="Rejected" fill={RED} radius={[3, 3, 0, 0]} barSize={9} />
              </BarChart>
            </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Priority alerts */}
        <div className="panel flex flex-col xl:col-span-1">
          <PanelHeader title="Priority Alerts" right={
            <button onClick={() => navigate('/tasks')} className="inline-flex items-center gap-1 text-xs font-semibold text-gold-dark hover:underline">
              View All Alerts <ArrowRight size={12} />
            </button>} />
          <div className="flex-1 divide-y divide-neutral-100 overflow-y-auto">
            {(panels?.alerts || []).length === 0 && (
              <EmptyState title="No active alerts" hint="Urgent complaints, maintenance issues and pending applications will appear here." />
            )}
            {(panels?.alerts || []).map((a, i) => (
              <button key={i} onClick={() => navigate(a.link)}
                className="flex w-full items-start gap-3 px-5 py-3 text-left transition hover:bg-gold-soft/40">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-neutral-100">
                  {a.level === 'URGENT' ? <CircleAlert size={15} className="text-red-600" />
                    : a.level === 'FINANCE' ? <Wallet size={15} className="text-gold-dark" />
                    : a.level === 'HOUSEKEEPING' ? <Sparkles size={15} className="text-emerald-600" />
                    : <AlertTriangle size={15} className={alertTint[a.level] || 'text-orange-600'} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block text-[11.5px] font-extrabold tracking-wide ${alertTint[a.level] || 'text-orange-600'}`}>
                    {a.level}
                  </span>
                  <span className="block truncate text-[12.5px] font-medium text-neutral-700">{a.title}</span>
                </span>
                <span className="shrink-0 whitespace-nowrap text-[11px] text-neutral-400">{fmtWhen(a.at)}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ---------- charts row 2 ---------- */}
      <div className="grid gap-4 xl:grid-cols-3">
        {/* Financial performance */}
        <div className="panel">
          <PanelHeader title="Financial Performance (ZAR)" sub="Income received vs expenses approved"
            right={
              <select value={months} onChange={(e) => setMonths(Number(e.target.value))} aria-label="Financial range" className="field !w-auto !py-1 text-xs">
                <option value={6}>6 months</option>
                <option value={10}>10 months</option>
                <option value={12}>12 months</option>
              </select>} />
          <div className="px-3 py-4" style={{ height: 250 }}>
            {!chartHasData(finChart, ['income', 'expenses']) ? <ChartEmpty /> : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={finChart} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eeeeea" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#8b8b84' }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={(v) => zarShort(v)} tick={{ fontSize: 11, fill: '#8b8b84' }} axisLine={false} tickLine={false} />
                <Tooltip formatter={(v: any, n: any) => [zar(Number(v), 2), n]} contentStyle={{ borderRadius: 10, border: '1px solid #e8e8e3', fontSize: 12 }} cursor={{ fill: 'rgba(201,162,39,.07)' }} />
                <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={8} />
                <Bar dataKey="income" name="Income (ZAR)" fill={GOLD} radius={[3, 3, 0, 0]} barSize={11} />
                <Bar dataKey="expenses" name="Expenses (ZAR)" fill={INK} radius={[3, 3, 0, 0]} barSize={11} />
              </BarChart>
            </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Complaints donut */}
        <div className="panel">
          <PanelHeader title="Complaints by Category" sub={`Open tickets by category`} right={
            <button onClick={() => navigate('/complaints?open=true')} className="text-xs font-semibold text-gold-dark hover:underline">View all</button>
          } />
          <div className="flex items-center gap-2 px-3 py-3">
            <div className="relative h-[190px] w-[55%]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={compChart?.by_category || []} dataKey="count" nameKey="category"
                    innerRadius="62%" outerRadius="95%" paddingAngle={2} stroke="none">
                    {(compChart?.by_category || []).map((_, i) => (
                      <Cell key={i} fill={donutColors[i % donutColors.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e8e8e3', fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
              {!(compChart?.by_category || []).length ? (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-3 text-center text-[10.5px] leading-relaxed text-neutral-400">
                  No data available yet.
                </div>
              ) : (
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-[26px] font-bold leading-none text-neutral-800">{compChart?.open_total ?? 0}</span>
                  <span className="mt-0.5 text-[11px] font-semibold text-neutral-400">Total</span>
                </div>
              )}
            </div>
            <div className="flex-1 space-y-1.5 pr-2">
              {(compChart?.by_category || []).slice(0, 7).map((c, i) => (
                <div key={c.category} className="flex items-center gap-2 text-xs">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: donutColors[i % donutColors.length] }} />
                  <span className="min-w-0 flex-1 truncate text-neutral-600">{c.category}</span>
                  <span className="font-bold text-neutral-800">{c.count}</span>
                </div>
              ))}
              {(compChart?.by_category || []).length === 0 && (
                <p className="text-xs text-neutral-400">No open complaints. 🎉</p>
              )}
            </div>
          </div>
        </div>

        {/* Today's operations timeline */}
        <div className="panel">
          <PanelHeader title="Today's Operations" right={
            <button onClick={() => navigate('/tasks')} className="inline-flex items-center gap-1 text-xs font-semibold text-gold-dark hover:underline">
              View Full Calendar <ArrowRight size={12} />
            </button>} />
          <div className="px-5 py-3">
            {timeline.length === 0 && <EmptyState title="Nothing scheduled today" hint="Tasks, cleaning duties and check-ins for today will appear here." />}
            <ol className="relative space-y-3 border-l-2 border-gold/25 pl-4">
              {timeline.map((t, i) => (
                <li key={i} className="relative">
                  <span className="absolute -left-[22px] top-1 h-2.5 w-2.5 rounded-full border-2 border-white bg-gold" />
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[11px] font-bold tabular-nums text-gold-dark">{t.time}</p>
                      <p className="truncate text-[12.5px] font-semibold text-neutral-700">{t.title}</p>
                      <p className="truncate text-[11px] text-neutral-400">{t.sub}</p>
                    </div>
                    <StatusPill value={t.status} />
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>

      {/* ---------- bottom row ---------- */}
      <div className="grid gap-4 xl:grid-cols-3">
        {/* Recent complaints */}
        <div className="panel overflow-hidden xl:col-span-1">
          <PanelHeader title="Recent Complaints & Requests" right={
            <button onClick={() => navigate('/complaints')} className="inline-flex items-center gap-1 text-xs font-semibold text-gold-dark hover:underline">
              View All <ArrowRight size={12} />
            </button>} />
          <div className="flex flex-wrap gap-2 border-b border-line px-4 py-2.5">
            <input value={compSearch} onChange={(e) => { setCompSearch(e.target.value); setCompPage(1); }}
              placeholder="Search complaints…" aria-label="Search complaints"
              className="field !w-auto flex-1 !py-1.5 text-xs" />
            <select value={compStatus} onChange={(e) => { setCompStatus(e.target.value); setCompPage(1); }}
              aria-label="Filter status" className="field !w-auto !py-1.5 text-xs">
              <option value="">All Statuses</option>
              {['open', 'acknowledged', 'assigned', 'in_progress', 'awaiting_student', 'escalated', 'resolved', 'closed'].map((s) => (
                <option key={s} value={s}>{titleCase(s)}</option>
              ))}
            </select>
          </div>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Ticket ID</th><th>Student</th><th>Property / Room</th><th>Complaint</th>
                  <th>Priority</th><th>Department</th><th>Date</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {compRows.map((c) => (
                  <tr key={c.id} className="cursor-pointer" onClick={() => navigate(`/complaints?id=${c.id}`)}>
                    <td className="font-semibold">{c.ticket_ref}</td>
                    <td className="text-neutral-600">{c.student_ref || 'Walk-in'}</td>
                    <td className="text-neutral-600">{c.property_name || '—'}{c.room_number ? ` / ${c.room_number}` : ''}</td>
                    <td><span className="block max-w-[150px] truncate font-medium" title={c.subject}>{c.subject}</span></td>
                    <td><PriorityPill value={c.priority} /></td>
                    <td className="text-neutral-600">{c.assigned_dept || '—'}</td>
                    <td className="whitespace-nowrap text-neutral-500">{fmtWhen(c.created_at)}</td>
                    <td><StatusPill value={c.status} /></td>
                  </tr>
                ))}
                {compRows.length === 0 && (
                  <tr><td colSpan={8}>
                    {complaints.length === 0
                      ? <EmptyState title="No complaints recorded yet" hint="Complaints submitted by students will appear here." />
                      : <EmptyState title="No complaints match" hint="Adjust the search or status filter." />}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between px-4 py-2.5 text-xs text-neutral-500">
            <span>Showing {compRows.length} of {filteredComplaints.length} entries</span>
            <div className="flex items-center gap-1">
              <button className="btn-ghost !px-2 !py-1" disabled={compPage <= 1} onClick={() => setCompPage((p) => p - 1)}>‹</button>
              <span className="px-1 font-medium text-neutral-700">{compPage} / {compTotalPages}</span>
              <button className="btn-ghost !px-2 !py-1" disabled={compPage >= compTotalPages} onClick={() => setCompPage((p) => p + 1)}>›</button>
            </div>
          </div>
        </div>

        {/* Property performance */}
        <div className="panel">
          <PanelHeader title="Property Performance" right={
            <button onClick={() => navigate('/properties')} className="inline-flex items-center gap-1 text-xs font-semibold text-gold-dark hover:underline">
              View All Properties <ArrowRight size={12} />
            </button>} />
          <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
            {(occupancy?.byProperty || []).map((p: any) => {
              const pct = p.total_beds ? Math.round((p.occupied_beds / p.total_beds) * 100) : 0;
              const issues = openJobs.filter((j) => j.property_id === p.property_id).length;
              const R = 26, C = 2 * Math.PI * R;
              return (
                <button key={p.property_id} onClick={() => navigate(`/properties?id=${p.property_id}`)}
                  className="rounded-xl border border-line bg-neutral-50/60 p-3 text-left transition hover:border-gold/60 hover:bg-white hover:shadow-sm">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-md bg-ink text-gold"><Building2 size={14} /></span>
                    <span className="truncate text-[13px] font-bold text-neutral-800">{p.property_name}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="relative h-16 w-16 shrink-0">
                      <svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-90">
                        <circle cx="32" cy="32" r={R} fill="none" stroke="#ececea" strokeWidth="7" />
                        <circle cx="32" cy="32" r={R} fill="none" stroke={GOLD} strokeWidth="7" strokeLinecap="round"
                          strokeDasharray={C} strokeDashoffset={C - (C * pct) / 100} />
                      </svg>
                      <span className="absolute inset-0 flex items-center justify-center text-[13px] font-bold text-neutral-800">{pct}%</span>
                    </div>
                    <div className="min-w-0 text-xs">
                      <p className="font-bold text-neutral-700">{p.occupied_beds} / {p.total_beds} <span className="font-medium text-neutral-400">beds</span></p>
                      <p className="mt-0.5 text-neutral-500">Available: {p.total_beds - p.occupied_beds}</p>
                      <p className={`mt-0.5 font-semibold ${issues > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                        ⚠ Maintenance issues: {issues}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
            {(occupancy?.byProperty || []).length === 0 && <EmptyState title="No active properties" hint="Add properties in Properties & Buildings." />}
          </div>
        </div>

        {/* Recent activity */}
        <div className="panel">
          <PanelHeader title="Recent Activity" right={
            can('audit.view') ? (
              <button onClick={() => navigate('/audit')} className="inline-flex items-center gap-1 text-xs font-semibold text-gold-dark hover:underline">
                View All <ArrowRight size={12} />
              </button>
            ) : undefined} />
          <div className="divide-y divide-neutral-100">
            {(panels?.recent_activity || []).map((a, i) => (
              <button key={i} onClick={() => can('audit.view') && navigate('/audit')}
                className="flex w-full items-start gap-3 px-5 py-2.5 text-left transition hover:bg-gold-soft/40">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gold-soft">
                  {a.action?.startsWith('payment') ? <Wallet size={13} className="text-gold-dark" />
                    : a.action?.startsWith('complaint') ? <MessageSquareWarning size={13} className="text-red-500" />
                    : a.action?.startsWith('application') ? <FileText size={13} className="text-sky-600" />
                    : a.action?.startsWith('cleaning') ? <Sparkles size={13} className="text-emerald-600" />
                    : a.action?.startsWith('allocation') ? <BedDouble size={13} className="text-violet-600" />
                    : <ClipboardCheck size={13} className="text-neutral-500" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] text-neutral-700">{a.summary || a.action}</span>
                  <span className="block text-[10.5px] text-neutral-400">{a.user_email || 'system'}</span>
                </span>
                <span className="shrink-0 whitespace-nowrap text-[10.5px] text-neutral-400">{fmtWhen(a.created_at)}</span>
              </button>
            ))}
            {(panels?.recent_activity || []).length === 0 && (
              <EmptyState title="No activity yet" hint="Sign-ins, edits and approvals are recorded here." />
            )}
          </div>
        </div>
      </div>

      {/* ---------- announcements strip ---------- */}
      {(panels?.announcements || []).length > 0 && (
        <div className="panel flex flex-wrap items-center gap-4 px-5 py-3">
          <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-gold-dark">
            <Megaphone size={14} /> Announcements
          </span>
          {(panels?.announcements || []).map((a) => (
            <button key={a.id} onClick={() => navigate('/announcements')}
              className="text-xs text-neutral-600 hover:text-gold-dark hover:underline">
              · {a.title}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
