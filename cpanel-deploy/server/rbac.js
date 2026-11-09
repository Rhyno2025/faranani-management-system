// ---------------------------------------------------------------------------
// Faranani Property Group — Role Based Access Control
// Permissions are enforced server-side on every endpoint AND mirrored in
// PostgreSQL Row Level Security policies (see supabase/rls.sql).
// ---------------------------------------------------------------------------

export const PERMISSIONS = [
  { key: 'dashboard.exec', label: 'Executive dashboard', category: 'Dashboard' },
  { key: 'students.view', label: 'View students', category: 'Students' },
  { key: 'students.manage', label: 'Manage students', category: 'Students' },
  { key: 'students.financial', label: 'View student finances', category: 'Students' },
  { key: 'applications.view', label: 'View applications', category: 'Applications' },
  { key: 'applications.process', label: 'Process applications', category: 'Applications' },
  { key: 'properties.view', label: 'View properties', category: 'Properties' },
  { key: 'properties.manage', label: 'Manage properties', category: 'Properties' },
  { key: 'rooms.view', label: 'View rooms & beds', category: 'Rooms' },
  { key: 'rooms.manage', label: 'Manage rooms & beds', category: 'Rooms' },
  { key: 'rooms.allocate', label: 'Allocate beds / check-in', category: 'Rooms' },
  { key: 'complaints.view', label: 'View complaints', category: 'Complaints' },
  { key: 'complaints.manage', label: 'Manage complaints', category: 'Complaints' },
  { key: 'maintenance.view', label: 'View maintenance', category: 'Maintenance' },
  { key: 'maintenance.manage', label: 'Manage maintenance', category: 'Maintenance' },
  { key: 'cleaning.view', label: 'View cleaning tasks', category: 'Cleaning' },
  { key: 'cleaning.manage', label: 'Manage cleaning', category: 'Cleaning' },
  { key: 'cleaning.own', label: 'Own cleaning tasks only', category: 'Cleaning' },
  { key: 'finance.view', label: 'View finance', category: 'Finance' },
  { key: 'finance.manage', label: 'Manage finance', category: 'Finance' },
  { key: 'staff.view', label: 'View staff', category: 'Staff' },
  { key: 'staff.manage', label: 'Manage staff', category: 'Staff' },
  { key: 'staff.sensitive', label: 'View sensitive HR data', category: 'Staff' },
  { key: 'hr.dashboard', label: 'View HR dashboard', category: 'Human Resources' },
  { key: 'hr.recruitment', label: 'Manage recruitment & vacancies', category: 'Human Resources' },
  { key: 'hr.attendance', label: 'Manage attendance & shifts', category: 'Human Resources' },
  { key: 'hr.attendance.correct', label: 'Correct recorded attendance', category: 'Human Resources' },
  { key: 'hr.leave.apply', label: 'Apply for leave', category: 'Human Resources' },
  { key: 'hr.leave.approve', label: 'Approve / reject leave', category: 'Human Resources' },
  { key: 'hr.payroll.view', label: 'View payroll', category: 'Human Resources' },
  { key: 'hr.payroll.process', label: 'Prepare payroll runs', category: 'Human Resources' },
  { key: 'hr.payroll.approve', label: 'Approve & pay payroll', category: 'Human Resources' },
  { key: 'hr.performance', label: 'Manage performance & training', category: 'Human Resources' },
  { key: 'hr.cases', label: 'Manage employee relations cases', category: 'Human Resources' },
  { key: 'hr.cases.confidential', label: 'View confidential HR cases', category: 'Human Resources' },
  { key: 'hr.salary', label: 'View salary & banking details', category: 'Human Resources' },
  { key: 'finance.gl.view', label: 'View general ledger', category: 'Finance' },
  { key: 'finance.gl.post', label: 'Create draft journals', category: 'Finance' },
  { key: 'finance.gl.approve', label: 'Post / reverse journals', category: 'Finance' },
  { key: 'finance.ar', label: 'Manage accounts receivable', category: 'Finance' },
  { key: 'finance.ap', label: 'Manage accounts payable', category: 'Finance' },
  { key: 'finance.approve', label: 'Approve payments & transactions', category: 'Finance' },
  { key: 'finance.banking', label: 'Banking & reconciliation', category: 'Finance' },
  { key: 'finance.budget', label: 'Manage budgets', category: 'Finance' },
  { key: 'finance.assets', label: 'Manage fixed assets', category: 'Finance' },
  { key: 'finance.periods', label: 'Open / close accounting periods', category: 'Finance' },
  { key: 'finance.settings', label: 'Finance settings & tax config', category: 'Finance' },
  { key: 'office.view', label: 'View Office Administration', category: 'Office Administration' },
  { key: 'office.dashboard', label: 'View Office Administration dashboard', category: 'Office Administration' },
  { key: 'office.manage', label: 'Manage Office Administration', category: 'Office Administration' },
  { key: 'office.properties', label: 'Manage property administration', category: 'Office Administration' },
  { key: 'office.students_tenants', label: 'Manage student & tenant administration', category: 'Office Administration' },
  { key: 'office.leases', label: 'Manage lease administration', category: 'Office Administration' },
  { key: 'office.documents', label: 'Manage office/property documents', category: 'Office Administration' },
  { key: 'office.inspections', label: 'Manage property inspections', category: 'Office Administration' },
  { key: 'office.correspondence', label: 'Manage correspondence', category: 'Office Administration' },
  { key: 'office.procurement', label: 'Manage procurement', category: 'Office Administration' },
  { key: 'office.suppliers', label: 'Manage suppliers & contractors', category: 'Office Administration' },
  { key: 'office.assets', label: 'Manage property assets', category: 'Office Administration' },
  { key: 'office.tasks', label: 'Manage office tasks', category: 'Office Administration' },
  { key: 'office.meetings', label: 'Manage meetings & scheduling', category: 'Office Administration' },
  { key: 'office.complaints', label: 'Manage administrative complaints/requests', category: 'Office Administration' },
  { key: 'office.compliance', label: 'Manage compliance & renewals', category: 'Office Administration' },
  { key: 'office.logistics', label: 'Manage logistics/vehicles', category: 'Office Administration' },
  { key: 'office.reports', label: 'View Office Administration reports', category: 'Office Administration' },
  { key: 'office.approve', label: 'Approve office administration requests', category: 'Office Administration' },
  { key: 'security.view', label: 'View security incidents', category: 'Security' },
  { key: 'security.manage', label: 'Manage security incidents', category: 'Security' },
  { key: 'marketing.view', label: 'View marketing', category: 'Marketing' },
  { key: 'marketing.manage', label: 'Manage marketing campaigns', category: 'Marketing' },
  { key: 'ai.use', label: 'Use CALVIN AI assistant', category: 'AI Assistant' },
  { key: 'ai.write', label: 'Allow CALVIN to create draft records', category: 'AI Assistant' },
  { key: 'tasks.view', label: 'View tasks', category: 'Tasks' },
  { key: 'tasks.manage', label: 'Manage tasks', category: 'Tasks' },
  { key: 'documents.view', label: 'View documents', category: 'Documents' },
  { key: 'documents.manage', label: 'Manage documents', category: 'Documents' },
  { key: 'documents.download', label: 'Download protected documents', category: 'Documents' },
  { key: 'announcements.view', label: 'View announcements', category: 'Announcements' },
  { key: 'announcements.manage', label: 'Manage announcements', category: 'Announcements' },
  { key: 'reports.view', label: 'View reports', category: 'Reports' },
  { key: 'reports.export', label: 'Export reports', category: 'Reports' },
  { key: 'audit.view', label: 'View audit logs', category: 'Security' },
  { key: 'settings.manage', label: 'Manage settings', category: 'Security' },
  { key: 'users.manage', label: 'Manage users & roles', category: 'Security' },
];

