// Shared types mirroring the API payloads.

export interface User {
  id: string;
  email: string;
  username?: string | null;
  full_name: string;
  role: string;
  staff_id: string | null;
  status: string;
  last_login_at: string | null;
  phone?: string | null;
  must_change_password?: boolean;
  department: string | null;
  job_title: string | null;
  employee_ref?: string | null;
  property_id: string | null;
}

export interface Paginated<T> {
  data: T[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface Student {
  id: string;
  student_ref: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  id_number: string | null;
  institution: string | null;
  course: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  status: string;
  property_id: string | null;
  room_id: string | null;
  bed_id: string | null;
  check_in_date: string | null;
  expected_check_out_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  property_name?: string | null;
  room_number?: string | null;
  bed_label?: string | null;
  building_name?: string | null;
  balances?: { invoiced: number; paid: number; balance: number };
}

export interface Application {
  id: string;
  app_ref: string;
  student_id: string;
  student_name?: string;
  student_ref?: string;
  student_email?: string;
  student_phone?: string;
  institution?: string;
  property_id: string | null;
  property_name?: string | null;
  room_type_pref: string | null;
  move_in_date: string | null;
  duration_months: number | null;
  status: string;
  reviewer_id: string | null;
  reviewer_name?: string | null;
  internal_notes: string | null;
  decision_notes: string | null;
  decision_at: string | null;
  submitted_at: string | null;
  created_at: string;
  document_count?: number;
  documents?: any[];
  notes?: any[];
}

export interface Property {
  id: string;
  property_ref: string;
  name: string;
  address: string | null;
  city: string | null;
  province: string | null;
  manager_staff_id: string | null;
  manager_name?: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  description: string | null;
  facilities: string; // JSON array
  status: string;
  building_count?: number;
  room_count?: number;
  bed_count?: number;
}

export interface Building {
  id: string;
  building_ref: string;
  property_id: string;
  name: string;
  floors: number | null;
  description: string | null;
  room_count?: number;
}

export interface Room {
  id: string;
  room_ref: string;
  building_id: string;
  room_number: string;
  room_type: string;
  capacity: number;
  rate: number;
  furnishing: string | null;
  facilities: string;
  inspection_status: string;
  status: string;
  building_name?: string;
  property_name?: string;
  property_id?: string;
  bed_total?: number;
  bed_occupied?: number;
}

export interface Bed {
  id: string;
  bed_ref: string;
  room_id: string;
  label: string;
  status: string;
  room_number?: string;
  room_type?: string;
  building_name?: string;
  property_name?: string;
  occupants?: number;
  live_status?: string;
  occupant_name?: string | null;
}

export interface Complaint {
  id: string;
  ticket_ref: string;
  student_id: string | null;
  student_name?: string | null;
  student_ref?: string | null;
  property_id: string | null;
  property_name?: string | null;
  building_name?: string | null;
  room_id: string | null;
  room_number?: string | null;
  category: string;
  subject: string;
  description: string;
  priority: string;
  status: string;
  assigned_dept: string | null;
  assigned_to: string | null;
  assignee_name?: string | null;
  submitted_via: string;
  submitted_at: string;
  due_at: string | null;
  resolved_at: string | null;
  created_at: string;
  comments?: any[];
  history?: any[];
  maintenance_jobs?: any[];
}

export interface MaintenanceJob {
  id: string;
  job_ref: string;
  complaint_id: string | null;
  property_id: string | null;
  building_id: string | null;
  room_id: string | null;
  title: string;
  description: string;
  priority: string;
  status: string;
  assigned_to: string | null;
  assignee_name?: string | null;
  due_date: string | null;
  estimated_cost: number;
  actual_cost: number;
  materials: string;
  work_notes: string | null;
  completed_at: string | null;
  verified_by: string | null;
  property_name?: string | null;
  room_number?: string | null;
  building_name?: string | null;
  ticket_ref?: string | null;
  created_at: string;
}

export interface CleaningTask {
  id: string;
  schedule_id: string | null;
  property_id: string | null;
  building_id: string | null;
  room_id: string | null;
  area_name: string;
  task_date: string;
  due_time: string | null;
  cleaner_id: string | null;
  cleaner_name?: string | null;
  supervisor_name?: string | null;
  status: string;
  completed_at: string | null;
  completed_by: string | null;
  notes: string | null;
  property_name?: string | null;
  building_name?: string | null;
  room_number?: string | null;
  checklist?: string;
}

export interface Staff {
  id: string;
  employee_ref: string;
  full_name: string;
  job_title: string | null;
  department: string | null;
  email: string | null;
  phone: string | null;
  property_id: string | null;
  property_name?: string | null;
  role: string | null;
  employment_status: string;
  hired_at: string | null;
  shift_notes: string | null;
  notes: string | null;
  open_tasks?: number;
  open_jobs?: number;
}

export interface Task {
  id: string;
  task_ref: string;
  title: string;
  description: string | null;
  assigned_to: string | null;
  assignee_name?: string | null;
  department: string | null;
  property_id: string | null;
  property_name?: string | null;
  link_type: string | null;
  link_id: string | null;
  due_date: string | null;
  priority: string;
  status: string;
  recurring: string | null;
  created_at: string;
}

export interface Invoice {
  id: string;
  invoice_ref: string;
  student_id: string;
  student_name?: string;
  student_ref?: string;
  issue_date: string;
  due_date: string;
  subtotal: number;
  total: number;
  status: string;
  notes: string | null;
  paid?: number;
  due?: number;
}

export interface Payment {
  id: string;
  payment_ref: string;
  student_id: string;
  student_name?: string;
  student_ref?: string;
  amount: number;
  method: string;
  reference: string | null;
  paid_at: string;
  recorded_by_name?: string | null;
  status: string;
  notes: string | null;
}

export interface Expense {
  id: string;
  expense_ref: string;
  property_id: string | null;
  property_name?: string | null;
  supplier_id: string | null;
  supplier_name?: string | null;
  category: string;
  description: string;
  amount: number;
  incurred_date: string;
  status: string;
  approver_name?: string | null;
}

export interface Supplier {
  id: string;
  supplier_ref: string;
  name: string;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
  category: string | null;
  status: string;
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  audience: string;
  priority: string;
  status: string;
  published_at: string | null;
  expires_at: string | null;
  author_name?: string | null;
  created_at: string;
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

export interface AuditEntry {
  id: string;
  user_email: string | null;
  user_name?: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  summary: string | null;
  details: string | null;
  ip: string | null;
  created_at: string;
}

export interface DocumentRow {
  id: string;
  doc_ref: string;
  doc_type: string | null;
  entity_type: string | null;
  entity_id: string | null;
  file_name: string;
  mime: string | null;
  size: number | null;
  uploader_name?: string | null;
  visibility: string;
  created_at: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  type: string;
  starts_at: string;
  ends_at: string | null;
  all_day: number;
  property_name?: string | null;
  description: string | null;
  derived?: boolean;
}

export interface DashboardSummary {
  total_students: number;
  active_students: number;
  total_properties: number;
  total_buildings: number;
  total_beds: number;
  occupied_beds: number;
  available_beds: number;
  occupancy_pct: number;
  pending_applications: number;
  awaiting_approval: number;
  open_complaints: number;
  urgent_complaints: number;
  urgent_maintenance: number;
  outstanding_balances: number;
  payments_received: number;
  overdue_tasks: number;
  cleaning_pending: number;
  student_delta_pct: number;
  complaint_delta_pct: number;
}
