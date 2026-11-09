import { useEffect, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, BarChart, Bar,
} from 'recharts';
import {
  Banknote, ReceiptText, Truck, TrendingUp, TrendingDown, Clock, AlertTriangle, Landmark, Percent,
} from 'lucide-react';
import { api } from '../../lib/api';
import { EmptyState, MiniStat, Spinner, PanelHeader, StatusPill } from '../../components/ui';
import { zar, fmtDate } from '../../lib/format';

interface Overview {
  generated_at: string;
  currency: string;
  cash: { total: number; accounts: any[]; unreconciled: number };
  receivables: { outstanding: number; overdue_amount: number; overdue_count: number; invoiced_total: number; collected_total: number };
  payables: { outstanding: number; invoice_count: number; overdue_amount: number; overdue_count: number };
  revenue: { month: number; year: number; rental_year: number };
  expenses: { month: number; year: number };
  profit: { month: number; year: number };
  series: { month: string; income: number; expense: number; net: number }[];
  top_income: { name: string; amount: number }[];
  top_expenses: { name: string; amount: number }[];
  liabilities: { payroll: number; vat_output: number; vat_input: number };
  budget: { approved: number; actual_income: number; actual_expense: number };
  pending_approvals: Record<string, number>;
  period: { period_key: string; status: string } | null;
  locked: boolean;
}

export function FinanceDashboard() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<Overview>('/finance/overview')
      .then((r) => { setData(r); setError(null); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spinner label="Loading financial overview…" />;
  if (error) return <EmptyState icon={<AlertTriangle size={22} />} title="Could not load the finance dashboard" hint={error} />;
  if (!data) return null;

  const noActivity = data.revenue.year === 0 && data.expenses.year === 0 && data.cash.total === 0
    && data.receivables.outstanding === 0 && data.payables.outstanding === 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-neutral-500">
          Base currency {data.currency} · generated {new Date(data.generated_at).toLocaleTimeString()}
        </p>
        {data.period && (
          <span className={`pill ${data.locked ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
            Period {data.period.period_key}: {data.period.status}
          </span>
        )}
      </div>

      {noActivity && (
        <EmptyState
          icon={<Banknote size={22} />}
          title="No financial activity recorded yet"
          hint="Figures appear once invoices, payments, expenses or journals are recorded. Nothing on this screen is estimated."
        />
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <MiniStat label="Cash & bank" value={zar(data.cash.total, 2)} tone="gold" />
        <MiniStat label="Receivables" value={zar(data.receivables.outstanding, 2)} />
        <MiniStat label="Payables" value={zar(data.payables.outstanding, 2)} tone="red" />
        <MiniStat label="Revenue (YTD)" value={zar(data.revenue.year, 2)} tone="green" />
        <MiniStat label="Expenses (YTD)" value={zar(data.expenses.year, 2)} tone="red" />
        <MiniStat label="Profit (YTD)" value={zar(data.profit.year, 2)} tone={data.profit.year >= 0 ? 'green' : 'red'} />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <MiniStat label="Revenue (month)" value={zar(data.revenue.month, 2)} />
        <MiniStat label="Expenses (month)" value={zar(data.expenses.month, 2)} />
        <MiniStat label="Overdue invoices" value={`${data.receivables.overdue_count} · ${zar(data.receivables.overdue_amount, 2)}`} tone="red" />
        <MiniStat label="Unreconciled bank items" value={data.cash.unreconciled} tone={data.cash.unreconciled ? 'gold' : 'default'} />
        <MiniStat label="PAYE/UIF/SDL owed" value={zar(data.liabilities.payroll, 2)} tone="gold" />
        <MiniStat label="Pending approvals" value={data.pending_approvals.total} tone={data.pending_approvals.total ? 'red' : 'default'} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="panel lg:col-span-2">
          <PanelHeader title="Income vs expenses" sub="Posted journal entries only — drafts are excluded" />
          <div className="h-72 px-3 py-3">
            {data.series.every((s) => Number(s.income) === 0 && Number(s.expense) === 0) ? (
              <EmptyState title="No data available" hint="Information will appear here once journals have been posted." />
            ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.series}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v: any) => zar(Number(v), 2)} />
                <Line type="monotone" dataKey="income" name="Income" stroke="#16a34a" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="expense" name="Expenses" stroke="#dc2626" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="panel">
          <PanelHeader title="Cash position" sub="Recorded bank & cash accounts" />
          <div className="p-3">
            {data.cash.accounts.length === 0 && <EmptyState title="No bank accounts configured" hint="Add an account in Finance → Banking." />}
            <ul className="space-y-2">
              {data.cash.accounts.map((a) => (
                <li key={a.id} className="flex items-center justify-between rounded-lg border border-line px-3 py-2 text-xs">
                  <span>
                    <span className="block font-semibold text-neutral-800">{a.name}</span>
                    <span className="text-neutral-400">{a.bank_name || a.account_type}</span>
                  </span>
                  <span className="font-bold text-neutral-800">{zar(a.balance, 2)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="panel">
          <PanelHeader title="Top income (YTD)" />
          <div className="h-56 px-3 py-3">
            {data.top_income.length === 0 ? <EmptyState title="No posted income" hint="Post revenue journals to see this chart." /> : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.top_income} layout="vertical">
                  <XAxis type="number" hide /><YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v: any) => zar(Number(v), 2)} />
                  <Bar dataKey="amount" fill="#16a34a" radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
        <div className="panel">
          <PanelHeader title="Top expenses (YTD)" />
          <div className="h-56 px-3 py-3">
            {data.top_expenses.length === 0 ? <EmptyState title="No posted expenses" hint="Approve expenses or post cost journals to see this chart." /> : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.top_expenses} layout="vertical">
                  <XAxis type="number" hide /><YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v: any) => zar(Number(v), 2)} />
                  <Bar dataKey="amount" fill="#dc2626" radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="panel">
          <PanelHeader title="Pending approvals" />
          <ul className="space-y-1.5 p-4 text-xs">
            {Object.entries(data.pending_approvals).filter(([k]) => k !== 'total').map(([k, v]) => (
              <li key={k} className="flex items-center justify-between">
                <span className="text-neutral-600">{k.replace(/_/g, ' ')}</span>
                <span className={`font-bold ${v ? 'text-red-600' : 'text-neutral-400'}`}>{v}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="panel">
          <PanelHeader title="Budget" sub="Approved budget vs actual" />
          <div className="space-y-2 p-4">
            <MiniStat label="Approved budget (year)" value={zar(data.budget.approved, 2)} tone="gold" />
            <MiniStat label="Actual income" value={zar(data.budget.actual_income, 2)} tone="green" />
            <MiniStat label="Actual expenses" value={zar(data.budget.actual_expense, 2)} tone="red" />
          </div>
        </div>
        <div className="panel">
          <PanelHeader title="Tax & statutory" />
          <div className="space-y-2 p-4">
            <MiniStat label="VAT output owed" value={zar(data.liabilities.vat_output, 2)} tone="red" />
            <MiniStat label="VAT input claimable" value={zar(data.liabilities.vat_input, 2)} tone="green" />
            <MiniStat label="Payroll liabilities" value={zar(data.liabilities.payroll, 2)} tone="gold" />
            <p className="text-[11px] text-neutral-400">Deadlines and filing references are shown in Finance → Tax. No SARS integration is configured.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