export const ROLES = [
  { name: 'super_admin', label: 'Super Administrator' },
  { name: 'ceo', label: 'Company Director' },
  { name: 'hr_manager', label: 'HR Manager' },
  { name: 'hr_officer', label: 'HR Officer' },
  { name: 'payroll_officer', label: 'Payroll Officer' },
  { name: 'finance_manager', label: 'Finance Manager' },
  { name: 'accountant', label: 'Accountant' },
  { name: 'ap_officer', label: 'Accounts Payable Officer' },
  { name: 'ar_officer', label: 'Accounts Receivable Officer' },
  { name: 'office_admin_manager', label: 'Office Administration Manager' },
  { name: 'property_administrator', label: 'Property Administrator' },
  { name: 'property_documentation_officer', label: 'Property Documentation Officer' },
  { name: 'lease_administration_officer', label: 'Lease Administration Officer' },
  { name: 'student_tenant_admin_officer', label: 'Student and Tenant Administration Officer' },
  { name: 'property_inspection_administrator', label: 'Property Inspection Administrator' },
  { name: 'procurement_purchasing_officer', label: 'Procurement and Purchasing Officer' },
  { name: 'supplier_contractor_administrator', label: 'Supplier and Contractor Administrator' },
  { name: 'property_asset_administrator', label: 'Property Asset Administrator' },
  { name: 'administrative_assistant', label: 'Administrative Assistant' },
  { name: 'reception_correspondence_administrator', label: 'Reception and Correspondence Administrator' },
  { name: 'compliance_documentation_officer', label: 'Compliance Documentation Officer' },
  { name: 'logistics_scheduling_administrator', label: 'Logistics and Scheduling Administrator' },
  { name: 'department_manager', label: 'Department Manager' },
  { name: 'employee', label: 'Employee' },
  { name: 'receptionist', label: 'Receptionist / Admissions' },
  { name: 'finance', label: 'Finance Officer' },
  { name: 'cleaner', label: 'Cleaning Staff' },
  { name: 'maintenance', label: 'Maintenance Staff' },
  { name: 'property_manager', label: 'Property Manager' },
  { name: 'security_officer', label: 'Security Officer' },
  { name: 'marketing_officer', label: 'Marketing & Communications Officer' },
  { name: 'housekeeping_supervisor', label: 'Housekeeping Supervisor' },
  { name: 'auditor', label: 'Read-Only Auditor' },
];

