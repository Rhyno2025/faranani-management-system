import { useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
import { api } from '../../lib/api';
import { EmptyState, Spinner } from '../../components/ui';
import { DataTable } from '../../components/DataTable';

const endpointMap: Record<string,string> = {
  LeaseAdmin: '/office/leases',
  DocumentManagement: '/office/documents',
  InspectionAdmin: '/office/inspections',
  Correspondence: '/office/correspondence',
  Procurement: '/office/procurement',
  Suppliers: '/office/suppliers',
  Assets: '/office/assets',
  OfficeTasks: '/office/tasks',
  Meetings: '/office/meetings',
  ComplaintsRequests: '/office/complaints',
  Compliance: '/office/compliance',
};

const titleMap: Record<string,{title:string,sub:string,icon:any}> = {
  LeaseAdmin: {title:'Lease & Agreement Administration', sub:'Lease register, renewals, expiries and agreements', icon: FileText},
  DocumentManagement: {title:'Property & Office Document Management', sub:'Central repository for documents', icon: FileText},
  InspectionAdmin: {title:'Property Inspection Administration', sub:'Schedule, assign and track inspections', icon: FileText},
  Correspondence: {title:'Incoming & Outgoing Correspondence', sub:'Track correspondence', icon: FileText},
  Procurement: {title:'Procurement & Purchase Requests', sub:'Requisitions and approvals', icon: FileText},
  Suppliers: {title:'Supplier & Contractor Administration', sub:'Manage suppliers and contracts', icon: FileText},
  Assets: {title:'Property Asset & Equipment Administration', sub:'Track assets', icon: FileText},
  OfficeTasks: {title:'Office & Property Operations Task Management', sub:'Assign and track tasks', icon: FileText},
  Meetings: {title:'Meetings, Appointments & Property Scheduling', sub:'Calendar management', icon: FileText},
  ComplaintsRequests: {title:'Property Complaints & Administrative Requests', sub:'Track complaints and requests', icon: FileText},
  Compliance: {title:'Property Compliance & Renewal Tracking', sub:'Track certificates and renewals', icon: FileText},
};

export function Procurement() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const meta = titleMap['Procurement'];
  const Icon = meta.icon;

  useEffect(() => {
    setLoading(true);
    api.get<{ data: any[] }>(endpointMap['Procurement'] || '/office/dashboard')
      .then((res) => setData(res.data || []))
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spinner label="Loading..." />;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-bold text-neutral-800">{meta.title}</h3>
        <p className="text-xs text-neutral-500">{meta.sub}</p>
      </div>
      {data.length === 0 ? (
        <EmptyState icon={<Icon size={22} />} title="No records" hint="Records will appear here when added." />
      ) : (
        <DataTable rows={data} columns={Object.keys(data[0] || {}).slice(0,6).map(k => ({ key: k, header: k.replace(/_/g,' ').replace(/\b\w/g, c=>c.toUpperCase()) }))} rowKey={(r:any)=>r.id || r.ref} loading={false} />
      )}
    </div>
  );
}
