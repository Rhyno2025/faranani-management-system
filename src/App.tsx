import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ReactNode } from 'react';
import { useAuth } from './auth';
import { AppShell } from './components/AppShell';
import { Spinner, EmptyState } from './components/ui';

import Login from './pages/Login';
import Overview from './pages/Overview';
import Students from './pages/Students';
import Applications from './pages/Applications';
import Properties from './pages/Properties';
import Rooms from './pages/Rooms';
import Complaints from './pages/Complaints';
import Maintenance from './pages/Maintenance';
import Cleaning from './pages/Cleaning';
import Finance from './pages/Finance';
import OfficeAdmin from './pages/OfficeAdmin';
import HR from './pages/HR';
import Tasks from './pages/Tasks';
import Documents from './pages/Documents';
import Announcements from './pages/Announcements';
import Reports from './pages/Reports';
import AuditLogs from './pages/AuditLogs';
import Settings from './pages/Settings';
import Portal from './pages/Portal';
import DepartmentDashboard from './pages/DepartmentDashboard';

function Guard({ children, perm }: { children: ReactNode; perm?: string | string[] }) {
  const { user, loading, can } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner label="Loading Faranani Property Group…" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  if (perm && !can(perm)) {
    return (
      <div className="p-6">
        <EmptyState
          icon={<span className="text-lg">🔒</span>}
          title="ACCESS DENIED"
          hint="You do not have permission to access this module. Please contact your system administrator."
        />
      </div>
    );
  }
  return <AppShell>{children}</AppShell>;
}

function Home() {
  const { user, can } = useAuth();
  const isExecutive = user?.role === 'super_admin' || user?.role === 'ceo' || can('dashboard.exec');
  if (!isExecutive) return <Navigate to="/dashboard" replace />;
  return <Guard><Overview /></Guard>;
}

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner label="Loading Faranani Property Group…" />
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />

      <Route path="/" element={<Home />} />
      <Route path="/dashboard" element={<Guard><DepartmentDashboard /></Guard>} />
      <Route path="/students" element={<Guard perm="students.view"><Students /></Guard>} />
      <Route path="/applications" element={<Guard perm="applications.view"><Applications /></Guard>} />
      <Route path="/properties" element={<Guard perm="properties.view"><Properties /></Guard>} />
      <Route path="/rooms" element={<Guard perm="rooms.view"><Rooms /></Guard>} />
      <Route path="/complaints" element={<Guard perm="complaints.view"><Complaints /></Guard>} />
      <Route path="/maintenance" element={<Guard perm="maintenance.view"><Maintenance /></Guard>} />
      <Route path="/cleaning" element={<Guard perm="cleaning.view"><Cleaning /></Guard>} />
      <Route path="/finance" element={<Guard perm="finance.view"><Finance /></Guard>} />
      <Route path="/office-admin" element={<Guard perm={['office.view', 'office.dashboard']}><OfficeAdmin /></Guard>} />
      <Route path="/hr" element={<Guard perm={['staff.view', 'hr.dashboard']}><HR /></Guard>} />
      <Route path="/staff" element={<Guard perm={['staff.view', 'hr.dashboard']}><HR /></Guard>} />
      <Route path="/tasks" element={<Guard perm="tasks.view"><Tasks /></Guard>} />
      <Route path="/documents" element={<Guard perm="documents.view"><Documents /></Guard>} />
      <Route path="/announcements" element={<Guard perm="announcements.view"><Announcements /></Guard>} />
      <Route path="/reports" element={<Guard perm="reports.view"><Reports /></Guard>} />
      <Route path="/audit" element={<Guard perm="audit.view"><AuditLogs /></Guard>} />
      <Route path="/settings" element={<Guard><Settings /></Guard>} />
      <Route path="/portal" element={<Guard><Portal /></Guard>} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
