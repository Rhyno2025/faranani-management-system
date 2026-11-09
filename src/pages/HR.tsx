import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader, Tabs, Spinner, EmptyState } from '../components/ui';
import { useAuth } from '../auth';
import { HRDashboard } from './hr/HRDashboard';
import { Employees } from './hr/Employees';
import { Recruitment } from './hr/Recruitment';
import { Attendance } from './hr/Attendance';
import { Leave } from './hr/Leave';
import { Payroll } from './hr/Payroll';
import { Performance } from './hr/Performance';
import { Cases } from './hr/Cases';

type Tab = 'dashboard' | 'employees' | 'recruitment' | 'attendance' | 'leave' | 'payroll' | 'performance' | 'cases';

const TABS: { key: Tab; label: string; perm?: string[] }[] = [
  { key: 'dashboard', label: 'HR Dashboard', perm: ['hr.dashboard', 'staff.view'] },
  { key: 'employees', label: 'Employees', perm: ['staff.view'] },
  { key: 'recruitment', label: 'Recruitment', perm: ['staff.view'] },
  { key: 'attendance', label: 'Attendance & Shifts', perm: ['staff.view'] },
  { key: 'leave', label: 'Leave', perm: ['staff.view'] },
  { key: 'payroll', label: 'Payroll', perm: ['hr.payroll.view'] },
  { key: 'performance', label: 'Performance & Training', perm: ['staff.view'] },
  { key: 'cases', label: 'Employee Relations', perm: ['hr.cases'] },
];

export default function HR() {
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
    return <EmptyState title="No HR access" hint="Your role does not include permission for any part of the HR module." />;
  }

  return (
    <div>
      <PageHeader
        title="Human Resources"
        subtitle="Employees, recruitment, attendance, leave, payroll, performance and employee relations — all from live records."
      />

      <div className="panel overflow-hidden">
        <div className="border-b border-line px-4 pt-2">
          <Tabs
            active={tab}
            onChange={(k) => setTab(k as Tab)}
            tabs={visible.map((t) => ({ key: t.key, label: t.label }))}
          />
        </div>

        <div className="px-4 py-4">
          {tab === 'dashboard' && <HRDashboard onNavigate={(t) => setTab(t as Tab)} />}
          {tab === 'employees' && <Employees />}
          {tab === 'recruitment' && <Recruitment />}
          {tab === 'attendance' && <Attendance />}
          {tab === 'leave' && <Leave />}
          {tab === 'payroll' && <Payroll />}
          {tab === 'performance' && <Performance />}
          {tab === 'cases' && <Cases />}
        </div>
      </div>
    </div>
  );
}
