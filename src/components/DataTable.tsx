import { ReactNode, useMemo } from 'react';
import { ChevronUp, ChevronDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { EmptyState, Spinner } from './ui';

export interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => ReactNode;
  sortValue?: (row: T) => string | number;
  className?: string;
  hideOn?: string; // e.g. 'md' → hidden below md
}

interface Props<T> {
  rows: T[];
  columns: Column<T>[];
  loading?: boolean;
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  sort?: string;
  dir?: 'asc' | 'desc';
  onSortChange?: (key: string) => void;
  page?: number;
  pageSize?: number;
  total?: number;
  totalPages?: number;
  onPageChange?: (page: number) => void;
  emptyTitle?: string;
  emptyHint?: string;
  emptyAction?: ReactNode;
  toolbar?: ReactNode;
}

export function DataTable<T>({
  rows, columns, loading, rowKey, onRowClick, sort, dir = 'asc', onSortChange,
  page = 1, pageSize = 25, total, totalPages, onPageChange,
  emptyTitle = 'No records yet', emptyHint, emptyAction, toolbar,
}: Props<T>) {
  const cols = useMemo(() => columns, [columns]);

  if (loading) return <Spinner />;
  if (!rows.length) {
    return (
      <div>
        {toolbar && <div className="border-b border-line px-4 py-3">{toolbar}</div>}
        <EmptyState title={emptyTitle} hint={emptyHint} action={emptyAction} />
      </div>
    );
  }

  const canPrev = page > 1;
  const canNext = totalPages ? page < totalPages : false;

  return (
    <div>
      {toolbar && <div className="border-b border-line px-4 py-3">{toolbar}</div>}
      <div className="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c.key} className={c.className}
                  aria-sort={sort === c.key ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                  {c.sortValue && onSortChange ? (
                    <button onClick={() => onSortChange(c.key)}
                      className="inline-flex items-center gap-1 hover:text-gold-dark">
                      {c.header}
                      {sort === c.key && (dir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
                    </button>
                  ) : c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={rowKey(row)}
                onClick={() => onRowClick?.(row)}
                className={onRowClick ? 'cursor-pointer' : ''}>
                {cols.map((c) => (
                  <td key={c.key} className={c.className}>
                    {c.render ? c.render(row) : String((row as any)[c.key] ?? '—')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs text-neutral-500">
        <span>
          Showing {rows.length} of {total ?? rows.length} record{(total ?? rows.length) === 1 ? '' : 's'}
        </span>
        {onPageChange && (
          <div className="flex items-center gap-1">
            <button className="btn-ghost !px-2 !py-1" disabled={!canPrev} onClick={() => onPageChange(1)} aria-label="First page">
              <ChevronsLeft size={13} />
            </button>
            <button className="btn-ghost !px-2 !py-1" disabled={!canPrev} onClick={() => onPageChange(page - 1)} aria-label="Previous page">
              <ChevronLeft size={13} />
            </button>
            <span className="px-2 font-medium text-neutral-700">Page {page} of {totalPages || 1}</span>
            <button className="btn-ghost !px-2 !py-1" disabled={!canNext} onClick={() => onPageChange(page + 1)} aria-label="Next page">
              <ChevronRight size={13} />
            </button>
            <button className="btn-ghost !px-2 !py-1" disabled={!canNext} onClick={() => onPageChange((totalPages || 1))} aria-label="Last page">
              <ChevronsRight size={13} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Search box + filters strip used above tables. */
export function TableToolbar({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}
