import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Building2, Pencil, Search, BedDouble, DoorClosed, Layers } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../auth';
import {
  PageHeader, Field, Input, Select, Textarea, FormGrid, FormActions, Modal,
  StatusPill, toast, Spinner, EmptyState, MiniStat,
} from '../components/ui';
import { DataTable, Column, TableToolbar } from '../components/DataTable';
import { fmtDate, titleCase } from '../lib/format';
import type { Property, Building, Paginated, Staff } from '../lib/types';

const emptyForm = {
  name: '', address: '', city: '', province: 'Gauteng', manager_staff_id: '',
  contact_email: '', contact_phone: '', description: '', facilities: '', status: 'active',
};

export default function Properties() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [rows, setRows] = useState<Property[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 25, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);

  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({ ...emptyForm });
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [staff, setStaff] = useState<Staff[]>([]);

  const [detail, setDetail] = useState<(Property & any) | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [bldOpen, setBldOpen] = useState(false);
  const [bldForm, setBldForm] = useState({ name: '', floors: 1, description: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ page: String(page), pageSize: '25' });
      if (q) p.set('q', q);
      if (status) p.set('status', status);
      const res = await api.get<Paginated<Property>>(`/properties?${p.toString()}`);
      setRows(res.data);
      setPagination(res.pagination);
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  }, [page, q, status]);

  useEffect(() => { const t = setTimeout(load, q ? 300 : 0); return () => clearTimeout(t); }, [load, q]);
  useEffect(() => {
    api.get<Paginated<Staff>>('/staff?pageSize=200').then((r) => setStaff(r.data)).catch(() => {});
  }, []);

  const openDetail = async (id: string) => {
    setDetailLoading(true);
    try {
      const data = await api.get<Property & any>(`/properties/${id}`);
      setDetail(data);
      const next = new URLSearchParams(params); next.set('id', id); setParams(next, { replace: true });
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setDetailLoading(false); }
  };
  const closeDetail = () => {
    setDetail(null);
    const next = new URLSearchParams(params); next.delete('id'); setParams(next, { replace: true });
  };

  useEffect(() => {
    const id = params.get('id');
    if (id) openDetail(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async () => {
    if (!form.name.trim()) { toast('Property name is required', 'error'); return; }
    setSaving(true);
    try {
      if (editId) {
        await api.patch(`/properties/${editId}`, form);
        toast('Property updated');
      } else {
        const created = await api.post<Property>('/properties', form);
        toast(`Property ${created.property_ref} created`);
      }
      setFormOpen(false); setEditId(null); setForm({ ...emptyForm }); load();
      if (detail) openDetail(detail.id);
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setSaving(false); }
  };

  const addBuilding = async () => {
    if (!bldForm.name.trim() || !detail) { toast('Building name is required', 'error'); return; }
    try {
      await api.post('/buildings', { ...bldForm, property_id: detail.id });
      toast('Building added');
      setBldOpen(false); setBldForm({ name: '', floors: 1, description: '' });
      openDetail(detail.id);
      load();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const parseFac = (f: string | string[]): string[] => {
    if (Array.isArray(f)) return f;
    try { const p = JSON.parse(f); return Array.isArray(p) ? p : []; } catch { return []; }
  };

  const columns: Column<Property>[] = [
    { key: 'property_ref', header: 'Reference', render: (p) => <span className="font-semibold text-neutral-700">{p.property_ref}</span> },
    {
      key: 'name', header: 'Property',
      render: (p) => (
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink text-gold"><Building2 size={15} /></span>
          <div>
            <p className="font-medium text-neutral-800">{p.name}</p>
            <p className="text-[11px] text-neutral-400">{p.city || '—'}{p.province ? `, ${p.province}` : ''}</p>
          </div>
        </div>
      ),
    },
    { key: 'address', header: 'Address', render: (p) => <span className="block max-w-[240px] truncate text-xs text-neutral-600" title={p.address || ''}>{p.address || '—'}</span> },
    { key: 'manager_name', header: 'Manager', render: (p) => <span className="text-xs text-neutral-600">{p.manager_name || 'Unassigned'}</span> },
    { key: 'building_count', header: 'Buildings', render: (p) => <span className="text-xs font-semibold">{p.building_count ?? 0}</span> },
    { key: 'room_count', header: 'Rooms', render: (p) => <span className="text-xs font-semibold">{p.room_count ?? 0}</span> },
    {
      key: 'bed_count', header: 'Beds',
      render: (p) => <span className="pill bg-gold-soft text-gold-dark">{p.bed_count ?? 0}</span>,
    },
    { key: 'status', header: 'Status', render: (p) => <StatusPill value={p.status} /> },
    {
      key: 'actions', header: '', className: 'text-right',
      render: (p) => can('properties.manage') && (
        <button className="rounded p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
          title="Edit property" onClick={(e) => {
            e.stopPropagation();
            setForm({
              name: p.name, address: p.address || '', city: p.city || '', province: p.province || '',
              manager_staff_id: p.manager_staff_id || '', contact_email: p.contact_email || '',
              contact_phone: p.contact_phone || '', description: p.description || '',
              facilities: parseFac(p.facilities || '[]').join(', '), status: p.status,
            });
            setEditId(p.id); setFormOpen(true);
          }}><Pencil size={14} /></button>
      ),
    },
  ];

  const d = detail;

  return (
    <div>
      <PageHeader
        title="Properties & Buildings"
        subtitle="Manage the property portfolio, buildings, contacts and facilities."
        actions={can('properties.manage') && (
          <button className="btn-gold inline-flex items-center gap-1.5"
            onClick={() => { setForm({ ...emptyForm }); setEditId(null); setFormOpen(true); }}>
            <Plus size={15} /> Add Property
          </button>
        )}
      />

      <div className="panel overflow-hidden">
        <DataTable
          rows={rows} columns={columns} loading={loading} rowKey={(p) => p.id}
          onRowClick={(p) => openDetail(p.id)}
          page={pagination.page} pageSize={pagination.pageSize} total={pagination.total}
          totalPages={pagination.totalPages} onPageChange={setPage}
          emptyTitle="No properties registered yet"
          emptyHint="Add your first property to start tracking buildings, rooms, beds and tenants."
          toolbar={
            <TableToolbar>
              <div className="relative min-w-[220px] flex-1">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }}
                  placeholder="Search properties…" aria-label="Search properties" className="field !py-1.5 !pl-9 text-xs" />
              </div>
              <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}
                aria-label="Filter status" className="field !w-auto !py-1.5 text-xs">
                <option value="">All statuses</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </TableToolbar>
          }
        />
      </div>

      {/* form */}
      <Modal open={formOpen} onClose={() => setFormOpen(false)}
        title={editId ? 'Edit Property' : 'Add Property'} width="max-w-3xl">
        <FormGrid>
          <Field label="Property name" required>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Faranani Heights" autoFocus />
          </Field>
          <Field label="Status">
            <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="Physical address">
              <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="12 Nugget Street, Braamfontein" />
            </Field>
          </div>
          <Field label="City">
            <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="Johannesburg" />
          </Field>
          <Field label="Province">
            <Input value={form.province} onChange={(e) => setForm({ ...form, province: e.target.value })} placeholder="Gauteng" />
          </Field>
          <Field label="Property manager">
            <Select value={form.manager_staff_id} onChange={(e) => setForm({ ...form, manager_staff_id: e.target.value })}>
              <option value="">Unassigned</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name} — {s.job_title || ''}</option>)}
            </Select>
          </Field>
          <Field label="Contact email">
            <Input type="email" value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} />
          </Field>
          <Field label="Contact phone">
            <Input value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} />
          </Field>
          <Field label="Facilities" hint="Comma separated, e.g. Wi-Fi, 24/7 Security, Laundry">
            <Input value={form.facilities} onChange={(e) => setForm({ ...form, facilities: e.target.value })} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Description">
              <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </Field>
          </div>
        </FormGrid>
        <FormActions>
          <button className="btn-ghost" onClick={() => setFormOpen(false)}>Cancel</button>
          <button className="btn-gold" onClick={submit} disabled={saving}>
            {saving ? 'Saving…' : editId ? 'Save Changes' : 'Create Property'}
          </button>
        </FormActions>
      </Modal>

      {/* detail */}
      <Modal open={detailLoading || Boolean(d)} onClose={closeDetail}
        title={d ? `${d.name} · ${d.property_ref}` : 'Property'} width="max-w-4xl">
        {detailLoading || !d ? <Spinner /> : (
          <div>
            <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <MiniStat label="Buildings" value={d.buildings?.length ?? 0} />
              <MiniStat label="Rooms" value={(d.buildings || []).reduce((s: number, b: any) => s + (b.room_count || 0), 0)} />
              <MiniStat label="Beds" value={(d.bedSummary || []).reduce((s: number, b: any) => s + b.c, 0)} />
              <MiniStat label="Status" value={<StatusPill value={d.status} />} />
            </div>

            <div className="mb-4 rounded-lg border border-line bg-neutral-50/60 px-3.5 py-2.5 text-sm">
              <p className="text-neutral-700">{d.description || 'No description provided.'}</p>
              <p className="mt-1 text-xs text-neutral-500">
                {d.address}{d.city ? ` · ${d.city}` : ''}{d.province ? `, ${d.province}` : ''}
              </p>
              <p className="text-xs text-neutral-500">
                {d.contact_email} · {d.contact_phone} · Manager: {d.manager_name || 'Unassigned'}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {parseFac(d.facilities || '[]').map((f) => (
                  <span key={f} className="pill bg-gold-soft text-gold-dark">{f}</span>
                ))}
              </div>
            </div>

            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-wide text-neutral-500">Buildings</p>
              {can('properties.manage') && (
                <button className="btn-ghost !py-1 text-xs" onClick={() => setBldOpen(true)}>
                  <Layers size={12} className="mr-1 inline" />Add Building
                </button>
              )}
            </div>
            <div className="grid gap-2.5 sm:grid-cols-2">
              {(d.buildings || []).map((b: Building) => (
                <div key={b.id} className="rounded-lg border border-line px-3.5 py-2.5">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-neutral-800">{b.name}</p>
                    <span className="pill bg-neutral-100 text-neutral-500">{b.building_ref}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-neutral-500">
                    {b.floors || 1} floor{(b.floors || 1) > 1 ? 's' : ''} · {b.room_count || 0} rooms
                  </p>
                </div>
              ))}
              {(d.buildings || []).length === 0 && (
                <div className="sm:col-span-2"><EmptyState title="No buildings yet" hint="Add a building to start creating rooms." /></div>
              )}
            </div>

            <div className="mt-4 rounded-lg border border-line">
              <p className="border-b border-line px-3.5 py-2 text-xs font-bold uppercase tracking-wide text-neutral-500">
                Bed status summary
              </p>
              <div className="flex flex-wrap gap-4 px-3.5 py-3 text-sm">
                {(d.bedSummary || []).length === 0 && <span className="text-xs text-neutral-400">No beds configured yet.</span>}
                {(d.bedSummary || []).map((b: any) => (
                  <span key={b.status} className="flex items-center gap-1.5">
                    <StatusPill value={b.status} />
                    <span className="font-bold text-neutral-700">{b.c}</span>
                  </span>
                ))}
              </div>
            </div>

            <FormActions>
              <button className="btn-ghost" onClick={closeDetail}>Close</button>
              {can('properties.manage') && (
                <button className="btn-gold" onClick={() => {
                  setForm({
                    name: d.name, address: d.address || '', city: d.city || '', province: d.province || '',
                    manager_staff_id: d.manager_staff_id || '', contact_email: d.contact_email || '',
                    contact_phone: d.contact_phone || '', description: d.description || '',
                    facilities: parseFac(d.facilities || '[]').join(', '), status: d.status,
                  });
                  setEditId(d.id); closeDetail(); setFormOpen(true);
                }}>
                  <Pencil size={13} className="mr-1 inline" />Edit Property
                </button>
              )}
            </FormActions>
          </div>
        )}
      </Modal>

      {/* add building */}
      <Modal open={bldOpen} onClose={() => setBldOpen(false)} title="Add Building" width="max-w-md">
        <FormGrid>
          <Field label="Building name" required>
            <Input value={bldForm.name} onChange={(e) => setBldForm({ ...bldForm, name: e.target.value })} placeholder="Block A" autoFocus />
          </Field>
          <Field label="Floors">
            <Input type="number" min={1} max={40} value={bldForm.floors}
              onChange={(e) => setBldForm({ ...bldForm, floors: Number(e.target.value) })} />
          </Field>
        </FormGrid>
        <div className="mt-3.5">
          <Field label="Description">
            <Textarea value={bldForm.description} onChange={(e) => setBldForm({ ...bldForm, description: e.target.value })} />
          </Field>
        </div>
        <FormActions>
          <button className="btn-ghost" onClick={() => setBldOpen(false)}>Cancel</button>
          <button className="btn-gold" onClick={addBuilding}>Add Building</button>
        </FormActions>
      </Modal>
    </div>
  );
}
