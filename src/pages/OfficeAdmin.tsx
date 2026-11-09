import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader, Tabs, Spinner, EmptyState } from '../components/ui';
import { useAuth } from '../auth';
import { OfficeDashboard } from './office/OfficeDashboard';
import { PropertyAdmin } from './office/PropertyAdmin';
import { StudentTenantAdmin } from './office/StudentTenantAdmin';
import { LeaseAdmin } from './office/LeaseAdmin';
import { DocumentManagement } from './office/DocumentManagement';
import { InspectionAdmin } from './office/InspectionAdmin';
import { Correspondence } from './office/Correspondence';
import { Procurement } from './office/Procurement';
import { Suppliers } from './office/Suppliers';
import { Assets } from './office/Assets';
import { OfficeTasks } from './office/OfficeTasks';
import { Meetings } from './office/Meetings';
import { ComplaintsRequests } from './office/ComplaintsRequests';
import { Compliance } from './office/Compliance';
import { ReportsCentre } from './office/ReportsCentre';

type Tab = 'dashboard' | 'properties' | 'students-tenants' | 'leases' | 'documents' | 'inspections' | 'correspondence' | 'procurement' | 'suppliers' | 'assets' | 'tasks' | 'meetings' | 'complaints' | 'compliance' | 'reports';

const TABS: { key: Tab; label: string; perm?: string[] }[] = [
  { key: 'dashboard', label: 'Dashboard', perm: ['office.dashboard', 'office.view'] },
  { key: 'properties', label: 'Property Administration', perm: ['office.properties'] },
  { key: 'students-tenants', label: 'Student & Tenant Admin', perm: ['office.students_tenants'] },
  { key: 'leases', label: 'Lease Administration', perm: ['office.leases'] },
  { key: 'documents', label: 'Documents & Records', perm: ['office.documents'] },
  { key: 'inspections', label: 'Inspections', perm: ['office.inspections'] },
  { key: 'correspondence', label: 'Correspondence', perm: ['office.correspondence'] },
  { key: 'procurement', label: 'Procurement', perm: ['office.procurement'] },
  { key: 'suppliers', label: 'Suppliers & Contractors', perm: ['office.suppliers'] },
  { key: 'assets', label: 'Assets & Equipment', perm: ['office.assets'] },
  { key: 'tasks', label: 'Tasks & Operations', perm: ['office.tasks'] },
  { key: 'meetings', label: 'Meetings & Scheduling', perm: ['office.meetings'] },
  { key: 'complaints', label: 'Complaints & Requests', perm: ['office.complaints'] },
  { key: 'compliance', label: 'Compliance & Renewals', perm: ['office.compliance'] },
  { key: 'reports', label: 'Reports Centre', perm: ['office.reports'] },
];

export default function OfficeAdmin() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const requested = (params.get('tab') as Tab) || 'dashboard';
  const visible = TABS.filter((t) => !t.perm || can(t.perm));
  const [tab, setTab] = useState<Tab>(visible.some((t) => t.key === requested) ? requested : (visible[0]?.key || 'dashboard'));

  useEffect(() => {
    if (tab !== requested) {
      const next = new URLSearchParams(params);
      next.set('tab', tab);
      setParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  if (!visible.length) {
    return <EmptyState title="No Office Administration access" hint="Your role does not include permission for any part of the Office Administration module." />;
  }

  return (
    <div>
      <PageHeader
        title="Office Administration"
        subtitle="Property administration, student & tenant administration, leases, documents, inspections, procurement, correspondence and operations — for Faranani Property Group."
      />

      <div className="panel overflow-hidden">
        <div className="border-b border-line px-4 pt-2 overflow-x-auto">
          <Tabs
            active={tab}
            onChange={(k) => setTab(k as Tab)}
            tabs={visible.map((t) => ({ key: t.key, label: t.label }))}
          />
        </div>

        <div className="px-4 py-4">
          {tab === 'dashboard' && <OfficeDashboard onNavigate={(t) => setTab(t as Tab)} />}
          {tab === 'properties' && <PropertyAdmin />}
          {tab === 'students-tenants' && <StudentTenantAdmin />}
          {tab === 'leases' && <LeaseAdmin />}
          {tab === 'documents' && <DocumentManagement />}
          {tab === 'inspections' && <InspectionAdmin />}
          {tab === 'correspondence' && <Correspondence />}
          {tab === 'procurement' && <Procurement />}
          {tab === 'suppliers' && <Suppliers />}
          {tab === 'assets' && <Assets />}
          {tab === 'tasks' && <OfficeTasks />}
          {tab === 'meetings' && <Meetings />}
          {tab === 'complaints' && <ComplaintsRequests />}
          {tab === 'compliance' && <Compliance />}
          {tab === 'reports' && <ReportsCentre />}
        </div>
      </div>
    </div>
  );
}
