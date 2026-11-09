import { useEffect, useState } from 'react';
import { Building2 } from 'lucide-react';
import { api } from '../../lib/api';
import { EmptyState, Spinner } from '../../components/ui';
import { DataTable } from '../../components/DataTable';

export function PropertyAdmin() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get<{ data: any[] }>('/office/properties');
      setData(res.data || []);
    } catch (e) {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  if (loading) return <Spinner label="Loading properties..." />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-neutral-800">Property Administration</h3>
          <p className="text-xs text-neutral-500">Manage property records, buildings and documentation</p>
        </div>
      </div>

      {data.length === 0 ? (
        <EmptyState icon={<Building2 size={22} />} title="No properties found" hint="Properties from the existing property database are shown here." />
      ) : (
        <DataTable
          rows={data}
          columns={[
            { key: 'name', header: 'Property Name' },
            { key: 'property_ref', header: 'Property Ref' },
            { key: 'address', header: 'Address' },
            { key: 'building_count', header: 'Buildings' },
            { key: 'room_count', header: 'Rooms' },
            { key: 'status', header: 'Status' },
          ]}
          rowKey={(r: any) => r.id}
          loading={loading}
        />
      )}
    </div>
  );
}
