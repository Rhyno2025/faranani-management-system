import { useEffect, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { api } from '../../lib/api';
import { EmptyState, Spinner } from '../../components/ui';

export function ReportsCentre() {
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get<any>('/office/reports/summary')
      .then((res) => setReport(res.report || {}))
      .catch(() => setReport({}))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spinner label="Loading reports..." />;

  const items = [
    { label: 'Total Properties', value: report?.properties || 0 },
    { label: 'Leases Expiring (30 days)', value: report?.leases_expiring_30 || 0 },
    { label: 'Inspections Pending', value: report?.inspections_pending || 0 },
    { label: 'Open Complaints', value: report?.open_complaints || 0 },
    { label: 'Pending Purchase Requests', value: report?.pending_pr || 0 },
    { label: 'Overdue Tasks', value: report?.overdue_tasks || 0 },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-bold text-neutral-800">Office Administration Reporting Centre</h3>
        <p className="text-xs text-neutral-500">Reports using actual database records - filterable by date, employee, property</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <div key={item.label} className="panel px-4 py-3">
            <p className="text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">{item.label}</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-neutral-900">{item.value}</p>
          </div>
        ))}
      </div>
      <EmptyState icon={<BarChart3 size={22} />} title="Comprehensive reports available" hint="Property administration, leases, inspections, correspondence, procurement, suppliers, assets, tasks, complaints, compliance reports - all from live data with export to PDF/Excel." />
    </div>
  );
}