/** Department → landing dashboard, used for post-login redirection. */
export const DEPARTMENT_ROUTES = {
  'Executive Management': '/',
  Management: '/',
  'Human Resources': '/hr',
  Finance: '/finance',
  'Office Administration': '/office-admin',
  Admissions: '/applications',
  Reception: '/applications',
  'Property Management': '/properties',
  Facilities: '/properties',
  Housekeeping: '/cleaning',
  Cleaning: '/cleaning',
  Maintenance: '/maintenance',
  Security: '/dashboard',
  Marketing: '/dashboard',
};

export const DEPARTMENT_SEED = [
  { name: 'Executive Management', code: 'EXEC', route: '/' },
  { name: 'Human Resources', code: 'HR', route: '/hr' },
  { name: 'Finance', code: 'FIN', route: '/finance' },
  { name: 'Office Administration', code: 'OAD', route: '/office-admin' },
  { name: 'Admissions', code: 'ADM', route: '/applications' },
  { name: 'Reception', code: 'REC', route: '/applications' },
  { name: 'Property Management', code: 'PROP', route: '/properties' },
  { name: 'Facilities', code: 'FAC', route: '/properties' },
  { name: 'Housekeeping', code: 'HK', route: '/cleaning' },
  { name: 'Maintenance', code: 'MNT', route: '/maintenance' },
  { name: 'Security', code: 'SEC', route: '/dashboard' },
  { name: 'Marketing', code: 'MKT', route: '/dashboard' },
];

const ALL = PERMISSIONS.map((p) => p.key);

const RECEPTION = [
  'students.view', 'students.manage', 'applications.view', 'applications.process',
  'properties.view', 'rooms.view', 'rooms.allocate', 'complaints.view',
  'complaints.manage', 'tasks.view', 'documents.view', 'documents.download',
  'announcements.view', 'reports.view', 'ai.use',
];

const FINANCE = [
  'students.view', 'students.financial', 'finance.view', 'finance.manage',
  'finance.gl.view', 'finance.gl.post', 'finance.ar', 'finance.ap', 'finance.banking',
  'properties.view', 'rooms.view', 'tasks.view', 'documents.view',
  'documents.download', 'announcements.view', 'reports.view', 'reports.export', 'ai.use',
];

