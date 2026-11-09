import { ReactNode, useEffect, useState, useCallback } from 'react';
import { X, Loader2, Inbox, AlertTriangle, CheckCircle2, Info } from 'lucide-react';

// ------------------------------- toast -------------------------------------

type ToastKind = 'success' | 'error' | 'info';
interface ToastMsg { id: number; kind: ToastKind; text: string }

let toastListeners: ((t: ToastMsg) => void)[] = [];
let toastSeq = 1;

export function toast(text: string, kind: ToastKind = 'success') {
  const msg = { id: toastSeq++, kind, text };
  toastListeners.forEach((l) => l(msg));
}

export function Toaster() {
  const [items, setItems] = useState<ToastMsg[]>([]);
  useEffect(() => {
    const listener = (t: ToastMsg) => {
      setItems((prev) => [...prev, t]);
      setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== t.id)), 4200);
    };
    toastListeners.push(listener);
    return () => { toastListeners = toastListeners.filter((l) => l !== listener); };
  }, []);
  return (
    <div aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className="toast" style={{
          background: t.kind === 'error' ? '#b91c1c' : t.kind === 'info' ? '#1f2937' : '#15803d',
        }}>
          <span className="inline-flex items-center gap-2">
            {t.kind === 'error' ? <AlertTriangle size={15} /> : t.kind === 'info' ? <Info size={15} /> : <CheckCircle2 size={15} />}
            {t.text}
          </span>
        </div>
      ))}
    </div>
  );
}

// ------------------------------- primitives --------------------------------

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-14 text-sm text-neutral-500">
      <Loader2 className="animate-spin text-gold" size={18} />
      {label}
    </div>
  );
}

