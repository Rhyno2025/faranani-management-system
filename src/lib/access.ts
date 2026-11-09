// ---------------------------------------------------------------------------
// Shared access metadata: role labels, module catalogue and landing routes.
// The server is always the authority; this only shapes navigation.
// ---------------------------------------------------------------------------

export const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Administrator',
  ceo: 'Company Director',
  hr_manager: 'HR Manager',
  hr_officer: 'HR Officer',
  payroll_officer: 'Payroll Officer',
  finance_manager: 'Finance Manager',
  accountant: 'Accountant',
  ap_officer: 'Accounts Payable Officer',
  ar_officer: 'Accounts Receivable Officer',
  office_admin_manager: 'Office Administration Manager',
  property_administrator: 'Property Administrator',
  property_documentation_officer: 'Property Documentation Officer',
  lease_administration_officer: 'Lease Administration Officer',
  student_tenant_admin_officer: 'Student and Tenant Administration Officer',
  property_inspection_administrator: 'Property Inspection Administrator',
  procurement_purchasing_officer: 'Procurement and Purchasing Officer',
  supplier_contractor_administrator: 'Supplier and Contractor Administrator',
  property_asset_administrator: 'Property Asset Administrator',
  administrative_assistant: 'Administrative Assistant',
  reception_correspondence_administrator: 'Reception and Correspondence Administrator',
  compliance_documentation_officer: 'Compliance Documentation Officer',
  logistics_scheduling_administrator: 'Logistics and Scheduling Administrator',
  department_manager: 'Department Manager',
  employee: 'Employee',
  receptionist: 'Reception / Admissions',
  finance: 'Finance Officer',
  cleaner: 'Cleaning Staff',
  maintenance: 'Maintenance Staff',
  property_manager: 'Property Manager',
  security_officer: 'Security Officer',
  marketing_officer: 'Marketing Officer',
  housekeeping_supervisor: 'Housekeeping Supervisor',
  auditor: 'Read-Only Auditor',
};

export function roleLabel(role: string): string {
  return ROLE_LABELS[role] || role.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

export interface ModuleLink {
  to: string;
  label: string;
  description: string;
  perm?: string | string[];
}

/** Modules an employee can open, in operational order. */
export const MODULES: ModuleLink[] = [
  { to: '/', label: 'Executive Overview', description: 'Company-wide operations, occupancy and financial pulse.', perm: 'dashboard.exec' },
  { to: '/students', label: 'Students', description: 'Student records, balances and accommodation history.', perm: 'students.view' },
  { to: '/applications', label: 'Applications & Admissions', description: 'Process applications and register new students.', perm: 'applications.view' },
  { to: '/properties', label: 'Properties & Buildings', description: 'Property portfolio, buildings and facilities.', perm: 'properties.view' },
  { to: '/rooms', label: 'Rooms & Bed Allocation', description: 'Room inventory, occupancy and check-in.', perm: 'rooms.view' },
  { to: '/complaints', label: 'Complaints & Requests', description: 'Tenant and student service requests.', perm: 'complaints.view' },
  { to: '/maintenance', label: 'Maintenance', description: 'Work orders, repairs and job completion.', perm: 'maintenance.view' },
  { to: '/cleaning', label: 'Cleaning & Housekeeping', description: 'Cleaning schedules, tasks and inspections.', perm: 'cleaning.view' },
  { to: '/finance', label: 'Finance & Accounting', description: 'Ledger, receivables, payables and reporting.', perm: 'finance.view' },
  { to: '/office-admin', label: 'Office Administration', description: 'Property admin, leases, documents, inspections, procurement, correspondence.', perm: ['office.view', 'office.dashboard'] },
  { to: '/hr', label: 'Human Resources', description: 'Employees, leave, attendance, payroll and recruitment.', perm: ['staff.view', 'hr.dashboard'] },
  { to: '/tasks', label: 'Tasks & Calendar', description: 'Assigned work and the company calendar.', perm: 'tasks.view' },
  { to: '/documents', label: 'Documents', description: 'Private company and tenant documents.', perm: 'documents.view' },
  { to: '/announcements', label: 'Announcements', description: 'Internal communication and notices.', perm: 'announcements.view' },
  { to: '/reports', label: 'Reports & Analytics', description: 'Operational and financial reporting.', perm: 'reports.view' },
  { to: '/audit', label: 'Audit Logs', description: 'System activity and security trail.', perm: 'audit.view' },
  { to: '/settings', label: 'Administration', description: 'Users, departments, permissions and integrations.', perm: ['settings.manage', 'users.manage'] },
];

/** Landing route after sign-in, based on role and effective permissions. */
export function defaultRouteFor(permissions: string[], role: string): string {
  if (role === 'super_admin' || role === 'ceo') return '/';
  if (permissions.includes('dashboard.exec')) return '/';
  return '/dashboard';
}
