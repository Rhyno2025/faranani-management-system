import { useEffect, useState } from 'react';
import { Download, FileBarChart } from 'lucide-react';
import { api } from '../../lib/api';
import { toast, Spinner, EmptyState, MiniStat, Field, Input, FormGrid } from '../../components/ui';
import { fmtDate, zar, titleCase, monthStartISO, todayISO } from '../../lib/format';
import { downloadFile } from '../../lib/api';

type ReportKey = 'profit-and-loss' | 'balance-sheet' | 'trial-balance' | 'ar-aging' | 'ap-aging' | 'budget-vs-actual' | 'tax' | 'cash-flow';

const REPORTS: { key: ReportKey; label: string }[] = [
  { key: 'profit-and-loss', label: 'Profit & Loss' },
  { key: 'balance-sheet', label: 'Balance Sheet' },
  { key: 'trial-balance', label: 'Trial Balance' },
  { key: 'ar-aging', label: 'Receivables Ageing' },
  { key: 'ap-aging', label: 'Payables Ageing' },
  { key: 'budget-vs-actual', label: 'Budget vs Actual' },
  { key: 'cash-flow', label: 'Cash Flow' },
  { key: 'tax', label: 'Tax & Statutory' },
];

export function FinanceReports() {
  const [report, setReport] = useState<ReportKey>('profit-and-loss');
  const [from, setFrom] = useState(monthStartISO());
  const [to, setTo] = useState(todayISO());
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true); setError(null);
    const q = `from=${from}&to=${to}`;
    const req = report === 'budget-vs-actual'
      ? api.get(`/reports/budget-vs-actual?year=${from.slice(0, 4)}`)
      : report === 'tax'
        ? api.get('/tax/obligations')
        : api.get(`/reports/${report}?${q}`);
    req.then((r) => setData(r)).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, [report, from, to]);

  const exportJournals = async () => {
    try { await downloadFile(`/reports/journals.csv?from=${from}&to=${to}`, 'journal-report.csv'); }
    catch (e: any) { toast(e.message, 'error'); }
  };

  const th = 'px-3 py-2 text-left text-[10.5px] font-bold uppercase tracking-wide text-neutral-500';
  const td = 'px-3 py-2 text-xs';
  const num = 'px-3 py-2 text-right text-xs tabular-nums';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {REPORTS.map((r) => (
            <button key={r.key} onClick={() => setReport(r.key)}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                report === r.key ? 'bg-ink text-gold' : 'border border-line bg-white text-neutral-600 hover:border-gold/60'
              }`}>
              {r.label}
            </button>
          ))}
        </div>
        <button className="btn-ghost inline-flex items-center gap-1.5" onClick={exportJournals}>
          <Download size={14} /> Export journals (CSV)
        </button>
      </div>

      {report !== 'tax' && report !== 'budget-vs-actual' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
      )}

      {loading && <Spinner label="Running report…" />}
      {error && <EmptyState title="Report failed" hint={error} />}

      {!loading && !error && data && (
        <div className="overflow-hidden rounded-xl border border-line">
          <p className="border-b border-line bg-neutral-50 px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-neutral-500">
            {REPORTS.find((r) => r.key === report)?.label}
            {report !== 'tax' && report !== 'budget-vs-actual' ? ` · ${fmtDate(from)} → ${fmtDate(to)}` : ''}
          </p>

          {/* ---------------- profit & loss ---------------- */}
          {report === 'profit-and-loss' && (
            data.income_total === 0 && data.expense_total === 0
              ? <EmptyState title="No posted activity in this period" hint="Financial statements only include posted journal entries." />
              : (
                <div className="p-4">
                  <table className="data-table">
                    <thead><tr><th className={th}>Income</th><th className={num}>Amount</th></tr></thead>
                    <tbody>
                      {data.income.map((r: any) => <tr key={r.id}><td className={td}>{r.code} — {r.name}</td><td className={num}>{zar(r.amount, 2)}</td></tr>)}
                      <tr className="bg-neutral-50"><td className={`${td} font-bold`}>Total income</td><td className={`${num} font-bold`}>{zar(data.income_total, 2)}</td></tr>
                    </tbody>
                  </table>
                  <table className="data-table mt-4">
                    <thead><tr><th className={th}>Expenses</th><th className={num}>Amount</th></tr></thead>
                    <tbody>
                      {data.expense.map((r: any) => <tr key={r.id}><td className={td}>{r.code} — {r.name}</td><td className={num}>{zar(r.amount, 2)}</td></tr>)}
                      <tr className="bg-neutral-50"><td className={`${td} font-bold`}>Total expenses</td><td className={`${num} font-bold`}>{zar(data.expense_total, 2)}</td></tr>
                      <tr className={data.net_profit >= 0 ? 'bg-emerald-50' : 'bg-red-50'}>
                        <td className={`${td} font-bold`}>Net {data.net_profit >= 0 ? 'profit' : 'loss'}</td>
                        <td className={`${num} font-bold ${data.net_profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{zar(data.net_profit, 2)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )
          )}

          {/* ---------------- balance sheet ---------------- */}
          {report === 'balance-sheet' && (
            data.total_assets === 0 && data.total_liabilities === 0
              ? <EmptyState title="No balances to report" hint="Post journals to build the balance sheet." />
              : (
                <div className="grid gap-4 p-4 lg:grid-cols-3">
                  {([['Assets', data.assets, data.total_assets], ['Liabilities', data.liabilities, data.total_liabilities], ['Equity', data.equity, data.total_equity]] as const).map(([title, list, total]) => (
                    <div key={title}>
                      <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-neutral-500">{title}</p>
                      <table className="data-table">
                        <tbody>
                          {list.map((a: any) => (
                            <tr key={a.id}><td className={td}>{a.code} — {a.name}</td><td className={num}>{zar(a.balance, 2)}</td></tr>
                          ))}
                          {list.length === 0 && <tr><td className={`${td} text-neutral-400`} colSpan={2}>No balances</td></tr>}
                          <tr className="bg-neutral-50"><td className={`${td} font-bold`}>Total</td><td className={`${num} font-bold`}>{zar(total, 2)}</td></tr>
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              )
          )}

          {/* ---------------- trial balance ---------------- */}
          {report === 'trial-balance' && (
            data.rows.length === 0
              ? <EmptyState title="Trial balance is empty" hint="No posted journal lines in this period." />
              : (
                <div className="p-4">
                  <table className="data-table">
                    <thead><tr><th className={th}>Code</th><th className={th}>Account</th><th className={num}>Debit</th><th className={num}>Credit</th></tr></thead>
                    <tbody>
                      {data.rows.map((r: any) => (
                        <tr key={r.id}><td className={td}>{r.code}</td><td className={td}>{r.name}</td>
                          <td className={num}>{r.debit ? zar(r.debit, 2) : '—'}</td><td className={num}>{r.credit ? zar(r.credit, 2) : '—'}</td></tr>
                      ))}
                      <tr className="bg-neutral-50">
                        <td className={td} colSpan={2}><strong>Totals</strong></td>
                        <td className={`${num} font-bold`}>{zar(data.total_debit, 2)}</td>
                        <td className={`${num} font-bold`}>{zar(data.total_credit, 2)}</td>
                      </tr>
                    </tbody>
                  </table>
                  <p className={`mt-2 text-xs font-semibold ${data.balanced ? 'text-emerald-600' : 'text-red-600'}`}>
                    {data.balanced ? 'Trial balance balances ✓' : 'Trial balance does NOT balance — investigate before reporting.'}
                  </p>
                </div>
              )
          )}

          {/* ---------------- ageing ---------------- */}
          {(report === 'ar-aging' || report === 'ap-aging') && (
            <div className="p-4">
              <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
                {Object.entries(data.buckets).map(([k, v]) => <MiniStat key={k} label={k} value={zar(Number(v), 2)} tone={k === 'current' ? 'green' : 'red'} />)}
              </div>
              {data.rows.length === 0 ? <EmptyState title="Nothing outstanding" /> : (
                <table className="data-table">
                  <thead><tr>
                    <th className={th}>Reference</th><th className={th}>{report === 'ar-aging' ? 'Account' : 'Supplier'}</th>
                    <th className={th}>Due</th><th className={num}>Outstanding</th><th className={th}>Bucket</th>
                  </tr></thead>
                  <tbody>
                    {data.rows.map((r: any) => (
                      <tr key={r.id}>
                        <td className={td}>{r.invoice_ref || r.ap_ref}</td>
                        <td className={td}>{report === 'ar-aging' ? `${r.full_name} (${r.student_ref})` : r.supplier_name}</td>
                        <td className={td}>{fmtDate(r.due_date)}</td>
                        <td className={num}>{zar(r.due, 2)}</td>
                        <td className={td}>{r.bucket}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* ---------------- budget vs actual ---------------- */}
          {report === 'budget-vs-actual' && (
            <div className="p-4">
              {!data.rows?.length ? <EmptyState title={`No approved budget for ${data.year}`} hint="Create and approve a budget to compare it with actuals." /> : (
                <>
                  <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                    <MiniStat label="Budget" value={zar(data.total_budget, 2)} tone="gold" />
                    <MiniStat label="Actual" value={zar(data.total_actual, 2)} />
                    <MiniStat label="Variance" value={zar(data.total_budget - data.total_actual, 2)} tone="green" />
                  </div>
                  <table className="data-table">
                    <thead><tr><th className={th}>Account</th><th className={num}>Budget</th><th className={num}>Actual</th><th className={num}>Variance</th></tr></thead>
                    <tbody>
                      {data.rows.map((r: any) => (
                        <tr key={r.account_id}>
                          <td className={td}>{r.code} — {r.name}</td>
                          <td className={num}>{zar(r.budget, 2)}</td>
                          <td className={num}>{zar(r.actual, 2)}</td>
                          <td className={`${num} font-semibold ${r.variance < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{zar(r.variance, 2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          )}

          {/* ---------------- cash flow ---------------- */}
          {report === 'cash-flow' && (
            <div className="grid grid-cols-3 gap-3 p-4">
              <MiniStat label="Money in" value={zar(data.inflow, 2)} tone="green" />
              <MiniStat label="Money out" value={zar(data.outflow, 2)} tone="red" />
              <MiniStat label="Net movement" value={zar(data.net, 2)} tone={data.net >= 0 ? 'green' : 'red'} />
            </div>
          )}

          {/* ---------------- tax ---------------- */}
          {report === 'tax' && (
            <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
              <MiniStat label="VAT rate" value={`${(data.vat.rate * 100).toFixed(0)}%`} />
              <MiniStat label="VAT output owed" value={zar(data.vat.output, 2)} tone="red" />
              <MiniStat label="VAT return due" value={fmtDate(data.vat.due)} />
              <MiniStat label="PAYE payable" value={zar(data.paye.liability, 2)} tone="gold" />
              <MiniStat label="PAYE due" value={fmtDate(data.paye.due)} />
              <MiniStat label="UIF payable" value={zar(data.uif.liability, 2)} tone="gold" />
              <MiniStat label="SDL payable" value={zar(data.sdl.liability, 2)} tone="gold" />
              <MiniStat label="Jurisdiction" value={data.jurisdiction} />
              <p className="text-[11px] text-neutral-400 sm:col-span-4">{data.note}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