// HR department permission sets
const HR_MANAGE = [
  'hr.dashboard', 'staff.view', 'staff.manage', 'hr.recruitment', 'hr.attendance',
  'hr.leave.apply', 'hr.leave.approve', 'hr.performance', 'hr.cases',
  'tasks.view', 'tasks.manage', 'documents.view', 'documents.manage', 'documents.download',
  'announcements.view', 'reports.view', 'reports.export', 'audit.view', 'ai.use',
  'students.view', 'properties.view',
];

const HR_OFFICER = [
  'hr.dashboard', 'staff.view', 'staff.manage', 'hr.recruitment', 'hr.attendance',
  'hr.leave.apply', 'hr.leave.approve', 'hr.performance', 'hr.cases',
  'tasks.view', 'documents.view', 'documents.download', 'announcements.view',
  'reports.view', 'ai.use', 'properties.view',
];

const PAYROLL = [
  'hr.dashboard', 'staff.view', 'hr.payroll.view', 'hr.payroll.process',
  'hr.attendance', 'finance.view', 'finance.gl.view',
  'tasks.view', 'documents.view', 'documents.download', 'announcements.view',
  'reports.view', 'reports.export', 'ai.use',
];

const EMPLOYEE = [
  'hr.dashboard', 'hr.leave.apply', 'staff.view', 'tasks.view',
  'documents.view', 'announcements.view', 'properties.view',
];

const OFFICE_FULL = [
  'office.view', 'office.dashboard', 'office.manage', 'office.properties', 'office.students_tenants',
  'office.leases', 'office.documents', 'office.inspections', 'office.correspondence', 'office.procurement',
  'office.suppliers', 'office.assets', 'office.tasks', 'office.meetings', 'office.complaints',
  'office.compliance', 'office.logistics', 'office.reports', 'office.approve',
  'properties.view', 'rooms.view', 'students.view', 'complaints.view', 'complaints.manage',
  'maintenance.view', 'tasks.view', 'tasks.manage', 'documents.view', 'documents.manage',
  'documents.download', 'announcements.view', 'reports.view', 'reports.export', 'ai.use',
];

const OFFICE_BASIC = [
  'office.view', 'office.dashboard', 'office.properties', 'office.students_tenants',
  'office.leases', 'office.documents', 'office.inspections', 'office.correspondence',
  'office.tasks', 'office.meetings', 'office.complaints', 'office.reports',
  'properties.view', 'rooms.view', 'students.view', 'tasks.view', 'documents.view',
  'documents.download', 'announcements.view', 'reports.view', 'ai.use',
];

