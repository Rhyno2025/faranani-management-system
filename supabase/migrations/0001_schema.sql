-- ===========================================================================
-- FARANANI PROPERTY GROUP — Supabase / PostgreSQL schema
-- Mirrors the SQLite schema used by the bundled server (server/db.js).
-- Apply with: supabase db push  (or paste into the SQL editor)
-- All timestamps are timestamptz in UTC; display in Africa/Johannesburg.
-- ===========================================================================

-- --------------------------- extensions -----------------------------------
create extension if not exists "pgcrypto";

-- --------------------------- helpers --------------------------------------
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- Human-readable reference counters (FAR-ST-0001, FAR-0001, …)
create table if not exists counters (
  name  text primary key,
  value integer not null default 0
);

create table if not exists schema_meta (
  key   text primary key,
  value text
);

-- --------------------------- identity -------------------------------------
create table if not exists staff (
  id               uuid primary key default gen_random_uuid(),
  employee_ref     text unique not null,
  full_name        text not null,
  job_title        text,
  department       text,
  email            text,
  phone            text,
  property_id      uuid,
  role             text,
  employment_status text not null default 'active',
  hired_at         date,
  shift_notes      text,
  notes            text,               -- restricted: management only
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists users (
  id                   uuid primary key default gen_random_uuid(),
  auth_uid             uuid unique references auth.users(id) on delete set null,
  email                text unique not null,
  password_hash        text,           -- local accounts only; Supabase Auth users have NULL here
  full_name            text not null,
  role                 text not null,
  staff_id             uuid references staff(id) on delete set null,
  status               text not null default 'active',
  last_login_at        timestamptz,
  must_change_password boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create table if not exists roles (
  id          uuid primary key default gen_random_uuid(),
  name        text unique not null,
  label       text not null,
  description text
);

create table if not exists permissions (
  id       uuid primary key default gen_random_uuid(),
  key      text unique not null,
  label    text not null,
  category text not null
);

create table if not exists role_permissions (
  role            text not null references roles(name) on delete cascade,
  permission_key  text not null references permissions(key) on delete cascade,
  primary key (role, permission_key)
);

create table if not exists departments (
  id          uuid primary key default gen_random_uuid(),
  name        text unique not null,
  description text,
  created_at  timestamptz not null default now()
);

create table if not exists sessions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ip         text,
  user_agent text
);

-- --------------------------- inventory ------------------------------------
create table if not exists properties (
  id               uuid primary key default gen_random_uuid(),
  property_ref     text unique not null,
  name             text not null,
  address          text,
  city             text,
  province         text,
  manager_staff_id uuid references staff(id) on delete set null,
  contact_email    text,
  contact_phone    text,
  description      text,
  facilities       jsonb default '[]'::jsonb,
  status           text not null default 'active',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists buildings (
  id           uuid primary key default gen_random_uuid(),
  building_ref text unique not null,
  property_id  uuid not null references properties(id) on delete cascade,
  name         text not null,
  floors       integer default 1,
  description  text,
  created_at   timestamptz not null default now()
);

create table if not exists rooms (
  id                uuid primary key default gen_random_uuid(),
  room_ref          text unique not null,
  building_id       uuid not null references buildings(id) on delete cascade,
  room_number       text not null,
  room_type         text not null default 'Single',
  capacity          integer not null default 1,
  rate              numeric(10,2) not null default 0,
  furnishing        text,
  facilities        jsonb default '[]'::jsonb,
  inspection_status text default 'Not inspected',
  status            text not null default 'available',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists beds (
  id         uuid primary key default gen_random_uuid(),
  bed_ref    text unique not null,
  room_id    uuid not null references rooms(id) on delete cascade,
  label      text not null,
  status     text not null default 'available',
  created_at timestamptz not null default now()
);

-- --------------------------- students -------------------------------------
create table if not exists students (
  id                       uuid primary key default gen_random_uuid(),
  student_ref              text unique not null,
  full_name                text not null,
  email                    text,
  phone                    text,
  id_number                text,
  institution              text,
  course                   text,
  emergency_contact_name   text,
  emergency_contact_phone  text,
  status                   text not null default 'registered',
  property_id              uuid references properties(id) on delete set null,
  room_id                  uuid references rooms(id) on delete set null,
  bed_id                   uuid references beds(id) on delete set null,
  check_in_date            date,
  expected_check_out_date  date,
  notes                    text,
  archived_at              timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

-- Duplicate prevention: one open student per id number / email.
create unique index if not exists uq_students_id_number_active
  on students (id_number) where id_number is not null and status != 'archived';
create unique index if not exists uq_students_email_active
  on students (lower(email)) where email is not null and status != 'archived';

-- --------------------------- admissions -----------------------------------
create table if not exists applications (
  id              uuid primary key default gen_random_uuid(),
  app_ref         text unique not null,
  student_id      uuid not null references students(id) on delete cascade,
  property_id     uuid references properties(id) on delete set null,
  room_type_pref  text,
  move_in_date    date,
  duration_months integer,
  status          text not null default 'draft',
  reviewer_id     uuid references users(id) on delete set null,
  internal_notes  text,
  decision_notes  text,
  decision_at     timestamptz,
  decision_by     uuid references users(id) on delete set null,
  submitted_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists application_documents (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications(id) on delete cascade,
  doc_type       text not null,
  file_name      text not null,
  stored_path    text not null,
  mime           text,
  size           bigint,
  uploaded_at    timestamptz not null default now()
);

create table if not exists application_notes (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications(id) on delete cascade,
  author_id      uuid,
  author_name    text,
  body           text not null,
  visibility     text not null default 'internal',
  created_at     timestamptz not null default now()
);

create table if not exists accommodation_agreements (
  id             uuid primary key default gen_random_uuid(),
  agreement_ref  text unique not null,
  student_id     uuid not null references students(id) on delete cascade,
  application_id uuid,
  start_date     date not null,
  end_date       date not null,
  rate           numeric(10,2) not null default 0,
  status         text not null default 'draft',
  signed_at      timestamptz,
  created_at     timestamptz not null default now()
);

-- --------------------------- bed allocations ------------------------------
create table if not exists bed_allocations (
  id             uuid primary key default gen_random_uuid(),
  allocation_ref text unique not null,
  student_id     uuid not null references students(id) on delete cascade,
  bed_id         uuid not null references beds(id) on delete cascade,
  application_id uuid,
  check_in_date  date not null,
  check_out_date date,
  status         text not null default 'active',
  created_by     uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Hard rule: a bed may hold at most one active/reserved allocation.
create unique index if not exists idx_bed_active_unique
  on bed_allocations (bed_id) where status in ('active','reserved');

-- Overlap rule enforced transactionally (date-range guard, used by the
-- allocate_bed() function below): no two active allocations of one bed with
-- overlapping [check_in, check_out) ranges.
create index if not exists idx_alloc_student  on bed_allocations(student_id);
create index if not exists idx_alloc_dates    on bed_allocations(check_in_date, check_out_date);

-- Transactional bed allocation: fails loudly on ANY conflict, including
-- overlapping date ranges that the unique index alone cannot catch.
create or replace function allocate_bed(
  p_student uuid, p_bed uuid, p_check_in date, p_check_out date
) returns uuid
language plpgsql security definer as $$
declare
  v_id uuid;
begin
  if exists (
    select 1 from bed_allocations a
    where a.bed_id = p_bed
      and a.status in ('active','reserved')
      and (p_check_out is null or a.check_out_date is null
           or a.check_in_date < p_check_out)
      and (a.check_out_date is null or a.check_in_date <= p_check_out)
  ) then
    raise exception 'BED_CONFLICT: bed % already has an overlapping active allocation', p_bed;
  end if;

  insert into bed_allocations (allocation_ref, student_id, bed_id, check_in_date, check_out_date, status)
  values ('FAR-ALLOC-' || nextval('alloc_seq'), p_student, p_bed, p_check_in, p_check_out, 'active')
  returning id into v_id;

  update students set bed_id = p_bed, check_in_date = p_check_in where id = p_student;
  return v_id;
end $$;

create sequence if not exists alloc_seq;

-- --------------------------- finance --------------------------------------
create table if not exists suppliers (
  id             uuid primary key default gen_random_uuid(),
  supplier_ref   text unique not null,
  name           text not null,
  contact_person text,
  email          text,
  phone          text,
  category       text,
  status         text not null default 'active',
  created_at     timestamptz not null default now()
);

create table if not exists invoices (
  id         uuid primary key default gen_random_uuid(),
  invoice_ref text unique not null,
  student_id uuid not null references students(id) on delete cascade,
  issue_date date not null,
  due_date   date not null,
  subtotal   numeric(12,2) not null default 0,
  total      numeric(12,2) not null default 0,
  status     text not null default 'issued',
  notes      text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists invoice_items (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references invoices(id) on delete cascade,
  description text not null,
  category    text,
  quantity    numeric(10,2) not null default 1,
  unit_price  numeric(12,2) not null default 0,
  amount      numeric(12,2) not null default 0
);

create table if not exists payments (
  id          uuid primary key default gen_random_uuid(),
  payment_ref text unique not null,
  student_id  uuid not null references students(id) on delete cascade,
  amount      numeric(12,2) not null,
  method      text not null default 'eft',
  reference   text,
  paid_at     timestamptz not null default now(),
  recorded_by uuid,
  status      text not null default 'recorded',
  notes       text,
  created_at  timestamptz not null default now()
);

create table if not exists payment_allocations (
  id         uuid primary key default gen_random_uuid(),
  payment_id uuid not null references payments(id) on delete cascade,
  invoice_id uuid not null references invoices(id) on delete cascade,
  amount     numeric(12,2) not null,
  created_at timestamptz not null default now()
);

create table if not exists expenses (
  id            uuid primary key default gen_random_uuid(),
  expense_ref   text unique not null,
  property_id   uuid references properties(id) on delete set null,
  supplier_id   uuid references suppliers(id) on delete set null,
  category      text not null,
  description   text not null,
  amount        numeric(12,2) not null,
  incurred_date date not null,
  status        text not null default 'pending',
  approved_by   uuid,
  approved_at   timestamptz,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- --------------------------- operations -----------------------------------
create table if not exists complaints (
  id               uuid primary key default gen_random_uuid(),
  ticket_ref       text unique not null,
  student_id       uuid references students(id) on delete set null,
  property_id      uuid references properties(id) on delete set null,
  building_id      uuid references buildings(id) on delete set null,
  room_id          uuid references rooms(id) on delete set null,
  category         text not null,
  subject          text not null,
  description      text not null,
  priority         text not null default 'normal',
  status           text not null default 'open',
  assigned_dept    text,
  assigned_to      uuid references staff(id) on delete set null,
  submitted_via    text not null default 'portal',
  submitted_at     timestamptz not null default now(),
  due_at           timestamptz,
  resolved_at      timestamptz,
  closed_at        timestamptz,
  resolution_notes text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists complaint_comments (
  id           uuid primary key default gen_random_uuid(),
  complaint_id uuid not null references complaints(id) on delete cascade,
  author_id    uuid,
  author_name  text,
  body         text not null,
  visibility   text not null default 'internal',
  created_at   timestamptz not null default now()
);

create table if not exists complaint_status_history (
  id             uuid primary key default gen_random_uuid(),
  complaint_id   uuid not null references complaints(id) on delete cascade,
  from_status    text,
  to_status      text not null,
  changed_by     uuid,
  changed_by_name text,
  note           text,
  changed_at     timestamptz not null default now()
);

create table if not exists maintenance_jobs (
  id             uuid primary key default gen_random_uuid(),
  job_ref        text unique not null,
  complaint_id   uuid references complaints(id) on delete set null,
  property_id    uuid references properties(id) on delete set null,
  building_id    uuid references buildings(id) on delete set null,
  room_id        uuid references rooms(id) on delete set null,
  title          text not null,
  description    text not null,
  priority       text not null default 'normal',
  status         text not null default 'pending',
  assigned_to    uuid references staff(id) on delete set null,
  due_date       date,
  estimated_cost numeric(12,2) default 0,
  actual_cost    numeric(12,2) default 0,
  materials      jsonb default '[]'::jsonb,
  work_notes     text,
  completed_at   timestamptz,
  verified_by    text,
  verified_at    timestamptz,
  created_by     uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists maintenance_photos (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references maintenance_jobs(id) on delete cascade,
  kind        text not null,
  file_name   text not null,
  stored_path text not null,
  created_at  timestamptz not null default now()
);

create table if not exists cleaning_schedules (
  id            uuid primary key default gen_random_uuid(),
  property_id   uuid not null references properties(id) on delete cascade,
  building_id   uuid,
  room_id       uuid,
  area_name     text not null,
  frequency     text not null default 'daily',
  due_time      text default '09:00',
  assigned_to   uuid references staff(id) on delete set null,
  supervisor_id uuid references staff(id) on delete set null,
  checklist     jsonb default '[]'::jsonb,
  status        text not null default 'active',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists cleaning_tasks (
  id           uuid primary key default gen_random_uuid(),
  schedule_id  uuid references cleaning_schedules(id) on delete set null,
  property_id  uuid,
  building_id  uuid,
  room_id      uuid,
  area_name    text not null,
  task_date    date not null,
  due_time     text,
  cleaner_id   uuid references staff(id) on delete set null,
  status       text not null default 'pending',
  completed_at timestamptz,
  completed_by text,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists cleaning_inspections (
  id           uuid primary key default gen_random_uuid(),
  task_id      uuid not null references cleaning_tasks(id) on delete cascade,
  inspector_id uuid,
  result       text not null,
  notes        text,
  created_at   timestamptz not null default now()
);

create table if not exists tasks (
  id           uuid primary key default gen_random_uuid(),
  task_ref     text unique not null,
  title        text not null,
  description  text,
  assigned_to  uuid references staff(id) on delete set null,
  department   text,
  property_id  uuid references properties(id) on delete set null,
  link_type    text,
  link_id      uuid,
  due_date     date,
  priority     text not null default 'normal',
  status       text not null default 'todo',
  recurring    jsonb,
  created_by   uuid,
  completed_at timestamptz,
  verified_by  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists task_comments (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references tasks(id) on delete cascade,
  author_name text,
  body        text not null,
  created_at  timestamptz not null default now()
);

create table if not exists calendar_events (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  type        text not null default 'other',
  starts_at   timestamptz not null,
  ends_at     timestamptz,
  all_day     boolean not null default false,
  property_id uuid,
  link_type   text,
  link_id     uuid,
  description text,
  created_by  uuid,
  created_at  timestamptz not null default now()
);

create table if not exists announcements (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  body         text not null,
  audience     text not null default 'all',
  priority     text not null default 'normal',
  status       text not null default 'draft',
  published_at timestamptz,
  expires_at   timestamptz,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid,
  student_id uuid,
  type       text not null,
  title      text not null,
  body       text,
  link       text,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists audit_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid,
  user_email  text,
  action      text not null,
  entity_type text,
  entity_id   uuid,
  summary     text,
  details     jsonb,
  ip          text,
  created_at  timestamptz not null default now()
);

create table if not exists documents (
  id          uuid primary key default gen_random_uuid(),
  doc_ref     text unique not null,
  doc_type    text,
  entity_type text,
  entity_id   uuid,
  file_name   text not null,
  stored_path text not null,
  mime        text,
  size        bigint,
  uploaded_by uuid,
  visibility  text not null default 'internal',
  created_at  timestamptz not null default now()
);

create table if not exists system_settings (
  key        text primary key,
  value      jsonb,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

-- --------------------------- indexes --------------------------------------
create index if not exists idx_students_ref        on students(student_ref);
create index if not exists idx_students_status     on students(status);
create index if not exists idx_applications_status on applications(status);
create index if not exists idx_complaints_status   on complaints(status);
create index if not exists idx_complaints_property on complaints(property_id);
create index if not exists idx_payments_student    on payments(student_id);
create index if not exists idx_invoices_student    on invoices(student_id);
create index if not exists idx_audit_created       on audit_logs(created_at);
create index if not exists idx_tasks_assigned      on tasks(assigned_to);
create index if not exists idx_notifications_user  on notifications(user_id, read_at);

-- --------------------------- updated_at triggers --------------------------
do $$
declare t text;
begin
  foreach t in array array['staff','users','properties','rooms','students','applications',
    'invoices','expenses','complaints','maintenance_jobs','cleaning_schedules',
    'cleaning_tasks','tasks','announcements','bed_allocations','system_settings']
  loop
    execute format(
      'create trigger trg_%s_updated before update on %s
       for each row execute function set_updated_at()', t, t);
  end loop;
end $$;
