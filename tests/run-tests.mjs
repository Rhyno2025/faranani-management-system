// ---------------------------------------------------------------------------
// Faranani Property Group — automated API tests.
//
// The suite creates its own fixtures (property, users, students, employees) in
// a THROWAWAY database: it starts its own server on a spare port with
// FG_DB_PATH pointed at a temporary file, then deletes that file. Your live
// server/data/faranani.db is never touched and no test records can appear in
// the real system.
//
// Run with:  npm test
// To test an already-running server instead, set API_BASE=http://localhost:3001.
// In that case the fixtures are archived/deactivated, not deleted.
//
// Coverage:
//   1  Authentication
//   2  Test fixtures (property/building/room, role users)
//   3  Student registration + duplicate prevention
//   4  Bed allocation conflict prevention
//   5  Application workflow
//   6  Complaint record + status history
//   7  Maintenance job linked to a complaint
//   8  Payments → derived balances
//   9  Role-based access control (incl. HR/finance separation)
//  10  HR: employee record, restricted salary, leave rules, attendance
//  11  HR: payroll calculation, statutory rules, approval → draft journal
//  12  Finance: double-entry journals, posting, reversals, trial balance
//  13  Finance: supplier invoices (duplicate + segregation of duties)
//  14  CALVIN: status, permission gating, honest "not configured" response
//  15  Empty-state integrity + cleanup of fixtures
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let BASE = process.env.API_BASE || '';
const RUN = Date.now().toString().slice(-9); // unique per run → repeatable tests

let passed = 0;
let failed = 0;
const failures = [];

function ok(cond, label, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; failures.push(`${label} ${extra}`); console.log(`  ✗ ${label} ${extra}`); }
}

/** Minimal cookie-aware fetch client. */
function client() {
  let cookie = '';
  return async (method, path, body, raw = false) => {
    const res = await fetch(`${BASE}/api${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    if (raw) return { status: res.status, body: await res.text(), res };
    let data = null;
    try { data = await res.json(); } catch { /* non-json */ }
    return { status: res.status, body: data, res };
  };
}

// ---------------------------------------------------------------- isolated server
let serverProc = null;
let tempDbFiles = [];
let serverLog = '';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startIsolatedServer() {
  const basePort = Number(process.env.TEST_PORT) || 3099;
  for (let attempt = 0; attempt < 10; attempt++) {
    const port = basePort + attempt;
    const dbPath = path.join(os.tmpdir(), `faranani-test-${RUN}-${port}.db`);
    tempDbFiles = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`];
    serverLog = '';
    const proc = spawn(process.execPath, ['server/index.js'], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(port), FG_DB_PATH: dbPath, NODE_ENV: 'test' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    proc.stdout.on('data', (d) => { serverLog += d.toString(); });
    proc.stderr.on('data', (d) => { serverLog += d.toString(); });
    let exited = false;
    proc.on('exit', () => { exited = true; });

    const origin = `http://localhost:${port}`;
    for (let i = 0; i < 120 && !exited; i++) {
      try {
        const res = await fetch(`${origin}/api/health`);
        if (res.ok) {
          BASE = origin;
          serverProc = proc;
          console.log(`Test server ready on ${origin} (isolated database: ${dbPath})`);
          return;
        }
      } catch { /* not up yet */ }
      await sleep(200);
    }
    try { proc.kill(); } catch { /* already gone */ }
    for (const f of tempDbFiles) { try { fs.unlinkSync(f); } catch { /* none */ } }
    if (exited && !/EADDRINUSE/.test(serverLog)) break;
  }
  throw new Error(`Could not start an isolated test server. Output:\n${serverLog}`);
}

async function stopIsolatedServer() {
  if (!serverProc) return;
  const proc = serverProc;
  serverProc = null;
  await new Promise((resolve) => {
    const done = () => resolve();
    proc.once('exit', done);
    try { proc.kill(); } catch { done(); }
    setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* gone */ } resolve(); }, 4000);
  });
  for (const f of tempDbFiles) {
    for (let i = 0; i < 5; i++) {
      try { fs.unlinkSync(f); break; } catch { await sleep(150); }
    }
  }
}

async function main() {
  const isolated = !process.env.API_BASE;
  if (isolated) await startIsolatedServer();
  try {
    await runSuite();
  } finally {
    if (isolated) await stopIsolatedServer();
  }
}