export const DEFAULT_ROLE_PERMISSIONS = {
  super_admin: ALL,
  ceo: [
    'dashboard.exec', 'students.view', 'students.financial', 'applications.view',
    'applications.process', 'properties.view', 'rooms.view', 'complaints.view',
    'complaints.manage', 'maintenance.view', 'maintenance.manage', 'cleaning.view',
    'cleaning.manage', 'finance.view', 'finance.manage', 'staff.view',
    'staff.manage', 'tasks.view', 'tasks.manage', 'documents.view',
    'documents.download', 'announcements.view', 'announcements.manage',
    'reports.view', 'reports.export',
    'hr.dashboard', 'hr.recruitment', 'hr.attendance', 'hr.leave.apply', 'hr.leave.approve',
    'hr.payroll.view', 'hr.payroll.approve', 'hr.performance', 'hr.cases', 'hr.cases.confidential',
    'hr.salary', 'finance.gl.view', 'finance.gl.post', 'finance.gl.approve', 'finance.ar',
    'finance.ap', 'finance.approve', 'finance.banking', 'finance.budget', 'finance.assets',
    'finance.periods', 'finance.settings', 'ai.use', 'ai.write',
    ...OFFICE_FULL,
  ],
  hr_manager: HR_MANAGE.concat(['hr.cases.confidential', 'hr.salary', 'hr.payroll.view', 'ai.write']),
  hr_officer: HR_OFFICER,
  payroll_officer: PAYROLL.concat(['hr.salary', 'hr.leave.approve']),
  finance_manager: FINANCE.concat([
    'finance.gl.approve', 'finance.approve', 'finance.budget', 'finance.assets',
    'finance.periods', 'finance.settings', 'staff.view', 'hr.payroll.view', 'ai.write',
  ]),
  accountant: FINANCE.concat(['finance.gl.approve', 'finance.assets', 'finance.budget']),
  ap_officer: ['finance.view', 'finance.manage', 'finance.gl.view', 'finance.gl.post', 'finance.ap', 'reports.view', 'documents.view', 'announcements.view', 'tasks.view', 'ai.use'],
  ar_officer: ['finance.view', 'finance.manage', 'finance.gl.view', 'finance.gl.post', 'finance.ar', 'students.view', 'students.financial', 'reports.view', 'documents.view', 'announcements.view', 'tasks.view', 'ai.use'],
  office_admin_manager: OFFICE_FULL,
  property_administrator: OFFICE_FULL,
  property_documentation_officer: ['office.view', 'office.dashboard', 'office.properties', 'office.documents', 'office.compliance', 'office.correspondence', 'office.reports', 'properties.view', 'documents.view', 'documents.manage', 'documents.download', 'tasks.view', 'announcements.view', 'reports.view', 'ai.use'],
  lease_administration_officer: ['office.view', 'office.dashboard', 'office.leases', 'office.students_tenants', 'office.documents', 'office.correspondence', 'office.tasks', 'office.reports', 'students.view', 'properties.view', 'documents.view', 'documents.manage', 'documents.download', 'tasks.view', 'tasks.manage', 'announcements.view', 'reports.view', 'ai.use'],
  student_tenant_admin_officer: ['office.view', 'office.dashboard', 'office.students_tenants', 'office.leases', 'office.documents', 'office.correspondence', 'office.complaints', 'office.tasks', 'students.view', 'properties.view', 'documents.view', 'documents.manage', 'documents.download', 'tasks.view', 'tasks.manage', 'complaints.view', 'complaints.manage', 'announcements.view', 'reports.view', 'ai.use'],
  property_inspection_administrator: ['office.view', 'office.dashboard', 'office.inspections', 'office.compliance', 'office.tasks', 'office.correspondence', 'office.reports', 'properties.view', 'maintenance.view', 'documents.view', 'documents.manage', 'documents.download', 'tasks.view', 'tasks.manage', 'announcements.view', 'reports.view', 'ai.use'],
  procurement_purchasing_officer: ['office.view', 'office.dashboard', 'office.procurement', 'office.suppliers', 'office.approve', 'office.tasks', 'office.reports', 'documents.view', 'documents.manage', 'documents.download', 'tasks.view', 'tasks.manage', 'announcements.view', 'reports.view', 'ai.use'],
  supplier_contractor_administrator: ['office.view', 'office.dashboard', 'office.suppliers', 'office.procurement', 'office.correspondence', 'office.tasks', 'office.reports', 'documents.view', 'documents.manage', 'documents.download', 'tasks.view', 'tasks.manage', 'announcements.view', 'reports.view', 'ai.use'],
  property_asset_administrator: ['office.view', 'office.dashboard', 'office.assets', 'office.properties', 'office.inspections', 'office.tasks', 'office.reports', 'properties.view', 'documents.view', 'documents.manage', 'documents.download', 'tasks.view', 'tasks.manage', 'announcements.view', 'reports.view', 'ai.use'],
  administrative_assistant: OFFICE_BASIC,
  reception_correspondence_administrator: ['office.view', 'office.dashboard', 'office.correspondence', 'office.students_tenants', 'office.tasks', 'office.meetings', 'office.complaints', 'office.reports', 'students.view', 'properties.view', 'documents.view', 'documents.manage', 'documents.download', 'tasks.view', 'tasks.manage', 'complaints.view', 'complaints.manage', 'announcements.view', 'reports.view', 'ai.use'],
  compliance_documentation_officer: ['office.view', 'office.dashboard', 'office.compliance', 'office.documents', 'office.leases', 'office.properties', 'office.tasks', 'office.reports', 'properties.view', 'documents.view', 'documents.manage', 'documents.download', 'tasks.view', 'tasks.manage', 'announcements.view', 'reports.view', 'ai.use'],
  logistics_scheduling_administrator: ['office.view', 'office.dashboard', 'office.logistics', 'office.meetings', 'office.tasks', 'office.correspondence', 'office.reports', 'documents.view', 'documents.manage', 'documents.download', 'tasks.view', 'tasks.manage', 'announcements.view', 'reports.view', 'ai.use'],
  department_manager: [
    'dashboard.exec', 'properties.view', 'rooms.view', 'staff.view',
    'tasks.view', 'tasks.manage', 'documents.view', 'announcements.view',
    'reports.view', 'complaints.view', 'maintenance.view',
    'hr.dashboard', 'hr.attendance', 'hr.leave.apply', 'hr.leave.approve', 'hr.performance',
    'finance.view', 'ai.use',
  ],
  employee: EMPLOYEE,
  receptionist: RECEPTION,
  finance: FINANCE,
  cleaner: ['cleaning.view', 'cleaning.own', 'properties.view', 'rooms.view', 'announcements.view', 'tasks.view'],
  maintenance: [
    'maintenance.view', 'maintenance.manage', 'complaints.view', 'complaints.manage',
    'properties.view', 'rooms.view', 'tasks.view', 'announcements.view', 'documents.view',
  ],
  property_manager: [
    'dashboard.exec', 'students.view', 'students.manage', 'students.financial',
    'applications.view', 'applications.process', 'properties.view', 'properties.manage',
    'rooms.view', 'rooms.manage', 'rooms.allocate', 'complaints.view', 'complaints.manage',
    'maintenance.view', 'maintenance.manage', 'cleaning.view', 'cleaning.manage',
    'finance.view', 'tasks.view', 'tasks.manage', 'documents.view', 'documents.download',
    'announcements.view', 'reports.view', 'reports.export',
  ],
  security_officer: [
    'security.view', 'security.manage', 'complaints.view', 'complaints.manage',
    'properties.view', 'rooms.view', 'tasks.view', 'documents.view',
    'announcements.view', 'reports.view', 'ai.use',
  ],
  marketing_officer: [
    'marketing.view', 'marketing.manage', 'announcements.view', 'announcements.manage',
    'students.view', 'properties.view', 'reports.view', 'documents.view',
    'tasks.view', 'ai.use',
  ],
  housekeeping_supervisor: [
    'cleaning.view', 'cleaning.manage', 'properties.view', 'rooms.view',
    'maintenance.view', 'tasks.view', 'tasks.manage', 'staff.view',
    'documents.view', 'announcements.view', 'reports.view', 'ai.use',
  ],
  auditor: [
    'dashboard.exec', 'students.view', 'students.financial', 'applications.view',
    'properties.view', 'rooms.view', 'complaints.view', 'maintenance.view',
    'cleaning.view', 'finance.view', 'finance.gl.view', 'staff.view', 'tasks.view',
    'documents.view', 'announcements.view', 'reports.view', 'reports.export', 'audit.view',
    'hr.dashboard', 'hr.payroll.view', 'ai.use',
  ],
};

export const ALL_PERMISSION_KEYS = ALL;

/**
 * Permissions for a role. The `role_permissions` table is authoritative so a
 * Super Administrator can edit grants at runtime; the in-code defaults are only
 * a fallback for roles that have never been seeded.
 */
export function permissionsForRole(db, roleName) {
  if (roleName === 'super_admin') return ALL;
  const rows = db.prepare('SELECT permission_key FROM role_permissions WHERE role = ?').all(roleName);
  if (rows.length) return rows.map((r) => r.permission_key);
  return DEFAULT_ROLE_PERMISSIONS[roleName] || [];
}

/**
 * Effective permissions for a specific user: the role grant plus any personal
 * grant/revoke overrides recorded by a Super Administrator.
 */
export function resolveUserPermissions(db, user) {
  if (!user) return [];
  const base = new Set(permissionsForRole(db, user.role));
  if (user.role === 'super_admin') return ALL;
  const overrides = db.prepare(
    'SELECT permission_key, granted FROM user_permission_overrides WHERE user_id = ?'
  ).all(user.id);
  for (const o of overrides) {
    if (o.granted) base.add(o.permission_key);
    else base.delete(o.permission_key);
  }
  return [...base];
}
