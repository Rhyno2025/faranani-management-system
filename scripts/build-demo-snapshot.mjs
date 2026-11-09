// ---------------------------------------------------------------------------
// Builds the static demo dataset used by the GitHub Pages build.
//
// It starts a throwaway server (temp SQLite file, never your live database),
// creates a realistic sample operation through the real API, then records the
// response of every endpoint the SPA reads into src/demo/snapshot.json.
//
// Run with:  node scripts/build-demo-snapshot.mjs
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.DEMO_PORT) || 3188;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = path.join(os.tmpdir(), `faranani-demo-${Date.now()}.db`);
const OUT = path.join(ROOT, 'src', 'demo', 'snapshot.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let cookie = '';
const failures = [];

async function call(method, p, body) {
  const res = await fetch(`${BASE}/api${p}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  return { status: res.status, data };
}

async function attempt(label, method, p, body) {
  try {
    const r = await call(method, p, body);
    if (r.status >= 400) failures.push(`${label} → ${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);
    return r;
  } catch (err) {
    failures.push(`${label} → ${err.message}`);
    return { status: 0, data: null };
  }
}

async function main() {
  const server = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), FG_DB_PATH: DB, NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', (d) => { log += d; });
  server.stderr.on('data', (d) => { log += d; });

  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(`${BASE}/api/health`)).ok) { ready = true; break; } } catch { /* wait */ }
      await sleep(200);
    }
    if (!ready) throw new Error(`Demo server did not start:\n${log}`);

    await attempt('login', 'POST', '/auth/login', {
      email: 'admin@farananigroup.co.za', password: 'Faranani2026#',
    });

    // ---------------------------------------------------------- properties
    const props = [
      { name: 'Faranani Res — Braamfontein', city: 'Johannesburg', address: '21 Juta Street, Braamfontein' },
      { name: 'Faranani Res — Hatfield', city: 'Pretoria', address: '88 Grosvenor Street, Hatfield' },
      { name: 'Faranani Res — Westdene', city: 'Bloemfontein', address: '14 Second Avenue, Westdene' },
    ];
    const propertyIds = [];
    for (const p of props) {
      const r = await attempt(`property ${p.name}`, 'POST', '/properties', p);
      if (r.data?.id) propertyIds.push(r.data.id);
    }

    // ------------------------------------------------------ buildings/rooms
    const roomIds = [];
    for (let i = 0; i < propertyIds.length; i++) {
      for (const block of ['A', 'B']) {
        const b = await attempt(`building ${block}`, 'POST', '/buildings', {
          property_id: propertyIds[i], name: `Block ${block}`, floors: 2,
        });
        if (!b.data?.id) continue;
        for (let r = 1; r <= 4; r++) {
          const room = await attempt(`room ${block}${r}`, 'POST', '/rooms', {
            building_id: b.data.id, room_number: `${block}${100 + r}`, capacity: 2, rate: 4800,
          });
          if (room.data?.id) roomIds.push(room.data.id);
        }
      }
    }

    // ------------------------------------------------------------- students
    const students = [
      ['Thabo Mokoena', '2001-04-12', 'University of Johannesburg', '0712345678'],
      ['Naledi Dlamini', '2000-09-03', 'Wits University', '0723456789'],
      ['Sipho Nkosi', '2002-01-27', 'Tshwane University of Technology', '0734567890'],
      ['Amahle Khumalo', '2001-11-19', 'University of Pretoria', '0745678901'],
      ['Kagiso Molefe', '2000-06-08', 'University of the Free State', '0756789012'],
      ['Lerato Sithole', '2002-03-30', 'Durban University of Technology', '0767890123'],
      ['Tumi van Wyk', '2001-08-14', 'Stellenbosch University', '0778901234'],
      ['Bongani Zulu', '2003-02-05', 'University of KwaZulu-Natal', '0789012345'],
    ];
    const studentIds = [];
    let seq = 300;
    for (const [name, dob, institution, phone] of students) {
      seq += 7;
      const r = await attempt(`student ${name}`, 'POST', '/students', {
        full_name: name,
        email: `${name.toLowerCase().replace(/[^a-z]/g, '.')}@student.co.za`,
        phone,
        id_number: `0${dob.slice(2, 4)}0${dob.slice(5, 7)}58000${seq}`,
        institution,
      });
      if (r.data?.id) studentIds.push(r.data.id);
    }

    // ---------------------------------------------------------- allocations
    const beds = await attempt('beds', 'GET', '/beds?pageSize=500');
    const freeBeds = (beds.data?.data || []).filter((b) => b.live_status === 'available');
    for (let i = 0; i < Math.min(4, freeBeds.length, studentIds.length); i++) {
      await attempt(`allocation ${i}`, 'POST', '/allocations', {
        student_id: studentIds[i], bed_id: freeBeds[i].id,
        check_in_date: '2026-02-01', check_out_date: '2026-11-30',
      });
    }

    // --------------------------------------------------------- applications
    for (let i = 4; i < Math.min(7, studentIds.length); i++) {
      await attempt(`application ${i}`, 'POST', '/applications', {
        student_id: studentIds[i], room_type_pref: i % 2 ? 'Single' : 'Sharing',
        move_in_date: '2027-01-15', submit: true,
      });
    }

    // ----------------------------------------------------------- complaints
    const complaints = [
      ['Plumbing', 'Leaking tap in bathroom', 'The basin tap drips constantly and the sink fills overnight.', 'high'],
      ['Electrical', 'Bedroom plug socket dead', 'None of the plugs on the left wall work since Monday.', 'medium'],
      ['Security', 'Gate access card not working', 'Card reader at the main gate rejects my card.', 'high'],
    ];
    const complaintIds = [];
    for (let i = 0; i < complaints.length; i++) {
      const [category, subject, description, priority] = complaints[i];
      const r = await attempt(`complaint ${subject}`, 'POST', '/complaints', {
        student_ref: `FAR-ST-${String(1 + i).padStart(4, '0')}`,
        category, subject, description, priority, submitted_via: 'website',
      });
      if (r.data?.id) complaintIds.push(r.data.id);
    }
    if (complaintIds[0]) {
      await attempt('complaint progress', 'PATCH', `/complaints/${complaintIds[0]}`, {
        status: 'in_progress', note: 'Plumber dispatched for Tuesday morning.',
      });
      await attempt('maintenance from complaint', 'POST', '/maintenance', {
        complaint_id: complaintIds[0], title: 'Replace basin tap washer',
        description: 'Replace washer and reseal the trap.', priority: 'high',
      });
    }

    // -------------------------------------------------------------- finance
    for (let i = 0; i < Math.min(3, studentIds.length); i++) {
      await attempt(`invoice ${i}`, 'POST', '/invoices', {
        student_id: studentIds[i], due_date: '2026-11-30',
        items: [{ description: 'Accommodation — November 2026', category: 'Accommodation', quantity: 1, unit_price: 4800 }],
      });
    }
    if (studentIds[0]) {
      await attempt('payment 1', 'POST', '/payments', {
        student_id: studentIds[0], amount: 3000, method: 'eft', reference: 'DEP-8841',
      });
    }
    if (studentIds[1]) {
      await attempt('payment 2', 'POST', '/payments', {
        student_id: studentIds[1], amount: 4800, method: 'cash', reference: 'CASH-2290',
      });
    }

    // ------------------------------------------------------------ staff / HR
    const staff = [
      ['Nomsa Mahlangu', 'Housekeeping Supervisor', 'Cleaning', 'nomsa.m@farananigroup.co.za'],
      ['Piet Erasmus', 'Maintenance Technician', 'Maintenance', 'piet.e@farananigroup.co.za'],
      ['Zanele Moyo', 'Receptionist', 'Reception', 'zanele.m@farananigroup.co.za'],
      ['Johan Steyn', 'Finance Officer', 'Finance', 'johan.s@farananigroup.co.za'],
    ];
    for (const [full_name, job_title, department, email] of staff) {
      await attempt(`staff ${full_name}`, 'POST', '/staff', { full_name, job_title, department, email });
      await attempt(`employee ${full_name}`, 'POST', '/hr/employees', {
        full_name, job_title, department, email, base_salary: 18500,
        employment_type: 'permanent', hired_at: '2026-01-15',
        contract_start: '2026-01-15', contract_end: '2027-01-14',
      });
    }

    const leaveTypes = await attempt('leave types', 'GET', '/hr/leave/types');
    const annual = (leaveTypes.data?.data || []).find((t) => t.code === 'AL');
    if (annual) {
      const emps = await attempt('employees', 'GET', '/hr/employees?pageSize=50');
      const first = (emps.data?.data || [])[0];
      if (first) {
        await attempt('leave request', 'POST', '/hr/leave/requests', {
          staff_id: first.id, leave_type_id: annual.id,
          start_date: '2026-12-07', end_date: '2026-12-11', reason: 'Family holiday',
        });
      }
    }

    // ------------------------------------------------------ suppliers / AP
    const sup = await attempt('supplier', 'POST', '/suppliers', {
      name: 'Joburg Plumbing Supplies', category: 'Plumbing',
    });
    if (sup.data?.id) {
      await attempt('ap invoice', 'POST', '/ap/invoices', {
        supplier_id: sup.data.id, invoice_number: 'JPS-4471',
        invoice_date: '2026-11-02', subtotal: 4200, tax: 630,
      });
    }

    // ------------------------------------------------------ ledger / bank
    await attempt('journal', 'POST', '/journals', {
      description: 'Opening cash float', entry_date: '2026-11-01',
      lines: [{ code: '1000', debit: 25000, credit: 0 }, { code: '4040', debit: 0, credit: 25000 }],
    });
    await attempt('bank account', 'POST', '/bank/accounts', {
      name: 'Faranani Operations', bank_name: 'FNB', account_number: '62700418823',
      account_type: 'cheque', opening_balance: 25000,
    });

    // -------------------------------------------------------- announcements
    await attempt('announcement 1', 'POST', '/announcements', {
      title: 'Water shutdown — Braamfontein', audience: 'all', status: 'published',
      body: 'Municipal maintenance will interrupt water between 09:00 and 14:00 on Thursday. JoJo tanks are filled.',
    });
    await attempt('announcement 2', 'POST', '/announcements', {
      title: '2027 applications now open', audience: 'students', status: 'published',
      body: 'Returning students can reapply online from 1 December. Applications close 31 January.',
    });

    // ------------------------------------------------------------- snapshot
    const getPaths = [
      '/auth/me', '/workspace', '/dashboard/summary', '/dashboard/panels', '/occupancy',
      '/dashboard/charts/occupancy-trend?months=6', '/dashboard/charts/applications?months=6',
      '/dashboard/charts/financial?months=6', '/dashboard/charts/complaints',
      '/properties?pageSize=100', '/buildings', '/rooms', '/beds?pageSize=500',
      '/students?pageSize=300', '/applications?pageSize=25', '/allocations',
      '/complaints?pageSize=25', '/maintenance?pageSize=25', '/cleaning/tasks', '/cleaning/schedules',
      '/invoices?pageSize=25', '/payments?pageSize=25', '/expenses', '/suppliers?pageSize=100',
      '/balances', '/finance/overview', '/staff?pageSize=200', '/documents', '/audit',
      '/announcements?pageSize=25', '/notifications', '/tasks',
      '/hr/dashboard', '/hr/employees?pageSize=100', '/hr/attendance',
      '/hr/leave/types', '/hr/leave/requests', '/hr/cases', '/hr/payroll/periods',
      '/hr/payroll/config', '/hr/performance/reviews', '/hr/training',
      '/hr/recruitment/requisitions', '/hr/recruitment/applicants', '/hr/recruitment/applications',
      '/hr/shifts', '/coa', '/journals?pageSize=25', '/ap/invoices?pageSize=25',
      '/bank/accounts', '/bank/transactions?pageSize=25', '/departments',
      '/users', '/roles', '/settings', '/settings/overview', '/settings/voice',
      '/settings/memory', '/settings/api-configs', '/settings/departments',
      '/tax/obligations', '/reports/trial-balance', '/reports/profit-and-loss',
      '/reports/ap-aging', '/reports/ar-aging', '/calvin/status',
    ];

    const snapshot = {};
    for (const p of getPaths) {
      const r = await attempt(`snapshot ${p}`, 'GET', p);
      if (r.status === 200 && r.data !== null) snapshot[`GET ${p.split('?')[0]}`] = r.data;
    }

    // Detail endpoints for the first row of each collection, so opening a
    // record in the demo shows a full record rather than a blank panel.
    const detailTargets = [
      ['/complaints', complaintIds[0], '/complaints'],
      ['/properties?pageSize=100', propertyIds[0], '/properties'],
      ['/students?pageSize=300', studentIds[0], '/students'],
      ['/applications?pageSize=25', null, '/applications'],
      ['/maintenance?pageSize=25', null, '/maintenance'],
      ['/hr/employees?pageSize=100', null, '/hr/employees'],
      ['/invoices?pageSize=25', null, '/invoices'],
    ];
    for (const [listPath, explicitId, detailBase] of detailTargets) {
      const key = `GET ${listPath.split('?')[0]}`;
      const rows = snapshot[key]?.data || snapshot[key]?.items || [];
      const id = explicitId || rows[0]?.id;
      if (!id) continue;
      const r = await attempt(`detail ${detailBase}/${id}`, 'GET', `${detailBase}/${id}`);
      if (r.status === 200 && r.data !== null) {
        snapshot[`GET ${detailBase}/${id}`] = r.data;
        snapshot[`GET ${detailBase}/:id`] = r.data;
      }
    }

    // The login response doubles as the demo session: opening the static demo
    // signs straight in as the administrator, no server required.
    const login = await attempt('login snapshot', 'POST', '/auth/login', {
      email: 'admin@farananigroup.co.za', password: 'Faranani2026#',
    });
    if (login.status === 200) snapshot['POST /auth/login'] = login.data;

    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(snapshot, null, 1));
    const size = (fs.statSync(OUT).size / 1024).toFixed(0);
    console.log(`Wrote ${Object.keys(snapshot).length} endpoints (${size} kB) to src/demo/snapshot.json`);
    if (failures.length) {
      console.log(`\n${failures.length} non-fatal seed/record issues:`);
      for (const f of failures.slice(0, 25)) console.log(`  - ${f}`);
    }
  } finally {
    try { server.kill(); } catch { /* gone */ }
    for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) {
      try { fs.unlinkSync(f); } catch { /* none */ }
    }
  }
}

main().catch((err) => {
  console.error('Snapshot build failed:', err.message || err);
  process.exit(1);
});