export function EmptyState({ title, hint, action, icon }: {
  title: string; hint?: string; action?: ReactNode; icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-14 px-6 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gold-soft text-gold">
        {icon || <Inbox size={22} />}
      </div>
      <p className="text-sm font-semibold text-neutral-700">{title}</p>
      {hint && <p className="mt-1 max-w-md text-xs text-neutral-500">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div className="m-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      {message}
    </div>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`panel ${className}`}>{children}</div>;
}

export function PanelHeader({ title, sub, right }: { title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-3.5">
      <div>
        <h3 className="text-sm font-bold text-neutral-800">{title}</h3>
        {sub && <p className="mt-0.5 text-xs text-neutral-500">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

// -------------------------------- badge ------------------------------------

const PILL_STYLES: Record<string, string> = {
  // statuses
  active: 'bg-emerald-100 text-emerald-700',
  registered: 'bg-sky-100 text-sky-700',
  checked_out: 'bg-neutral-200 text-neutral-600',
  deactivated: 'bg-red-100 text-red-700',
  archived: 'bg-neutral-200 text-neutral-600',
  draft: 'bg-neutral-100 text-neutral-600',
  submitted: 'bg-sky-100 text-sky-700',
  under_review: 'bg-amber-100 text-amber-700',
  info_required: 'bg-orange-100 text-orange-700',
  approved: 'bg-emerald-100 text-emerald-700',
  waitlisted: 'bg-violet-100 text-violet-700',
  rejected: 'bg-red-100 text-red-700',
  open: 'bg-red-100 text-red-700',
  acknowledged: 'bg-sky-100 text-sky-700',
  assigned: 'bg-amber-100 text-amber-700',
  in_progress: 'bg-blue-100 text-blue-700',
  awaiting_student: 'bg-orange-100 text-orange-700',
  escalated: 'bg-red-200 text-red-800',
  resolved: 'bg-emerald-100 text-emerald-700',
  closed: 'bg-neutral-200 text-neutral-600',
  pending: 'bg-amber-100 text-amber-700',
  todo: 'bg-sky-100 text-sky-700',
  done: 'bg-emerald-100 text-emerald-700',
  verified: 'bg-emerald-200 text-emerald-800',
  cancelled: 'bg-neutral-200 text-neutral-600',
  partially_paid: 'bg-amber-100 text-amber-700',
  paid: 'bg-emerald-100 text-emerald-700',
  overdue: 'bg-red-100 text-red-700',
  issued: 'bg-sky-100 text-sky-700',
  void: 'bg-neutral-200 text-neutral-500 line-through',
  recorded: 'bg-sky-100 text-sky-700',
  reconciled: 'bg-emerald-100 text-emerald-700',
  approved_ : 'bg-emerald-100 text-emerald-700',
  failed_inspection: 'bg-red-100 text-red-700',
  missed: 'bg-orange-100 text-orange-700',
  completed: 'bg-emerald-100 text-emerald-700',
  available: 'bg-emerald-100 text-emerald-700',
  occupied: 'bg-red-100 text-red-700',
  out_of_service: 'bg-neutral-200 text-neutral-600',
  maintenance: 'bg-amber-100 text-amber-700',
  reserved: 'bg-violet-100 text-violet-700',
  published: 'bg-emerald-100 text-emerald-700',
  live: 'bg-emerald-100 text-emerald-700',
  demo: 'bg-amber-100 text-amber-800',
  inactive: 'bg-neutral-200 text-neutral-600',
  on_leave: 'bg-amber-100 text-amber-700',
  terminated: 'bg-red-100 text-red-700',
};

export function StatusPill({ value, label }: { value: string; label?: string }) {
  const cls = PILL_STYLES[value] || 'bg-neutral-100 text-neutral-600';
  return <span className={`pill ${cls}`}>{label || String(value).replace(/_/g, ' ')}</span>;
}

const PRIORITY_STYLES: Record<string, string> = {
  urgent: 'bg-red-600 text-white',
  high: 'bg-orange-100 text-orange-700',
  normal: 'bg-sky-100 text-sky-700',
  low: 'bg-neutral-100 text-neutral-600',
};

export function PriorityPill({ value }: { value: string }) {
  return <span className={`pill ${PRIORITY_STYLES[value] || PRIORITY_STYLES.normal}`}>{value}</span>;
}

// -------------------------------- modal ------------------------------------

export function Modal({ open, onClose, title, children, width = 'max-w-2xl' }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal-card ${width}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-white px-5 py-3.5">
          <h3 className="text-sm font-bold text-neutral-800">{title}</h3>
          <button onClick={onClose} aria-label="Close dialog"
            className="rounded-md p-1.5 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700">
            <X size={17} />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

// -------------------------------- forms ------------------------------------

export function Field({ label, required, hint, children }: {
  label: string; required?: boolean; hint?: string; children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-neutral-600">
        {label} {required && <span className="text-red-500">*</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-neutral-400">{hint}</span>}
    </label>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`field ${props.className || ''}`} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`field min-h-24 ${props.className || ''}`} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`field ${props.className || ''}`} />;
}

export function FormGrid({ children, cols = 2 }: { children: ReactNode; cols?: number }) {
  return <div className={`grid gap-3.5 ${cols === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>{children}</div>;
}

export function FormActions({ children }: { children: ReactNode }) {
  return <div className="mt-4 flex justify-end gap-2 border-t border-line pt-3.5">{children}</div>;
}

/** Confirmation dialog for destructive actions. */
export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel = 'Confirm', danger = true }: {
  open: boolean; onClose: () => void; onConfirm: () => void | Promise<void>;
  title: string; message: string; confirmLabel?: string; danger?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const run = useCallback(async () => {
    setBusy(true);
    try { await onConfirm(); } finally { setBusy(false); }
  }, [onConfirm]);
  return (
    <Modal open={open} onClose={onClose} title={title} width="max-w-md">
      <p className="text-sm text-neutral-600">{message}</p>
      <FormActions>
        <button className="btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <button className={danger ? 'btn-gold' : 'btn-gold'} onClick={run} disabled={busy}>
          {busy ? 'Working…' : confirmLabel}
        </button>
      </FormActions>
    </Modal>
  );
}

// ------------------------------ section shell -------------------------------

export function PageHeader({ title, subtitle, actions }: {
  title: string; subtitle?: string; actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-neutral-900">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-neutral-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Tabs({ tabs, active, onChange }: {
  tabs: { key: string; label: string; count?: number }[];
  active: string; onChange: (k: string) => void;
}) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => (
        <button key={t.key} onClick={() => onChange(t.key)}
          className={`relative whitespace-nowrap px-3.5 py-2 text-xs font-semibold transition ${
            active === t.key ? 'text-gold-dark' : 'text-neutral-500 hover:text-neutral-800'
          }`}>
          {t.label}
          {t.count !== undefined && (
            <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] ${
              active === t.key ? 'bg-gold-soft text-gold-dark' : 'bg-neutral-100 text-neutral-500'
            }`}>{t.count}</span>
          )}
          {active === t.key && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded bg-gold" />}
        </button>
      ))}
    </div>
  );
}

/** Small stat tile used in detail drawers. */
export function MiniStat({ label, value, tone = 'default' }: { label: string; value: ReactNode; tone?: 'default' | 'gold' | 'red' | 'green' }) {
  const tones = {
    default: 'text-neutral-800',
    gold: 'text-gold-dark',
    red: 'text-red-600',
    green: 'text-emerald-600',
  };
  return (
    <div className="rounded-lg border border-line bg-neutral-50/60 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">{label}</p>
      <p className={`mt-0.5 text-sm font-bold ${tones[tone]}`}>{value}</p>
    </div>
  );
}