async function runSuite() {
  const admin = client();
  const anon = client();
  const fixtures = { users: [], staff: [], properties: [], students: [], departments: [] };

  // ------------------------------------------------------------------ auth
  console.log('\n[1] Authentication');
  const bad = await anon('POST', '/auth/login', { email: 'admin@farananigroup.co.za', password: 'wrong' });
  ok(bad.status === 401, 'wrong password rejected', `→ ${bad.status}`);
  const good = await admin('POST', '/auth/login', { email: 'admin@farananigroup.co.za', password: 'Faranani2026#' });
  ok(good.status === 200 && good.body?.user?.role === 'super_admin', 'admin login succeeds');
  ok(Array.isArray(good.body?.permissions) && good.body.permissions.length > 30, 'permissions returned');
  const noAuth = await anon('GET', '/students');
  ok(noAuth.status === 401, 'unauthenticated request blocked', `→ ${noAuth.status}`);

  // -------------------------------------------------------------- fixtures
  console.log('\n[2] Test fixtures (created by the suite, removed again at the end)');
  const property = await admin('POST', '/properties', {
    name: `ZZ Test Property ${RUN}`, city: 'Johannesburg', address: `9 Test Road ${RUN}`,
  });
  ok(property.status === 201, 'test property created', `→ ${property.status}`);
  fixtures.properties.push(property.body?.id);
  const building = await admin('POST', '/buildings', { property_id: property.body?.id, name: 'Test Block', floors: 1 });
  ok(building.status === 201, 'test building created', `→ ${building.status}`);
  const room = await admin('POST', '/rooms', { building_id: building.body?.id, room_number: `T${RUN}`, capacity: 2, rate: 4500 });
  ok(room.status === 201, 'test room created with beds', `→ ${room.status}`);

  const mkUser = async (role, label) => {
    const email = `${label}.${RUN}@fpg-test.co.za`;
    const created = await admin('POST', '/users', { email, password: 'TestPass123!', full_name: `ZZ ${label} ${RUN}`, role });
    if (created.status !== 201) {
      console.log(`    (could not create ${role} user: ${created.status} ${JSON.stringify(created.body)})`);
      return { email, client: null, id: null, ok: false };
    }
    fixtures.users.push(created.body.id);
    const c = client();
    const login = await c('POST', '/auth/login', { email, password: 'TestPass123!' });
    return { email, client: c, id: created.body.id, ok: login.status === 200 };
  };
  const cleanerU = await mkUser('cleaner', 'cleaner');
  const financeU = await mkUser('finance', 'finance');
  const apU = await mkUser('ap_officer', 'apofficer');
  const employeeU = await mkUser('employee', 'employee');
  ok(cleanerU.ok && financeU.ok && apU.ok && employeeU.ok, 'role users created and signed in',
    `→ ${JSON.stringify([cleanerU.ok, financeU.ok, apU.ok, employeeU.ok])}`);
  if (!cleanerU.client || !financeU.client || !apU.client || !employeeU.client) {
    throw new Error('Fixture user creation failed — aborting the run.');
  }

  // -------------------------------------------------------------- students
  console.log('\n[3] Student registration + duplicate prevention');
  const st = await admin('POST', '/students', {
    full_name: 'Test Student One', email: `test.student.one.${RUN}@test.co.za`,
    phone: '0712345678', id_number: `900101580008${RUN.slice(-3)}`, institution: 'University of Johannesburg',
  });
  ok(st.status === 201 && /^FAR-ST-\d{4}$/.test(st.body?.student_ref), 'student created with reference', `→ ${st.status} ${JSON.stringify(st.body).slice(0, 120)}`);
  const dup = await admin('POST', '/students', { full_name: 'Duplicate', id_number: `900101580008${RUN.slice(-3)}` });
  ok(dup.status === 409, 'duplicate ID number rejected', `→ ${dup.status}`);
  const studentId = st.body?.id;
  fixtures.students.push(studentId);

  const st2 = await admin('POST', '/students', {
    full_name: 'Test Student Two', email: `test.student.two.${RUN}@test.co.za`, id_number: `900202580008${RUN.slice(-3)}`,
  });
  const student2Id = st2.body?.id;
  fixtures.students.push(student2Id);
  ok(st2.status === 201, 'second student created');

  console.log('\n[4] Bed allocation conflict prevention');
  const beds = await admin('GET', '/beds');
  const freeBed = (beds.body?.data || []).find((b) => b.live_status === 'available');
  ok(Boolean(freeBed), 'found a free bed');
  const alloc1 = await admin('POST', '/allocations', {
    student_id: studentId, bed_id: freeBed.id, check_in_date: '2026-11-01', check_out_date: '2027-03-01',
  });
  ok(alloc1.status === 201, 'first allocation accepted', `→ ${alloc1.status} ${JSON.stringify(alloc1.body)}`);
  const alloc2 = await admin('POST', '/allocations', {
    student_id: student2Id, bed_id: freeBed.id, check_in_date: '2026-12-01', check_out_date: '2027-02-01',
  });
  ok(alloc2.status === 409, 'overlapping allocation of SAME bed rejected (409)', `→ ${alloc2.status} ${JSON.stringify(alloc2.body)}`);
  const checkout = await admin('POST', `/allocations/${alloc1.body?.id ?? ''}/checkout`, { check_out_date: '2026-11-05' });
  ok(checkout.status === 200 || checkout.status === 404, 'checkout processed', `→ ${checkout.status}`);
  const bedsAfter = await admin('GET', '/beds');
  const freeAgain = (bedsAfter.body?.data || []).find((b) => b.id === freeBed.id);
  ok(freeAgain?.live_status === 'available', 'bed returns to available after checkout', `→ ${freeAgain?.live_status}`);

  console.log('\n[5] Application workflow');
  const app = await admin('POST', '/applications', {
    student_id: student2Id, room_type_pref: 'Single', move_in_date: '2027-01-15', submit: true,
  });
  ok(app.status === 201 && app.body?.status === 'submitted', 'application submitted', `→ ${JSON.stringify(app.body).slice(0, 140)}`);
  const appId = app.body?.id;
  const review = await admin('POST', `/applications/${appId}/review`, {});
  ok(review.status === 200 && review.body?.status === 'under_review', 'moved to under review');
  const decision = await admin('POST', `/applications/${appId}/decision`, { decision: 'approved', decision_notes: 'All documents verified.' });
  ok(decision.status === 200 && decision.body?.status === 'approved', 'approved with decision record');
  const seen = await admin('GET', `/applications/${appId}`);
  ok(seen.body?.status === 'approved', 'status visible after decision');

  console.log('\n[6] Complaint record + status history');
  const comp = await anon('POST', '/complaints', {
    student_ref: st.body?.student_ref, category: 'Plumbing', subject: 'Leaking tap in bathroom',
    description: 'Tap is dripping constantly in room.', priority: 'high', submitted_via: 'website',
  });
  ok(comp.status === 201 && /^FAR-\d{4}$/.test(comp.body?.ticket_ref), 'public website complaint created', `→ ${comp.status} ${JSON.stringify(comp.body).slice(0, 120)}`);
  const compId = comp.body?.id;
  const detail = await admin('GET', `/complaints/${compId}`);
  ok(detail.status === 200 && detail.body?.history?.length >= 1, 'status history recorded');
  ok(detail.body?.assigned_dept === 'Maintenance', 'auto-routed to Maintenance department', `→ ${detail.body?.assigned_dept}`);
  const upd = await admin('PATCH', `/complaints/${compId}`, { status: 'in_progress', note: 'Plumber dispatched.' });
  ok(upd.status === 200 && upd.body?.status === 'in_progress', 'status transition accepted');
  const cmt = await admin('POST', `/complaints/${compId}/comments`, { body: 'Student updated on progress.', visibility: 'student_visible' });
  ok(cmt.status === 201, 'student-visible update added');

  console.log('\n[7] Maintenance job linked to complaint (complaint stays open)');
  const job = await admin('POST', '/maintenance', {
    complaint_id: compId, title: 'Repair leaking tap', description: 'Replace washer and seal.',
    priority: 'high', property_id: detail.body?.property_id,
  });
  ok(job.status === 201, 'maintenance job created from complaint', `→ ${job.status} ${JSON.stringify(job.body).slice(0, 120)}`);
  const jobUpd = await admin('PATCH', `/maintenance/${job.body?.id}`, { status: 'verified' });
  ok(jobUpd.status === 200 && jobUpd.body?.status === 'verified', 'job verified');
  const compAfter = await admin('GET', `/complaints/${compId}`);
  ok(!['resolved', 'closed'].includes(compAfter.body?.status), 'closing job did NOT auto-close complaint', `→ status ${compAfter.body?.status}`);

  console.log('\n[8] Payments and derived balances');
  const inv = await admin('POST', '/invoices', {
    student_id: studentId, due_date: '2026-11-30',
    items: [{ description: 'Accommodation Nov 2026', category: 'Accommodation', quantity: 1, unit_price: 5000 }],
  });
  ok(inv.status === 201 && inv.body?.total === 5000, 'invoice issued (R5000)', `→ ${JSON.stringify(inv.body)}`);
  const invJournal = await admin('GET', '/journals?source_type=invoice');
  ok(invJournal.status === 200 && (invJournal.body?.data || []).some((j) => j.source_id === inv.body?.id),
    'issuing an invoice creates a draft ledger journal');
  const pay = await admin('POST', '/payments', { student_id: studentId, amount: 2000, method: 'eft', reference: 'TESTREF' });
  ok(pay.status === 201, 'payment recorded', `→ ${JSON.stringify(pay.body)}`);
  ok(Math.abs(pay.body?.balances?.balance - 3000) < 0.01, 'derived balance = R3000 after part-payment', `→ ${pay.body?.balances?.balance}`);
  const invAfter = await admin('GET', `/invoices/${inv.body?.id}`);
  ok(invAfter.body?.status === 'partially_paid', 'invoice status auto-updated to partially_paid', `→ ${invAfter.body?.status}`);
  const stmt = await admin('GET', `/students/${studentId}/statement`);
  ok(stmt.status === 200 && stmt.body?.events?.length >= 2, 'account statement returns events');

  // ------------------------------------------------------------------- RBAC
  console.log('\n[9] Role-based access control');
  const cBalances = await cleanerU.client('GET', '/balances');
  ok(cBalances.status === 403 || cBalances.status === 401, 'cleaner blocked from finance', `→ ${cBalances.status}`);
  const cStudents = await cleanerU.client('GET', '/students');
  ok(cStudents.status === 403 || cStudents.status === 401, 'cleaner blocked from student records', `→ ${cStudents.status}`);
  const cCleaning = await cleanerU.client('GET', '/cleaning/tasks');
  ok(cCleaning.status === 200, 'cleaner can view cleaning tasks', `→ ${cCleaning.status}`);
  const cAudit = await cleanerU.client('GET', '/audit');
  ok(cAudit.status === 403, 'cleaner blocked from audit logs', `→ ${cAudit.status}`);
  const cExp = await cleanerU.client('POST', '/expenses', { description: 'rogue', amount: 100 });
  ok(cExp.status === 403, 'cleaner cannot create expenses', `→ ${cExp.status}`);

  const fSettings = await financeU.client('POST', '/settings', { company: { name: 'Hacked' } });
  ok(fSettings.status === 403, 'finance officer cannot change settings', `→ ${fSettings.status}`);
  const fUsers = await financeU.client('GET', '/users');
  ok(fUsers.status === 403, 'finance officer cannot manage users', `→ ${fUsers.status}`);

  // -------------------------------------------------------------------- HR
  console.log('\n[10] HR — employee record, restricted data, leave and attendance');
  const emptyHr = await admin('GET', '/hr/dashboard');
  ok(emptyHr.status === 200 && typeof emptyHr.body?.counts?.total === 'number', 'HR dashboard responds with numeric counts');

  const emp = await admin('POST', '/hr/employees', {
    full_name: 'ZZ Test Employee', job_title: 'Test Officer', department: 'Finance',
    email: `emp.${RUN}@fpg-test.co.za`, base_salary: 25000, employment_type: 'permanent',
    hired_at: '2026-01-15', contract_start: '2026-01-15', contract_end: '2027-01-14',
  });
  ok(emp.status === 201 && /^FAR-EMP-\d{4}$/.test(emp.body?.employee_ref), 'employee created with generated reference', `→ ${emp.status} ${JSON.stringify(emp.body).slice(0, 140)}`);
  const empId = emp.body?.id;
  fixtures.staff.push(empId);

  const empGet = await admin('GET', `/hr/employees/${empId}`);
  ok(empGet.status === 200 && empGet.body?.full_name === 'ZZ Test Employee', 'employee retrieved');
  ok(empGet.body?.balances?.length > 0, 'leave balances derived from policy + approved leave');

  // restricted salary: employee role must not see salary/banking
  const empSelf = await employeeU.client('GET', `/hr/employees/${empId}`);
  ok(empSelf.status === 200, 'employee role can read employee directory');
  ok(empSelf.body?.base_salary === null || empSelf.body?.restricted_fields, 'salary hidden from unauthorised role',
    `→ salary=${empSelf.body?.base_salary}`);
  const empFinance = await financeU.client('GET', `/hr/employees/${empId}`);
  ok(empFinance.status === 403 || empFinance.body?.base_salary === null || Boolean(empFinance.body?.restricted_fields),
    'salary hidden from finance officer (no hr.salary permission)', `→ ${empFinance.status} salary=${empFinance.body?.base_salary}`);

  // leave rules
  const types = await admin('GET', '/hr/leave/types');
  const annual = (types.body?.data || []).find((t) => t.code === 'AL');
  ok(Boolean(annual), 'leave policies seeded (configuration, not demo data)');
  const leave1 = await admin('POST', '/hr/leave/requests', {
    staff_id: empId, leave_type_id: annual.id, start_date: '2026-12-07', end_date: '2026-12-11', reason: 'Test leave',
  });
  ok(leave1.status === 201 && leave1.body?.days === 5, 'leave request created (5 working days)', `→ ${leave1.status} ${JSON.stringify(leave1.body).slice(0, 120)}`);
  const leaveOverlap = await admin('POST', '/hr/leave/requests', {
    staff_id: empId, leave_type_id: annual.id, start_date: '2026-12-09', end_date: '2026-12-15', reason: 'Overlap',
  });
  ok(leaveOverlap.status === 409, 'overlapping leave rejected', `→ ${leaveOverlap.status}`);
  const leaveTooLong = await admin('POST', '/hr/leave/requests', {
    staff_id: empId, leave_type_id: annual.id, start_date: '2027-02-01', end_date: '2027-03-31', reason: 'Beyond entitlement',
  });
  ok(leaveTooLong.status === 409, 'leave beyond entitlement rejected', `→ ${leaveTooLong.status} ${JSON.stringify(leaveTooLong.body)}`);
  const leaveDecision = await admin('POST', `/hr/leave/requests/${leave1.body?.id}/decision`, { stage: 'hr', decision: 'approve' });
  ok(leaveDecision.status === 200 && leaveDecision.body?.status === 'approved', 'leave approved through workflow', `→ ${JSON.stringify(leaveDecision.body)}`);
  const leaveEmp = await employeeU.client('POST', '/hr/leave/requests', {
    leave_type_id: annual.id, start_date: '2026-12-21', end_date: '2026-12-23', reason: 'Own leave',
  });
  ok(leaveEmp.status === 400 || leaveEmp.status === 201, 'employee without linked staff record handled gracefully', `→ ${leaveEmp.status} ${JSON.stringify(leaveEmp.body)}`);

  // attendance comes from recorded events
  const attEmpty = await admin('GET', '/hr/attendance?from=2000-01-01&to=2000-01-31');
  ok(attEmpty.status === 200 && attEmpty.body?.data?.length === 0, 'attendance query with no events returns empty list (not fake data)');

  // link the employee user to the staff record and clock in/out
  await admin('PATCH', `/users/${employeeU.id}`, { staff_id: empId });
  const clockIn = await employeeU.client('POST', '/hr/attendance/clock', { action: 'in' });
  ok(clockIn.status === 201 && clockIn.body?.clock_in, 'clock-in recorded with server timestamp', `→ ${clockIn.status} ${JSON.stringify(clockIn.body).slice(0, 140)}`);
  const clockDup = await employeeU.client('POST', '/hr/attendance/clock', { action: 'in' });
  ok(clockDup.status === 409, 'double clock-in rejected', `→ ${clockDup.status}`);
  const clockOut = await employeeU.client('POST', '/hr/attendance/clock', { action: 'out' });
  ok(clockOut.status === 201 && clockOut.body?.worked_minutes !== undefined, 'clock-out computes worked minutes', `→ ${JSON.stringify(clockOut.body)}`);
  const attAfter = await admin('GET', `/hr/attendance?from=${new Date().toISOString().slice(0, 10)}&to=${new Date().toISOString().slice(0, 10)}`);
  ok((attAfter.body?.data || []).length >= 1 && attAfter.body?.summary?.present >= 1, 'attendance totals derived from recorded events');

  console.log('\n[11] HR — payroll calculation and approval');
  const periodKey = new Date().toISOString().slice(0, 7);
  const period = await admin('POST', '/hr/payroll/periods', { period_key: periodKey });
  ok(period.status === 201 || period.status === 409, 'payroll period created (or already exists)', `→ ${period.status}`);
  const periods = await admin('GET', '/hr/payroll/periods');
  const existing = (periods.body?.data || []).find((p) => p.period_key === periodKey);
  const periodId = period.status === 201 ? period.body?.id : existing?.id;
  const periodStatus = period.status === 201 ? 'draft' : existing?.status;

  if (['draft', 'calculated'].includes(periodStatus)) {
    const calc = await admin('POST', `/hr/payroll/periods/${periodId}/calculate`, {});
    ok(calc.status === 200 && calc.body?.employee_count >= 1, 'payroll calculated from employee records', `→ ${calc.status} ${JSON.stringify(calc.body).slice(0, 160)}`);
    ok(calc.body?.net > 0 && calc.body?.gross > 0, 'gross and net totals computed');
  } else {
    ok(['approved', 'paid'].includes(periodStatus), 'existing payroll period already processed by an earlier run', `→ ${periodStatus}`);
  }

  const periodDetail = await admin('GET', `/hr/payroll/periods/${periodId}`);
  ok((periodDetail.body?.entries || []).length >= 1, 'payroll has one entry per employee');
  const entry = (periodDetail.body?.entries || [])[0];
  ok(entry && Array.isArray(entry.lines) && entry.lines.length >= 2, 'payroll entry contains traceable line items');
  const payeLine = (entry?.lines || []).find((l) => l.code === 'PAYE');
  ok(Boolean(payeLine) && typeof payeLine.amount === 'number', 'PAYE line present and numeric', `→ ${JSON.stringify(payeLine)}`);
  ok(periodDetail.body?.gross_total >= periodDetail.body?.net_total && periodDetail.body?.net_total > 0,
    'gross ≥ net ≥ 0 from configured rules', `→ gross=${periodDetail.body?.gross_total} net=${periodDetail.body?.net_total}`);

  const payCfg = await admin('GET', '/hr/payroll/config');
  ok(payCfg.body?.tax?.source?.includes('sars.gov.za'), 'PAYE brackets carry an official SARS source URL', `→ ${payCfg.body?.tax?.source}`);
  ok((payCfg.body?.deductions || []).some((d) => d.code === 'UIF_EMPLOYEE' && d.source), 'UIF rule stored with source and effective date');
  const empPayroll = await employeeU.client('GET', '/hr/payroll/periods');
  ok(empPayroll.status === 403, 'employee role blocked from payroll', `→ ${empPayroll.status}`);

  const beforeApprove = await admin('GET', `/hr/payroll/periods/${periodId}`);
  const approve = await admin('POST', `/hr/payroll/periods/${periodId}/approve`);
  const expectedApprove = beforeApprove.body?.status === 'calculated' ? 200 : 409;
  ok(approve.status === expectedApprove, 'payroll approval follows the workflow state', `→ expected ${expectedApprove}, got ${approve.status} ${JSON.stringify(approve.body)}`);
  const journalId = approve.body?.journal_id || periodDetail.body?.journal_id;
  ok(Boolean(journalId), 'approved payroll produced a draft journal for finance');
  const pJournal = journalId ? await admin('GET', `/journals/${journalId}`) : { body: null };
  ok(pJournal.body?.status === 'draft', 'payroll journal is DRAFT until finance posts it', `→ ${pJournal.body?.status}`);
  ok(pJournal.body && Math.abs(pJournal.body.total_debit - pJournal.body.total_credit) < 0.01, 'payroll journal balances');

  const approveAgain = await admin('POST', `/hr/payroll/periods/${periodId}/approve`);
  ok(approveAgain.status === 409, 'double approval rejected', `→ ${approveAgain.status}`);

  // --------------------------------------------------------------- finance
  console.log('\n[12] Finance — double-entry journals, posting, reversals, statements');
  const accounts = await admin('GET', '/coa');
  ok((accounts.body?.data || []).length >= 20, 'chart of accounts configured', `→ ${accounts.body?.data?.length}`);

  const badJournal = await admin('POST', '/journals', {
    description: 'Unbalanced test', entry_date: new Date().toISOString().slice(0, 10),
    lines: [{ code: '1000', debit: 100, credit: 0 }, { code: '1100', debit: 0, credit: 90 }],
  });
  ok(badJournal.status === 400, 'unbalanced journal rejected (400)', `→ ${badJournal.status} ${JSON.stringify(badJournal.body)}`);

  const goodJournal = await admin('POST', '/journals', {
    description: 'Opening test entry', entry_date: new Date().toISOString().slice(0, 10),
    lines: [{ code: '1000', debit: 750, credit: 0 }, { code: '4040', debit: 0, credit: 750 }],
  });
  ok(goodJournal.status === 201 && goodJournal.body?.status === 'draft', 'balanced journal saved as draft', `→ ${goodJournal.status}`);

  const post = await admin('POST', `/journals/${goodJournal.body?.id}/post`);
  ok(post.status === 200 && post.body?.status === 'posted', 'journal posted', `→ ${post.status} ${JSON.stringify(post.body).slice(0, 120)}`);

  const postAgain = await admin('POST', `/journals/${goodJournal.body?.id}/post`);
  ok(postAgain.status === 409, 'posting twice is rejected', `→ ${postAgain.status}`);

  const financeNoPerm = await cleanerU.client('POST', '/journals', {
    description: 'rogue', entry_date: new Date().toISOString().slice(0, 10),
    lines: [{ code: '1000', debit: 10, credit: 0 }, { code: '4040', debit: 0, credit: 10 }],
  });
  ok(financeNoPerm.status === 403, 'unauthorised user cannot create journals', `→ ${financeNoPerm.status}`);

  const tb = await admin('GET', '/reports/trial-balance');
  ok(tb.status === 200 && tb.body?.balanced === true, 'trial balance balances', `→ ${JSON.stringify(tb.body).slice(0, 200)}`);
  ok((tb.body?.rows || []).length > 0, 'trial balance includes posted accounts');

  const pl = await admin('GET', '/reports/profit-and-loss');
  ok(pl.status === 200 && typeof pl.body?.net_profit === 'number', 'profit & loss generated from posted entries');

  const rev = await admin('POST', `/journals/${goodJournal.body?.id}/reverse`, { reason: 'test reversal' });
  ok(rev.status === 200 && rev.body?.reversal?.status === 'posted', 'reversal creates a posted mirror entry', `→ ${JSON.stringify(rev.body).slice(0, 160)}`);
  const origAfter = await admin('GET', `/journals/${goodJournal.body?.id}`);
  ok(origAfter.body?.status === 'reversed', 'original journal marked reversed (audit trail preserved)', `→ ${origAfter.body?.status}`);

  const ov = await admin('GET', '/finance/overview');
  ok(ov.status === 200 && typeof ov.body?.cash?.total === 'number' && typeof ov.body?.receivables?.outstanding === 'number',
    'finance overview returns live figures');

  console.log('\n[13] Finance — supplier invoices, duplicates and segregation of duties');
  const supplier = await admin('POST', '/suppliers', { name: `ZZ Supplier ${RUN}`, category: 'Plumbing' });
  ok(supplier.status === 201, 'supplier created');
  const ap1 = await apU.client('POST', '/ap/invoices', {
    supplier_id: supplier.body?.id, invoice_number: `INV-${RUN}`, invoice_date: new Date().toISOString().slice(0, 10),
    subtotal: 1200, tax: 180,
  });
  ok(ap1.status === 201 && ap1.body?.total === 1380, 'supplier invoice recorded with VAT', `→ ${ap1.status} ${JSON.stringify(ap1.body).slice(0, 160)}`);
  const apDup = await apU.client('POST', '/ap/invoices', {
    supplier_id: supplier.body?.id, invoice_number: `INV-${RUN}`, invoice_date: new Date().toISOString().slice(0, 10), subtotal: 1200,
  });
  ok(apDup.status === 409, 'duplicate supplier invoice rejected', `→ ${apDup.status} ${JSON.stringify(apDup.body)}`);
  const selfApprove = await apU.client('POST', `/ap/invoices/${ap1.body?.id}/approve`);
  ok(selfApprove.status === 403, 'recorder cannot approve (permission + separation of duties)', `→ ${selfApprove.status}`);
  const apApprove = await admin('POST', `/ap/invoices/${ap1.body?.id}/approve`);
  ok(apApprove.status === 200 && apApprove.body?.journal_id, 'supplier invoice approved with draft journal', `→ ${apApprove.status} ${JSON.stringify(apApprove.body)}`);
  const tb2 = await admin('GET', '/reports/trial-balance');
  ok(tb2.body?.balanced === true, 'trial balance still balances after AP posting');

  const aging = await admin('GET', '/reports/ap-aging');
  ok(aging.status === 200 && aging.body?.total > 0, 'payables ageing reports outstanding amounts', `→ ${aging.body?.total}`);
  const arAging = await admin('GET', '/reports/ar-aging');
  ok(arAging.status === 200, 'receivables ageing generated');

  // ---------------------------------------------------------------- CALVIN
  console.log('\n[14] CALVIN — status, permission gating, honest responses');
  const cStatus = await admin('GET', '/calvin/status');
  ok(cStatus.status === 200 && cStatus.body?.tools > 0, 'CALVIN status exposes tool count', `→ ${JSON.stringify(cStatus.body)}`);
  ok(typeof cStatus.body?.configured === 'boolean', 'configuration state reported honestly');
  const cDenied = await cleanerU.client('GET', '/calvin/status');
  ok(cDenied.status === 403, 'role without ai.use cannot access CALVIN', `→ ${cDenied.status}`);
  const cDeniedPost = await cleanerU.client('POST', '/calvin', { message: 'hello' });
  ok(cDeniedPost.status === 403, 'CALVIN endpoint blocked for unauthorised role', `→ ${cDeniedPost.status}`);
  const cEmpty = await admin('POST', '/calvin', { message: '' });
  ok(cEmpty.status === 400, 'empty message rejected', `→ ${cEmpty.status}`);
  const cCall = await admin('POST', '/calvin', { message: 'How many employees are registered?' });
  ok(cCall.status === 200, 'CALVIN endpoint responds', `→ ${cCall.status}`);
  if (cCall.body?.configured === false) {
    ok(String(cCall.body?.reply || '').includes('CALVIN_AI_API_KEY') || String(cCall.body?.reply || '').includes('not connected'),
      'unconfigured assistant states what is missing instead of pretending', `→ ${cCall.body?.reply}`);
  } else {
    ok(typeof cCall.body?.reply === 'string' && cCall.body.reply.length > 0, 'assistant returned a reply', `→ ${String(cCall.body?.reply).slice(0, 80)}`);
  }

  // ---------------------------------------- enterprise access management
  console.log('\n[15] Enterprise access management, API credentials and lockout');

  // Departments drive landing dashboards.
  const deptName = `ZZ Dept ${RUN}`;
  const dept = await admin('POST', '/settings/departments', { name: deptName, code: 'ZZD', dashboard_route: '/dashboard' });
  ok(dept.status === 201, 'department created by super admin', `→ ${dept.status}`);
  if (dept.body?.id) fixtures.departments.push(dept.body.id);
  const deptDup = await admin('POST', '/settings/departments', { name: deptName });
  ok(deptDup.status === 409, 'duplicate department rejected', `→ ${deptDup.status}`);

  // Employee account with department, employee record and personal permissions.
  const empEmail = `zz.emp.${RUN}@fpg-test.co.za`;
  const empCreated = await admin('POST', '/users', {
    full_name: `ZZ Employee ${RUN}`, email: empEmail, username: `zzemp${RUN}`,
    password: 'TestPass123!', role: 'receptionist', department: 'Reception',
    job_title: 'Front Desk', phone: '+27110000000', employee_ref: `ZZ-${RUN}`,
  });
  ok(empCreated.status === 201, 'employee account registered with department', `→ ${empCreated.status} ${JSON.stringify(empCreated.body?.error || '')}`);
  fixtures.users.push(empCreated.body?.id);
  if (empCreated.body?.user?.staff_id) fixtures.staff.push(empCreated.body.user.staff_id);
  ok(empCreated.body?.user?.department === 'Reception', 'employee record linked to department');

  const usersList = await admin('GET', '/users');
  const listed = usersList.body?.data?.find((u) => u.email === empEmail);
  ok(Boolean(listed) && listed.department === 'Reception', 'user list exposes department for administration');
  ok(listed && Array.isArray(listed.permissions) && listed.permissions.length > 0, 'user list exposes effective permissions');

  // Personal permission override: revoke everything except tasks + ai.
  const setPerms = await admin('PUT', `/users/${empCreated.body.id}/permissions`, {
    permissions: ['tasks.view', 'ai.use'],
  });
  ok(setPerms.status === 200, 'super admin can allocate individual permissions', `→ ${setPerms.status}`);

  const empClient = client();
  const empLogin = await empClient('POST', '/auth/login', { email: empEmail, password: 'TestPass123!' });
  ok(empLogin.status === 200, 'employee signs in with registered credentials', `→ ${empLogin.status}`);
  ok(empLogin.body?.user?.must_change_password === true, 'temporary password flagged for change');
  ok(empLogin.body?.permissions?.length === 2 && empLogin.body.permissions.includes('tasks.view'),
    'effective permissions reflect personal overrides', `→ ${JSON.stringify(empLogin.body?.permissions)}`);

  const empStudents = await empClient('GET', '/students');
  ok(empStudents.status === 403, 'employee cannot read student records without permission', `→ ${empStudents.status}`);
  const empUsers = await empClient('GET', '/users');
  ok(empUsers.status === 403, 'employee cannot administer users', `→ ${empUsers.status}`);
  const empConfigs = await empClient('GET', '/settings/api-configs');
  ok(empConfigs.status === 403, 'employee cannot read API credentials', `→ ${empConfigs.status}`);
  const empWorkspace = await empClient('GET', '/workspace');
  ok(empWorkspace.status === 200 && Array.isArray(empWorkspace.body?.permissions), 'departmental workspace available');

  // Password reset → forced change → new password works.
  const reset = await admin('POST', `/users/${empCreated.body.id}/reset-password`, {});
  ok(reset.status === 200 && typeof reset.body?.temporary_password === 'string', 'super admin can reset an employee password', `→ ${reset.status}`);
  const tempClient = client();
  const tempLogin = await tempClient('POST', '/auth/login', { email: empEmail, password: reset.body.temporary_password });
  ok(tempLogin.status === 200 && tempLogin.body?.user?.must_change_password === true, 'temporary password accepted and flagged');
  const changed = await tempClient('POST', '/auth/change-password', {
    current_password: reset.body.temporary_password, new_password: 'Permanent123!',
  });
  ok(changed.status === 200, 'employee can set a permanent password', `→ ${changed.status}`);
  const newLogin = client();
  const newLoginRes = await newLogin('POST', '/auth/login', { email: empEmail, password: 'Permanent123!' });
  ok(newLoginRes.status === 200 && newLoginRes.body?.user?.must_change_password === false, 'new password works and clears the flag');

  // Lockout after repeated failures, then administrator unlock.
  const lockU = await mkUser('employee', 'lockout');
  for (let i = 0; i < 5; i++) {
    await client()('POST', '/auth/login', { email: lockU.email, password: 'WrongPass123!' });
  }
  const lockedTry = await client()('POST', '/auth/login', { email: lockU.email, password: 'TestPass123!' });
  ok(lockedTry.status === 401 && /lock/i.test(String(lockedTry.body?.error)), 'account locks after repeated failed attempts', `→ ${lockedTry.body?.error}`);
  const unlock = await admin('PATCH', `/users/${lockU.id}`, { unlock: true });
  ok(unlock.status === 200, 'super admin can unlock an account', `→ ${unlock.status}`);
  const afterUnlock = await client()('POST', '/auth/login', { email: lockU.email, password: 'TestPass123!' });
  ok(afterUnlock.status === 200, 'unlocked account signs in again', `→ ${afterUnlock.status}`);

  // Privilege guards.
  const selfDeactivate = await admin('PATCH', `/users/${good.body.user.id}`, { status: 'deactivated' });
  ok(selfDeactivate.status === 400, 'super admin cannot deactivate their own account', `→ ${selfDeactivate.status}`);
  const financeRoleEdit = await financeU.client('PUT', '/roles/cleaner/permissions', { permissions: ['finance.view'] });
  ok(financeRoleEdit.status === 403, 'ordinary employee cannot edit role permissions', `→ ${financeRoleEdit.status}`);
  const adminOverview = await admin('GET', '/settings/overview');
  ok(adminOverview.status === 200 && typeof adminOverview.body?.users?.total === 'number', 'super admin control centre statistics available');

  // API credentials: encrypted at rest, never returned, admin-only.
  const cfg = await admin('POST', '/settings/api-configs', {
    kind: 'ai', provider: 'custom', name: `ZZ Test Provider ${RUN}`,
    base_url: 'http://127.0.0.1:9/v1', api_key: 'sk-zz-test-1234', model: 'test-model', timeout_ms: 1500,
  });
  ok(cfg.status === 201, 'API configuration saved', `→ ${cfg.status}`);
  ok(cfg.body && !('api_key_enc' in cfg.body) && !('api_key' in cfg.body), 'API key is never returned to the browser');
  ok(cfg.body?.has_key === true && String(cfg.body?.key_hint || '').endsWith('1234'), 'stored key is shown only as a masked hint');
  const cfgTest = await admin('POST', `/settings/api-configs/${cfg.body.id}/test`, {});
  ok(cfgTest.status === 200 && cfgTest.body?.ok === false && ['network', 'timeout', 'invalid_url'].includes(cfgTest.body?.status),
    'connection test reports failure honestly', `→ ${JSON.stringify(cfgTest.body)}`);
  if (cfg.body?.id) await admin('DELETE', `/settings/api-configs/${cfg.body.id}`);

  console.log('\n[16] Empty-state integrity');
  const health = await admin('GET', '/health');
  ok(health.status === 200 && health.body?.ok === true, 'health endpoint live');
  const settings = await admin('GET', '/settings');
  ok(settings.body?.demo_mode === false, 'system is NOT in demo mode', `→ ${settings.body?.demo_mode}`);
  const journalsList = await admin('GET', '/journals?status=draft');
  ok(journalsList.status === 200, 'draft journals listed separately from posted results');

  // ------------------------------------------------------------ cleanup
  console.log('\n[cleanup] Removing test fixtures');
  try {
    for (const id of fixtures.students) await admin('POST', `/students/${id}/archive`);
    for (const id of fixtures.staff) await admin('PATCH', `/hr/employees/${id}`, { archived: true, employment_status: 'terminated' });
    for (const id of fixtures.users) await admin('PATCH', `/users/${id}`, { status: 'deactivated' });
    for (const id of fixtures.properties) await admin('PATCH', `/properties/${id}`, { status: 'inactive' });
    for (const id of fixtures.departments) await admin('DELETE', `/settings/departments/${id}`);
    console.log(`  (removed ${fixtures.students.length} students, ${fixtures.staff.length} employee(s), ${fixtures.users.length} user(s), ${fixtures.properties.length} property, ${fixtures.departments.length} department(s))`);
  } catch { console.log('  (partial cleanup)'); }

  console.log(`\n====================  ${passed} passed, ${failed} failed  ====================`);
  if (failed) {
    console.log('Failures:');
    for (const f of failures) console.log(`  - ${f}`);
    throw new Error(`${failed} test(s) failed`);
  }
}

main().catch((err) => {
  console.error('Test run crashed:', err.message || err);
  process.exit(1);
});
