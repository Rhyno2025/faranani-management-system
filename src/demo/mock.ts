// ---------------------------------------------------------------------------
// Static demo backend.
//
// The GitHub Pages build has no Node server, so this module answers the API
// calls the SPA makes using a snapshot recorded from the real Express API by
// scripts/build-demo-snapshot.mjs. Shapes therefore match the live API exactly.
//
// Enabled only when VITE_DEMO is set at build time; the real app never imports
// it at runtime beyond a single boolean check.
// ---------------------------------------------------------------------------
import snapshot from './snapshot.json';

type Json = any;
const data = snapshot as Record<string, Json>;

export const isDemo = import.meta.env.VITE_DEMO === '1' || import.meta.env.VITE_DEMO === 'true';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

function lookup(method: string, path: string): Json | undefined {
  const clean = path.split('?')[0];
  const direct = `${method} ${clean}`;
  if (direct in data) return data[direct];
  const generic = `${method} ${clean.replace(UUID, ':id')}`;
  if (generic in data) return data[generic];
  return undefined;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clone = <T,>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

function emptyFor(method: string, path: string): Json {
  if (method !== 'GET') return { ok: true };
  const clean = path.split('?')[0];
  // List endpoints answer with an empty page, detail endpoints with a record.
  const listLike = !/\/[0-9a-f-]{20,}$/i.test(clean);
  if (listLike) return { data: [], items: [], total: 0, pagination: { page: 1, pageSize: 25, total: 0, totalPages: 1 } };
  return {};
}

export async function demoRequest<T = Json>(method: string, path: string, body?: unknown): Promise<T> {
  await sleep(120);
  if (method === 'POST' && path === '/auth/logout') return { ok: true } as T;
  const hit = lookup(method, path);
  if (hit !== undefined) return clone(hit) as T;
  // Writes in the demo are acknowledged but not persisted to a server.
  if (body && typeof body === 'object') return clone({ ok: true, ...(body as Json) }) as T;
  return clone(emptyFor(method, path)) as T;
}

export async function demoUpload<T = Json>(path: string, fields: Record<string, string>): Promise<T> {
  await sleep(200);
  return { ok: true, id: `demo-${Date.now()}`, ...fields, path } as T;
}

/** Saves a small CSV so download buttons behave like the real system. */
export function demoDownload(name: string): void {
  const rows = [
    'reference,description,amount',
    'FAR-DEMO-001,Sample export from the static demo,4800.00',
  ].join('\n');
  const url = URL.createObjectURL(new Blob([rows], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
