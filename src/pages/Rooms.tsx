import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Plus, Search, BedDouble, DoorClosed, Wrench, ArrowLeftRight, LogIn, LogOut, LayoutGrid, List,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../auth';
import {
  PageHeader, Field, Input, Select, Textarea, FormGrid, FormActions, Modal,
  StatusPill, toast, Spinner, EmptyState, Tabs, MiniStat, ConfirmDialog,
} from '../components/ui';
import { DataTable, Column, TableToolbar } from '../components/DataTable';
import { fmtDate, todayISO, zar, titleCase } from '../lib/format';
import type { Room, Bed, Paginated, Property, Building, Student } from '../lib/types';

const ROOM_TYPES = ['Single', 'Double', 'Twin', 'Shared', 'Studio', 'Family'];

export default function Rooms() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<'rooms' | 'beds' | 'allocations'>('rooms');

  const [rooms, setRooms] = useState<Room[]>([]);
  const [beds, setBeds] = useState<Bed[]>([]);
  const [allocs, setAllocs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [propertyId, setPropertyId] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 25, total: 0, totalPages: 1 });
  const [properties, setProperties] = useState<Property[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);

  const [occupancy, setOccupancy] = useState<any>(null);
  const [roomFormOpen, setRoomFormOpen] = useState(false);
  const [roomForm, setRoomForm] = useState({ building_id: '', room_number: '', room_type: 'Single', capacity: 1, rate: 4800, furnishing: 'Fully furnished' });
  const [detail, setDetail] = useState<(Room & any) | null>(null);
  const [allocOpen, setAllocOpen] = useState(false);
  const [allocStudent, setAllocStudent] = useState('');
  const [allocBed, setAllocBed] = useState('');
  const [allocDates, setAllocDates] = useState({ check_in_date: todayISO(), check_out_date: '' });
  const [transfer, setTransfer] = useState<{ alloc: any; bed_id: string } | null>(null);
  const [checkoutId, setCheckoutId] = useState<string | null>(null);
  const [students, setStudents] = useState<Student[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ page: String(page), pageSize: '25' });
      if (q) p.set('q', q);
      if (propertyId) p.set('property_id', propertyId);
      if (status) p.set('status', status);
      const [r, occ] = await Promise.all([
        api.get<Paginated<Room>>(`/rooms?${p.toString()}`),
        api.get('/occupancy'),
      ]);
      setRooms(r.data); setPagination(r.pagination); setOccupancy(occ);
      const b = await api.get<{ data: Bed[] }>(`/beds${propertyId ? `?property_id=${propertyId}` : ''}`);
      setBeds(b.data);
      const a = await api.get<{ data: any[] }>('/allocations?status=active');
      setAllocs(a.data);
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  }, [page, q, propertyId, status]);

  useEffect(() => { const t = setTimeout(load, q ? 300 : 0); return () => clearTimeout(t); }, [load, q]);
  useEffect(() => {
    api.get<Paginated<Property>>('/properties?pageSize=100').then((r) => setProperties(r.data)).catch(() => {});
  }, []);
  useEffect(() => {
    if (propertyId) api.get<{ data: Building[] }>(`/buildings?property_id=${propertyId}`).then((r) => setBuildings(r.data)).catch(() => {});
    else api.get<{ data: Building[] }>('/buildings').then((r) => setBuildings(r.data)).catch(() => {});
  }, [propertyId]);

  const openDetail = async (id: string) => {
    try { setDetail(await api.get<Room & any>(`/rooms/${id}`)); } catch (e: any) { toast(e.message, 'error'); }
  };

  const createRoom = async () => {
    if (!roomForm.building_id || !roomForm.room_number) { toast('Building and room number are required', 'error'); return; }
    try {
      const r = await api.post<Room>('/rooms', roomForm);
      toast(`Room ${r.room_ref} created with ${roomForm.capacity} bed(s)`);
      setRoomFormOpen(false); load();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const openAllocate = async (room?: Room) => {
    try {
      const s = await api.get<Paginated<Student>>('/students?pageSize=300&status=registered');
      setStudents(s.data);
    } catch { setStudents([]); }
    setAllocStudent(''); setAllocBed(room ? '' : '');
    setAllocDates({ check_in_date: todayISO(), check_out_date: '' });
    setAllocOpen(true);
  };

  const confirmAlloc = async () => {
    if (!allocStudent || !allocBed) { toast('Select a student and a bed', 'error'); return; }
    try {
      const res = await api.post('/allocations', { student_id: allocStudent, bed_id: allocBed, ...allocDates });
      toast(`Allocated — ${res.allocation_ref}`);
      setAllocOpen(false); load();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const doCheckout = async () => {
    if (!checkoutId) return;
    try {
      await api.post(`/allocations/${checkoutId}/checkout`, { check_out_date: todayISO() });
      toast('Check-out recorded, bed released');
      setCheckoutId(null); load();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const doTransfer = async () => {
    if (!transfer) return;
    try {
      await api.post(`/allocations/${transfer.alloc.id}/transfer`, { bed_id: transfer.bed_id, date: todayISO() });
      toast('Transfer completed');
      setTransfer(null); load();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const roomCols: Column<Room>[] = [
    { key: 'room_ref', header: 'Reference', render: (r) => <span className="font-semibold text-neutral-700">{r.room_ref}</span> },
    {
      key: 'room_number', header: 'Room',
      render: (r) => (
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-gold-soft text-gold-dark"><DoorClosed size={13} /></span>
          <div>
            <p className="font-medium text-neutral-800">Room {r.room_number}</p>
            <p className="text-[11px] text-neutral-400">{r.building_name}</p>
          </div>
        </div>
      ),
    },
    { key: 'property_name', header: 'Property', render: (r) => <span className="text-xs text-neutral-600">{r.property_name}</span> },
    { key: 'room_type', header: 'Type', render: (r) => <span className="text-xs text-neutral-600">{r.room_type}</span> },
    {
      key: 'beds', header: 'Beds (occ/total)',
      render: (r) => (
        <span className={`pill ${(r.bed_occupied || 0) >= (r.bed_total || 0) ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
          {r.bed_occupied || 0}/{r.bed_total || 0}
        </span>
      ),
    },
    { key: 'rate', header: 'Rate', render: (r) => <span className="text-xs font-semibold text-neutral-700">{zar(r.rate)}<span className="font-normal text-neutral-400">/mo</span></span> },
    { key: 'status', header: 'Status', render: (r) => <StatusPill value={r.status} /> },
    {
      key: 'actions', header: '', className: 'text-right',
      render: (r) => (
        <button className="rounded p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-gold-dark"
          onClick={(e) => { e.stopPropagation(); openDetail(r.id); }} title="View room & beds">
          <Eye14 />
        </button>
      ),
    },
  ];

  const bedCols: Column<Bed>[] = [
    { key: 'bed_ref', header: 'Bed Ref', render: (b) => <span className="font-semibold text-neutral-700">{b.bed_ref}</span> },
    { key: 'label', header: 'Bed', render: (b) => <span className="text-xs font-medium">{b.label}</span> },
    {
      key: 'location', header: 'Location',
      render: (b) => <span className="text-xs text-neutral-600">{b.property_name} · {b.building_name} · Room {b.room_number}</span>,
    },
    { key: 'room_type', header: 'Type', render: (b) => <span className="text-xs text-neutral-600">{b.room_type || '—'}</span> },
    { key: 'live_status', header: 'Availability', render: (b) => <StatusPill value={b.live_status || b.status} /> },
    {
      key: 'occupant', header: 'Occupant',
      render: (b) => <span className="text-xs text-neutral-600">{(b as any).occupant_name || '—'}</span>,
    },
    {
      key: 'actions', header: '', className: 'text-right',
      render: (b) => can('rooms.allocate') && b.live_status === 'available' && (
        <button className="btn-ghost !py-1 text-[11px]" onClick={(e) => {
          e.stopPropagation(); setAllocBed(b.id); openAllocate();
        }}>Allocate</button>
      ),
    },
  ];

  const allocCols = [
    { key: 'allocation_ref', header: 'Allocation', render: (a: any) => <span className="font-semibold text-neutral-700">{a.allocation_ref}</span> },
    { key: 'student', header: 'Student', render: (a: any) => <span className="text-xs font-medium text-neutral-700">{a.student_name} <span className="text-neutral-400">({a.student_ref})</span></span> },
    { key: 'place', header: 'Placement', render: (a: any) => <span className="text-xs text-neutral-600">{a.property_name} · {a.building_name} · Room {a.room_number} · {a.bed_label}</span> },
    { key: 'check_in_date', header: 'Check-in', render: (a: any) => <span className="whitespace-nowrap text-xs">{fmtDate(a.check_in_date)}</span> },
    { key: 'check_out_date', header: 'Check-out', render: (a: any) => <span className="whitespace-nowrap text-xs">{a.check_out_date ? fmtDate(a.check_out_date) : 'Ongoing'}</span> },
    { key: 'status', header: 'Status', render: (a: any) => <StatusPill value={a.status} /> },
    {
      key: 'actions', header: '', className: 'text-right',
      render: (a: any) => can('rooms.allocate') && (
        <div className="flex justify-end gap-1">
          <button className="rounded p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
            title="Transfer to another bed" onClick={() => setTransfer({ alloc: a, bed_id: '' })}>
            <ArrowLeftRight size={14} />
          </button>
          <button className="rounded p-1.5 text-neutral-400 hover:bg-red-50 hover:text-red-600"
            title="Check out" onClick={() => setCheckoutId(a.id)}>
            <LogOut size={14} />
          </button>
        </div>
      ),
    },
  ];

  const freeBeds = beds.filter((b) => b.live_status === 'available');
  const t = occupancy?.totals;

  return (
    <div>
      <PageHeader
        title="Rooms & Bed Allocation"
        subtitle="Availability is derived from real allocations and dates — never from manual labels."
        actions={
          <>
            {can('rooms.allocate') && (
              <button className="btn-ghost inline-flex items-center gap-1.5" onClick={() => openAllocate()}>
                <LogIn size={14} /> Allocate / Check-in
              </button>
            )}
            {can('rooms.manage') && (
              <button className="btn-gold inline-flex items-center gap-1.5" onClick={() => setRoomFormOpen(true)}>
                <Plus size={15} /> Add Room
              </button>
            )}
          </>
        }
      />

      {/* occupancy strip */}
      {t && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-6">
          <div className="panel px-4 py-3">
            <p className="text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">Total beds</p>
            <p className="text-xl font-bold text-neutral-800">{t.total}</p>
          </div>
          <div className="panel px-4 py-3">
            <p className="text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">Occupied</p>
            <p className="text-xl font-bold text-red-600">{t.occupied}</p>
          </div>
          <div className="panel px-4 py-3">
            <p className="text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">Available</p>
            <p className="text-xl font-bold text-emerald-600">{t.total - t.occupied}</p>
          </div>
          <div className="panel px-4 py-3">
            <p className="text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">Occupancy</p>
            <p className="text-xl font-bold text-gold-dark">{t.pct}%</p>
          </div>
          <div className="panel px-4 py-3">
            <p className="text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">Active allocations</p>
            <p className="text-xl font-bold text-neutral-800">{allocs.length}</p>
          </div>
          <div className="panel px-4 py-3">
            <p className="text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400">Properties</p>
            <p className="text-xl font-bold text-neutral-800">{occupancy?.byProperty?.length ?? 0}</p>
          </div>
        </div>
      )}

      <div className="panel overflow-hidden">
        <div className="border-b border-line px-4 pt-2">
          <Tabs active={tab} onChange={(k) => setTab(k as any)} tabs={[
            { key: 'rooms', label: 'Rooms', count: pagination.total },
            { key: 'beds', label: 'Beds & Availability', count: beds.length },
            { key: 'allocations', label: 'Active Allocations', count: allocs.length },
          ]} />
        </div>

        <div className="flex flex-wrap gap-2 border-b border-line px-4 py-2.5">
          <div className="relative min-w-[200px] flex-1">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }}
              placeholder={tab === 'rooms' ? 'Search rooms…' : 'Search…'} aria-label="Search"
              className="field !py-1.5 !pl-9 text-xs" />
          </div>
          <select value={propertyId} onChange={(e) => setPropertyId(e.target.value)} aria-label="Property filter"
            className="field !w-auto !py-1.5 text-xs">
            <option value="">All Properties</option>
            {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {tab === 'rooms' && (
            <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status filter"
              className="field !w-auto !py-1.5 text-xs">
              <option value="">All statuses</option>
              {['available', 'occupied', 'out_of_service', 'maintenance'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
            </select>
          )}
        </div>

        {tab === 'rooms' && (
          <DataTable rows={rooms} columns={roomCols} loading={loading} rowKey={(r) => r.id}
            onRowClick={(r) => openDetail(r.id)}
            page={pagination.page} pageSize={pagination.pageSize} total={pagination.total}
            totalPages={pagination.totalPages} onPageChange={setPage}
            emptyTitle="No accommodation rooms registered yet"
            emptyHint="Add rooms to a building — beds are created automatically from the room capacity." />
        )}
        {tab === 'beds' && (
          <DataTable rows={beds} columns={bedCols} loading={loading} rowKey={(b) => b.id}
            emptyTitle="No accommodation beds have been registered yet" emptyHint="Rooms automatically generate beds from their capacity." />
        )}
        {tab === 'allocations' && (
          <DataTable rows={allocs} columns={allocCols} loading={loading} rowKey={(a) => a.id}
            emptyTitle="No active allocations" emptyHint="Allocate a bed to a student to see it here." />
        )}
      </div>

      {/* add room */}
      <Modal open={roomFormOpen} onClose={() => setRoomFormOpen(false)} title="Add Room" width="max-w-2xl">
        <FormGrid>
          <Field label="Building" required>
            <Select value={roomForm.building_id} onChange={(e) => setRoomForm({ ...roomForm, building_id: e.target.value })}>
              <option value="">Select building…</option>
              {buildings.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.property_id ? '' : ''})</option>)}
            </Select>
          </Field>
          <Field label="Room number" required>
            <Input value={roomForm.room_number} onChange={(e) => setRoomForm({ ...roomForm, room_number: e.target.value })} placeholder="101" />
          </Field>
          <Field label="Room type">
            <Select value={roomForm.room_type} onChange={(e) => setRoomForm({ ...roomForm, room_type: e.target.value })}>
              {ROOM_TYPES.map((t2) => <option key={t2}>{t2}</option>)}
            </Select>
          </Field>
          <Field label="Capacity (beds)" hint="Beds are created automatically">
            <Input type="number" min={1} max={8} value={roomForm.capacity}
              onChange={(e) => setRoomForm({ ...roomForm, capacity: Number(e.target.value) })} />
          </Field>
          <Field label="Accommodation rate (ZAR / month)">
            <Input type="number" min={0} step={50} value={roomForm.rate}
              onChange={(e) => setRoomForm({ ...roomForm, rate: Number(e.target.value) })} />
          </Field>
          <Field label="Furnishing">
            <Input value={roomForm.furnishing} onChange={(e) => setRoomForm({ ...roomForm, furnishing: e.target.value })} />
          </Field>
        </FormGrid>
        <FormActions>
          <button className="btn-ghost" onClick={() => setRoomFormOpen(false)}>Cancel</button>
          <button className="btn-gold" onClick={createRoom}>Create Room</button>
        </FormActions>
      </Modal>

      {/* room detail */}
      <Modal open={Boolean(detail)} onClose={() => setDetail(null)}
        title={detail ? `Room ${detail.room_number} · ${detail.room_ref}` : ''} width="max-w-3xl">
        {detail && (
          <div>
            <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <MiniStat label="Property" value={detail.property_name} />
              <MiniStat label="Building" value={detail.building_name} />
              <MiniStat label="Type / Rate" value={`${detail.room_type} · ${zar(detail.rate)}/mo`} />
              <MiniStat label="Status" value={<StatusPill value={detail.status} />} />
            </div>
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-neutral-500">Beds</p>
            <div className="grid gap-2 sm:grid-cols-3">
              {(detail.beds || []).map((b: any) => (
                <div key={b.id} className={`rounded-lg border px-3 py-2 ${b.occupant_name ? 'border-red-200 bg-red-50/40' : 'border-emerald-200 bg-emerald-50/40'}`}>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-sm font-semibold text-neutral-800">
                      <BedDouble size={14} className="text-gold" />{b.label}
                    </span>
                    <StatusPill value={b.occupant_name ? 'occupied' : 'available'} />
                  </div>
                  {b.occupant_name ? (
                    <p className="mt-0.5 text-xs text-neutral-600">{b.occupant_name} ({b.occupant_ref})</p>
                  ) : can('rooms.allocate') && (
                    <button className="mt-1.5 text-xs font-semibold text-gold-dark hover:underline"
                      onClick={() => { setAllocBed(b.id); setDetail(null); openAllocate(); }}>
                      Allocate this bed →
                    </button>
                  )}
                </div>
              ))}
            </div>

            {(detail.complaints?.length > 0 || detail.maintenance?.length > 0) && (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-line px-3.5 py-2.5">
                  <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-neutral-500">Room complaints</p>
                  {detail.complaints.map((c: any) => (
                    <p key={c.ticket_ref} className="text-xs text-neutral-600">· {c.ticket_ref} — {c.subject} <StatusPill value={c.status} /></p>
                  ))}
                </div>
                <div className="rounded-lg border border-line px-3.5 py-2.5">
                  <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-neutral-500">Maintenance history</p>
                  {detail.maintenance.map((m: any) => (
                    <p key={m.job_ref} className="text-xs text-neutral-600">· {m.job_ref} — {m.title} <StatusPill value={m.status} /></p>
                  ))}
                </div>
              </div>
            )}

            <FormActions>
              <button className="btn-ghost" onClick={() => setDetail(null)}>Close</button>
            </FormActions>
          </div>
        )}
      </Modal>

      {/* allocate */}
      <Modal open={allocOpen} onClose={() => setAllocOpen(false)} title="Allocate bed / check-in" width="max-w-lg">
        <div className="space-y-3.5">
          <Field label="Student" required>
            <Select value={allocStudent} onChange={(e) => setAllocStudent(e.target.value)}>
              <option value="">Select student…</option>
              {students.map((s) => <option key={s.id} value={s.id}>{s.student_ref} — {s.full_name}</option>)}
            </Select>
          </Field>
          <Field label="Bed" required hint={`${freeBeds.length} beds currently available`}>
            <Select value={allocBed} onChange={(e) => setAllocBed(e.target.value)}>
              <option value="">Select bed…</option>
              {freeBeds.map((b) => (
                <option key={b.id} value={b.id}>{b.property_name} · {b.building_name} · Room {b.room_number} · {b.label}</option>
              ))}
            </Select>
          </Field>
          <FormGrid>
            <Field label="Check-in date" required>
              <Input type="date" value={allocDates.check_in_date} onChange={(e) => setAllocDates({ ...allocDates, check_in_date: e.target.value })} />
            </Field>
            <Field label="Expected check-out">
              <Input type="date" value={allocDates.check_out_date} onChange={(e) => setAllocDates({ ...allocDates, check_out_date: e.target.value })} />
            </Field>
          </FormGrid>
          <p className="rounded-lg bg-gold-soft px-3 py-2 text-[11.5px] text-gold-dark">
            Overlapping active allocations of the same bed are blocked by the database — a conflict returns an error immediately.
          </p>
        </div>
        <FormActions>
          <button className="btn-ghost" onClick={() => setAllocOpen(false)}>Cancel</button>
          <button className="btn-gold" onClick={confirmAlloc}>Allocate Bed</button>
        </FormActions>
      </Modal>

      {/* transfer */}
      <Modal open={Boolean(transfer)} onClose={() => setTransfer(null)} title="Transfer student to another bed" width="max-w-md">
        {transfer && (
          <>
            <p className="mb-3 text-sm text-neutral-600">
              Moving <span className="font-semibold">{transfer.alloc.student_name}</span> from{' '}
              {transfer.alloc.property_name} · Room {transfer.alloc.room_number} · {transfer.alloc.bed_label}
            </p>
            <Field label="Target bed" required>
              <Select value={transfer.bed_id} onChange={(e) => setTransfer({ ...transfer, bed_id: e.target.value })}>
                <option value="">Select bed…</option>
                {freeBeds.map((b) => (
                  <option key={b.id} value={b.id}>{b.property_name} · {b.building_name} · Room {b.room_number} · {b.label}</option>
                ))}
              </Select>
            </Field>
            <FormActions>
              <button className="btn-ghost" onClick={() => setTransfer(null)}>Cancel</button>
              <button className="btn-gold" onClick={doTransfer} disabled={!transfer.bed_id}>Transfer</button>
            </FormActions>
          </>
        )}
      </Modal>

      <ConfirmDialog open={Boolean(checkoutId)} onClose={() => setCheckoutId(null)} onConfirm={doCheckout}
        title="Check out student?" message="The allocation will be completed today and the bed released back to available inventory."
        confirmLabel="Check Out" />
    </div>
  );
}

function Eye14() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg>;
}
