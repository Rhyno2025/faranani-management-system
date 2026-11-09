import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, PieChart, Pie, Cell } from 'recharts';
import { Building2, Home, BedDouble, FileText, Users, Calendar, ClipboardList, AlertTriangle, Bell, Truck, CheckCircle2 } from 'lucide-react';
import { api } from '../../lib/api';
import { EmptyState, Spinner, PanelHeader } from '../../components/ui';
import { fmtDate } from '../../lib/format';

interface Dash {
  counts: Record<string, number>;
  recent_tasks: any[];
  recent_correspondence: any[];
  upcoming_inspections: any[];
  generated_at: string;
}

function Stat({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number | string; tone?: string }) {
  return (
    <div className="rounded-xl border border-line bg-white px-3.5 py-3">
      <div className="flex items-center gap-2 text-neutral-400">{icon}<span className="text-[10.5px] font-semibold uppercase tracking-wide">{label}</span></div>
      <p className={`mt-1 text-xl font-bold ${tone || 'text-neutral-900'}`}>{value}</p>
    </div>
  );
}

const COLORS = ['#bfa46a', '#1f2937', '#16a34a', '#dc2626', '#2563eb', '#f59e0b'];

export function OfficeDashboard({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const [data, setData] = useState<Dash | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get<Dash>('/office/dashboard')
      .then((r) => { setData(r); setError(null); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spinner label="Loading Office Administration dashboard…" />;
  if (error) return <EmptyState icon={<AlertTriangle size={22} />} title="Could not load the dashboard" hint={error} />;
  if (!data) return null;

  const c = data.counts || {};

  const leaseData = [
    { name: 'Active', value: c.active_leases || 0 },
    { name: 'Awaiting Renewal', value: c.leases_awaiting_renewal || 0 },
    { name: 'Expired', value: c.expired_leases || 0 },
  ];

  const occupancyData = [
    { name: 'Occupied', value: c.occupied_beds || 0 },
    { name: 'Available', value: c.available_beds || 0 },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-bold text-neutral-800">Office Administration Dashboard</h2>
        <p className="text-sm text-neutral-500">Live statistics from actual records</p>
      </div>

      {/* Property Administration */}
      <div>
        <h3 className="mb-2 text-sm font-semibold text-neutral-700">Property Administration</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat icon={<Building2 size={14} />} label="Properties" value={c.total_properties || 0} />
          <Stat icon={<Home size={14} />} label="Buildings" value={c.total_buildings || 0} />
          <Stat icon={<Home size={14} />} label="Rooms" value={c.total_rooms || 0} />
          <Stat icon={<BedDouble size={14} />} label="Total Beds" value={c.total_beds || 0} />
          <Stat icon={<BedDouble size={14} />} label="Occupied" value={c.occupied_beds || 0} tone="text-emerald-600" />
          <Stat icon={<BedDouble size={14} />} label="Available" value={c.available_beds || 0} tone="text-blue-600" />
        </div>
      </div>

      {/* Lease Administration */}
      <div>
        <h3 className="mb-2 text-sm font-semibold text-neutral-700">Lease Administration</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          <Stat icon={<FileText size={14} />} label="Active Leases" value={c.active_leases || 0} />
          <Stat icon={<AlertTriangle size={14} />} label="Awaiting Renewal" value={c.leases_awaiting_renewal || 0} tone="text-amber-600" />
          <Stat icon={<AlertTriangle size={14} />} label="Expired" value={c.expired_leases || 0} tone="text-red-600" />
          <Stat icon={<Users size={14} />} label="Pending Student Docs" value={c.pending_student_docs || 0} />
          <Stat icon={<Users size={14} />} label="Pending Tenant Apps" value={c.pending_tenant_applications || 0} />
          <Stat icon={<FileText size={14} />} label="Pending Property Docs" value={c.pending_property_docs || 0} />
        </div>
      </div>

      {/* Operations */}
      <div>
        <h3 className="mb-2 text-sm font-semibold text-neutral-700">Operations & Requests</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          <Stat icon={<ClipboardList size={14} />} label="Outstanding Requests" value={c.outstanding_admin_requests || 0} />
          <Stat icon={<Calendar size={14} />} label="Upcoming Inspections" value={c.upcoming_inspections || 0} />
          <Stat icon={<Bell size={14} />} label="Incoming Corr." value={c.incoming_correspondence || 0} />
          <Stat icon={<Bell size={14} />} label="Outgoing Corr." value={c.outgoing_correspondence || 0} />
          <Stat icon={<CheckCircle2 size={14} />} label="Pending Approvals" value={c.pending_approvals || 0} tone="text-amber-600" />
          <Stat icon={<ClipboardList size={14} />} label="Admin Tasks" value={c.admin_tasks || 0} />
          <Stat icon={<AlertTriangle size={14} />} label="Overdue Tasks" value={c.overdue_tasks || 0} tone="text-red-600" />
        </div>
      </div>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="panel lg:col-span-1">
          <PanelHeader title="Lease Status" sub="Active, renewal due, expired" />
          <div className="h-64 px-3 py-3">
            {leaseData.every((d) => d.value === 0) ? (
              <EmptyState title="No lease data" hint="Leases will appear here when recorded." />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={leaseData} cx="50%" cy="50%" labelLine={false} outerRadius={80} fill="#8884d8" dataKey="value" label>
                    {leaseData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="panel lg:col-span-1">
          <PanelHeader title="Accommodation Occupancy" sub="Occupied vs available beds" />
          <div className="h-64 px-3 py-3">
            {occupancyData.every((d) => d.value === 0) ? (
              <EmptyState title="No bed data" hint="Bed occupancy will appear here." />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={occupancyData} cx="50%" cy="50%" labelLine={false} outerRadius={80} fill="#8884d8" dataKey="value" label>
                    {occupancyData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={index === 0 ? '#16a34a' : '#3b82f6'} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="panel lg:col-span-1">
          <PanelHeader title="Upcoming Inspections" sub="Next scheduled inspections" />
          <div className="p-3 space-y-2 max-h-64 overflow-auto">
            {(data.upcoming_inspections || []).length === 0 ? (
              <EmptyState title="No upcoming inspections" hint="Schedule inspections to see them here." />
            ) : (
              data.upcoming_inspections.map((ins: any) => (
                <div key={ins.id} className="rounded-lg border border-line p-2">
                  <p className="text-sm font-medium text-neutral-800">{ins.ref} - {ins.inspection_type}</p>
                  <p className="text-xs text-neutral-500">{ins.scheduled_date ? fmtDate(ins.scheduled_date) : 'TBA'}</p>
                  <p className="text-xs text-neutral-400">Status: {ins.status}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Recent activity */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="panel">
          <PanelHeader title="Recent Office Tasks" sub="Latest administrative tasks" />
          <div className="p-3 space-y-2">
            {(data.recent_tasks || []).length === 0 ? (
              <EmptyState title="No tasks" hint="Create tasks to track them." />
            ) : (
              data.recent_tasks.slice(0, 8).map((task: any) => (
                <div key={task.id} className="flex items-center justify-between rounded-lg border border-line p-2">
                  <div>
                    <p className="text-sm font-medium text-neutral-800">{task.ref}: {task.title}</p>
                    <p className="text-xs text-neutral-500">Due: {task.due_date ? fmtDate(task.due_date) : 'N/A'} | Priority: {task.priority}</p>
                  </div>
                  <span className="text-xs text-neutral-400">{task.status}</span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="panel">
          <PanelHeader title="Recent Correspondence" sub="Latest incoming/outgoing" />
          <div className="p-3 space-y-2">
            {(data.recent_correspondence || []).length === 0 ? (
              <EmptyState title="No correspondence" hint="Log correspondence here." />
            ) : (
              data.recent_correspondence.slice(0, 8).map((cor: any) => (
                <div key={cor.id} className="flex items-center justify-between rounded-lg border border-line p-2">
                  <div>
                    <p className="text-sm font-medium text-neutral-800">{cor.ref}: {cor.subject || cor.category}</p>
                    <p className="text-xs text-neutral-500">{cor.direction} | {cor.sender || cor.recipient || ''}</p>
                  </div>
                  <span className="text-xs text-neutral-400">{cor.status}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
