// ---------------------------------------------------------------------------
// Formatting helpers — South African currency and Africa/Johannesburg dates.
// ---------------------------------------------------------------------------

/** ZAR currency: R184,500.00 */
export function zar(v: number | null | undefined, decimals = 0): string {
  const n = Number(v || 0);
  return `R${n.toLocaleString('en-ZA', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

export function zarShort(v: number | null | undefined): string {
  const n = Number(v || 0);
  if (Math.abs(n) >= 1_000_000) return `R${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `R${(n / 1_000).toFixed(n >= 100_000 ? 0 : 1)}k`;
  return `R${n.toFixed(0)}`;
}

const TZ = 'Africa/Johannesburg';

/** Date only, e.g. 27 Oct 2026 */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric', timeZone: TZ });
}

/** Date + time, e.g. 27 Oct 2026, 12:45 */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-ZA', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ,
  });
}

/** Time only, e.g. 12:45 */
export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ });
}

/** "Today, 11:20" / "Yesterday, 14:10" / "26 Oct, 11:08" */
export function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const now = new Date();
  const dayMs = 86_400_000;
  const dDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const nDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const time = d.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ });
  if (dDay === nDay) return `Today, ${time}`;
  if (nDay - dDay === dayMs) return `Yesterday, ${time}`;
  return d.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', timeZone: TZ }) + `, ${time}`;
}

/** SAST "now" as Date (UTC+2) — used by the live clock. */
export function nowSAST(): Date {
  return new Date(Date.now());
}

export function sastClock(d: Date = new Date()): string {
  return d.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: TZ });
}

export function sastDate(d: Date = new Date()): string {
  return d.toLocaleDateString('en-ZA', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone: TZ });
}

export function todayISO(): string {
  // Date in Africa/Johannesburg
  return new Date(Date.now() + 2 * 3600 * 1000).toISOString().slice(0, 10);
}

export function monthStartISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

export function monthEndISO(): string {
  const d = new Date();
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
}

export function relativeDay(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  const now = new Date();
  const diff = Math.round(
    (new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
      - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86_400_000
  );
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff < 0) return `${Math.abs(diff)} days overdue`;
  return `In ${diff} days`;
}

export function titleCase(s: string | null | undefined): string {
  if (!s) return '—';
  return String(s).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function initials(name: string): string {
  return name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
}
