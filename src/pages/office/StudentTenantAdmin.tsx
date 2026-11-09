import { useEffect, useState } from 'react';
import { Users } from 'lucide-react';
import { api } from '../../lib/api';
import { EmptyState, Spinner, Tabs } from '../../components/ui';
import { DataTable } from '../../components/DataTable';

export function StudentTenantAdmin() {
  const [tab, setTab] = useState<'students' | 'applications'>('students');
  const [students, setStudents] = useState<any[]>([]);
  const [apps, setApps] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [s, a] = await Promise.all([
        api.get<{ data: any[] }>('/office/student-files').catch(() => ({ data: [] })),
        api.get<{ data: any[] }>('/office/tenant-applications').catch(() => ({ data: [] })),
      ]);
      setStudents(s.data || []);
      setApps(a.data || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  if (loading) return <Spinner label="Loading..." />;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-bold text-neutral-800">Student & Tenant Administration</h3>
        <p className="text-xs text-neutral-500">Administrative files, applications, documentation and onboarding</p>
      </div>
      <Tabs active={tab} onChange={(k) => setTab(k as any)} tabs={[{ key: 'students', label: 'Student Files' }, { key: 'applications', label: 'Tenant Applications' }]} />
      {tab === 'students' && (
        students.length === 0 ? <EmptyState icon={<Users size={22} />} title="No student files" hint="Student administrative files will appear here." /> :
        <DataTable rows={students} columns={[{ key: 'ref', header: 'Ref' }, { key: 'student_id', header: 'Student ID' }, { key: 'status', header: 'Status' }]} rowKey={(r:any) => r.id} loading={false} />
      )}
      {tab === 'applications' && (
        apps.length === 0 ? <EmptyState icon={<Users size={22} />} title="No applications" hint="Tenant applications will appear here." /> :
        <DataTable rows={apps} columns={[{ key: 'ref', header: 'Ref' }, { key: 'applicant_name', header: 'Applicant' }, { key: 'status', header: 'Status' }, { key: 'created_at', header: 'Submitted' }]} rowKey={(r:any) => r.id} loading={false} />
      )}
    </div>
  );
}
