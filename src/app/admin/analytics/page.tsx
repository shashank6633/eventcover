'use client';

import { useEffect, useMemo, useState } from 'react';
import { formatCompactINR, formatMoney } from '@/lib/format';

interface AnalyticsKpis {
  totalCustomers: number;
  totalIncoming: number;
  totalCoverCharge: number;
  amountIssued: number;
  topUpsPreload: number;
  totalRedeems: number;
  leftOver: number;
  editedAmount: number;
  paymentBreakdown: {
    online: number;
    cash: number;
    card: number;
    upi: number;
    ticket: number;
  };
}

interface TxnRow {
  id: string;
  invoice_no: string;
  customer_name: string;
  customer_phone: string;
  amount: number;
  timestamp: number;
  kind: 'Issue' | 'Redeem' | 'Top Up' | 'Ticket' | 'Void';
  payment_mode: string;
  employee_name: string;
  entity_ref: string;
  entity_type: 'wallet' | 'redemption' | 'ticket';
}

interface ApiResponse {
  ok: boolean;
  lifetime: AnalyticsKpis;
  range: AnalyticsKpis;
  transactions: TxnRow[];
  employees: string[];
  rangeFrom: number;
  rangeTo: number;
}

interface Me { role: 'host' | 'manager' | 'cashier' | 'captain' | 'entry' }

// ─── helpers ───────────────────────────────────────────────────────────────

function todayShiftRange(): { from: number; to: number } {
  // 5 AM IST today → 5 AM IST tomorrow. Same logic as cashier.
  const now = new Date();
  const istHour = Number(
    new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false }).format(now),
  );
  const base = new Date(now);
  if (istHour < 5) base.setUTCDate(base.getUTCDate() - 1);
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(base);
  const get = (t: string) => Number(ymd.find((p) => p.type === t)!.value);
  const y = get('year'); const m = get('month'); const d = get('day');
  const istOffsetMs = (5 * 60 + 30) * 60 * 1000;
  const from = Date.UTC(y, m - 1, d, 5, 0, 0) - istOffsetMs;
  const to = from + 24 * 60 * 60 * 1000;
  return { from, to };
}

function fmtRange(from: number, to: number): string {
  const f = (ms: number) => new Date(ms).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  return `${f(from)} – ${f(to)}`;
}

function fmtTimestamp(ms: number): string {
  return new Date(ms).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function toDateInput(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fromDateInput(s: string, endOfDay = false): number {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0).getTime();
}

const TXN_PILL: Record<TxnRow['kind'], string> = {
  Issue:    'bg-sky-50      text-sky-700      border-sky-200',
  Redeem:   'bg-violet-50   text-violet-700   border-violet-200',
  'Top Up': 'bg-emerald-50  text-emerald-700  border-emerald-200',
  Ticket:   'bg-amber-50    text-amber-700    border-amber-200',
  Void:     'bg-rose-50     text-rose-700     border-rose-200',
};

// ─── page ──────────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const initial = useMemo(() => todayShiftRange(), []);
  const [from, setFrom] = useState<number>(initial.from);
  const [to, setTo] = useState<number>(initial.to);

  const [search, setSearch] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [employee, setEmployee] = useState('all');

  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<Me | null>(null);

  const [showLifetime, setShowLifetime] = useState(true);
  const [showRange, setShowRange] = useState(true);
  const [editingRange, setEditingRange] = useState(false);
  const [editFrom, setEditFrom] = useState(toDateInput(from));
  const [editTo, setEditTo] = useState(toDateInput(to));
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/auth/me').then((r) => r.json()).then((d) => { if (d?.ok) setMe(d.user); });
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  const fetchData = useMemo(() => () => {
    const params = new URLSearchParams();
    params.set('from', String(from));
    params.set('to', String(to));
    if (searchDebounced) params.set('q', searchDebounced);
    if (employee !== 'all') params.set('employee', employee);
    params.set('limit', '2000');

    setLoading(true);
    fetch(`/api/analytics?${params.toString()}`)
      .then((r) => r.json())
      .then((d: ApiResponse) => { if (d.ok) setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [from, to, searchDebounced, employee]);

  useEffect(() => { fetchData(); }, [fetchData]);

  function applyRange() {
    setFrom(fromDateInput(editFrom));
    setTo(fromDateInput(editTo, true));
    setEditingRange(false);
  }

  async function deleteRow(row: TxnRow) {
    if (row.kind === 'Issue') {
      if (!confirm(`Void wallet ${row.invoice_no}? This refunds the customer and cannot be undone.`)) return;
      setBusyId(row.id);
      try {
        const r = await fetch(`/api/wallets/${encodeURIComponent(row.entity_ref)}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: 'Voided from Analytics' }),
        });
        const d = await r.json();
        if (!d.ok) { alert(d.message || 'Could not void.'); return; }
        fetchData();
      } finally { setBusyId(null); }
    } else if (row.kind === 'Ticket') {
      if (!confirm(`Cancel ticket ${row.invoice_no}?`)) return;
      setBusyId(row.id);
      try {
        const r = await fetch(`/api/tickets/${encodeURIComponent(row.entity_ref)}`, { method: 'DELETE' });
        const d = await r.json();
        if (!d.ok) { alert(d.message || 'Could not cancel.'); return; }
        fetchData();
      } finally { setBusyId(null); }
    } else {
      alert('Redemptions can be reversed from the Cashier page.');
    }
  }

  function exportCsv() {
    if (!data) return;
    const lines = [
      'Invoice No,Customer Name,Customer Ph.no,Amount,Timestamp,Txn,Payment Mode,Employee Name',
    ];
    const esc = (v: string | number) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    for (const r of data.transactions) {
      lines.push([
        r.invoice_no, r.customer_name, r.customer_phone, r.amount,
        fmtTimestamp(r.timestamp), r.kind, r.payment_mode, r.employee_name,
      ].map(esc).join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `analytics_${toDateInput(from)}_${toDateInput(to)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Trash-icon delete is strictly admin-only. Manager / cashier / captain / entry
  // cannot reverse a real transaction from the Analytics ledger.
  const canMutate = me?.role === 'host';

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 md:py-8">
      <div className="text-[11px] tracking-widest uppercase text-slate-400">Analytics</div>
      <h1 className="text-2xl font-bold text-slate-900 mt-1">Cover</h1>

      {/* ─── Lifetime accordion ──────────────────────────────────────────── */}
      <Accordion
        open={showLifetime}
        onToggle={() => setShowLifetime((v) => !v)}
        header={
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
            <div className="text-lg font-bold text-slate-900">Life Time</div>
            <div className="text-sm text-slate-500">
              (Total Customers : <span className="font-semibold text-slate-900">{data?.lifetime.totalCustomers ?? '—'}</span>)
            </div>
            <div className="ml-auto flex items-center gap-4 flex-wrap">
              <Pill label="Total Incoming" value={data?.lifetime.totalIncoming} />
              <Pill label="Total Cover charge" value={data?.lifetime.totalCoverCharge} />
            </div>
          </div>
        }
      >
        <KpiGrid k={data?.lifetime} loading={loading && !data} />
      </Accordion>

      {/* ─── Range accordion ─────────────────────────────────────────────── */}
      <Accordion
        open={showRange}
        onToggle={() => setShowRange((v) => !v)}
        header={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <CalIcon />
            <div className="text-sm font-medium text-slate-700">{fmtRange(from, to)}</div>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setEditingRange(true); }}
              className="px-3 py-1 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-xs font-medium"
            >
              Edit
            </button>
            <div className="ml-auto flex items-center gap-4 flex-wrap">
              <Pill label="Total Incoming" value={data?.range.totalIncoming} />
              <Pill label="Total Cover charge" value={data?.range.totalCoverCharge} />
            </div>
          </div>
        }
      >
        {editingRange && (
          <div className="mb-3 flex flex-wrap items-end gap-3 p-3 rounded-lg bg-slate-50 border border-slate-200">
            <div>
              <label className="label">From</label>
              <input type="date" className="input" value={editFrom} max={editTo} onChange={(e) => setEditFrom(e.target.value)} />
            </div>
            <div>
              <label className="label">To</label>
              <input type="date" className="input" value={editTo} min={editFrom} onChange={(e) => setEditTo(e.target.value)} />
            </div>
            <button type="button" onClick={applyRange} className="btn btn-primary">Apply</button>
            <button type="button" onClick={() => setEditingRange(false)} className="btn btn-secondary">Cancel</button>
          </div>
        )}
        <KpiGrid k={data?.range} loading={loading && !data} />
      </Accordion>

      {/* ─── Filters + transaction table ─────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto_auto] gap-3 items-end mt-6">
        <div>
          <label className="label">Search</label>
          <input
            type="text"
            className="input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by Invoice Number, Name, Number, Amount"
          />
        </div>
        <div>
          <label className="label">Employee</label>
          <select className="input" value={employee} onChange={(e) => setEmployee(e.target.value)}>
            <option value="all">Select host</option>
            {(data?.employees ?? []).map((e) => <option key={e} value={e}>{e}</option>)}
          </select>
        </div>
        <button type="button" onClick={exportCsv} className="btn btn-secondary whitespace-nowrap">
          ↓ Download CSV
        </button>
        <div className="text-sm text-slate-600 whitespace-nowrap">
          Total Customers : <span className="font-semibold text-slate-900">{data?.range.totalCustomers ?? '—'}</span>
        </div>
      </div>

      <div className="card mt-3 p-0 overflow-hidden">
        {loading && !data ? (
          <div className="p-6 text-slate-400 text-sm">Loading…</div>
        ) : (data?.transactions.length ?? 0) === 0 ? (
          <div className="p-6 text-slate-400 text-sm">No transactions match the current filters.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr className="text-left text-[11px] uppercase tracking-widest text-slate-500">
                  <th className="px-4 py-3">Invoice No</th>
                  <th className="px-4 py-3">Customer Name</th>
                  <th className="px-4 py-3">Customer Ph.no</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3">Timestamp</th>
                  <th className="px-4 py-3">Txn</th>
                  <th className="px-4 py-3">Payment Mode</th>
                  <th className="px-4 py-3">Employee Name</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {(data?.transactions ?? []).map((r) => (
                  <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs text-slate-800">{r.invoice_no}</td>
                    <td className="px-4 py-3 text-slate-900">{r.customer_name}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">{r.customer_phone}</td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-900 whitespace-nowrap">{formatMoney(r.amount)}</td>
                    <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{fmtTimestamp(r.timestamp)}</td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border ${TXN_PILL[r.kind]}`}>
                        {r.kind}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs uppercase text-slate-600 tracking-wider">{r.payment_mode}</td>
                    <td className="px-4 py-3 text-slate-700">{r.employee_name}</td>
                    <td className="px-4 py-3 text-right">
                      {canMutate && (r.kind === 'Issue' || r.kind === 'Ticket') ? (
                        <button
                          type="button"
                          onClick={() => deleteRow(r)}
                          disabled={busyId === r.id}
                          className="text-rose-500 hover:text-rose-700 disabled:opacity-50"
                          title={r.kind === 'Issue' ? 'Void wallet' : 'Cancel ticket'}
                          aria-label="Delete"
                        >
                          <TrashIcon />
                        </button>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── sub-components ────────────────────────────────────────────────────────

function Accordion({
  header, open, onToggle, children,
}: { header: React.ReactNode; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  // Toggle is a div, not a button, because the Range accordion's header contains
  // an "Edit" button — and nested <button> elements are invalid HTML / a hydration
  // error in React. We add role + keyboard handling so it stays accessible.
  return (
    <div className="card mt-4 p-0 overflow-hidden">
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle();
          }
        }}
        className="w-full px-5 py-4 flex items-center gap-3 hover:bg-slate-50 transition cursor-pointer select-none"
      >
        <div className="flex-1 text-left">{header}</div>
        <span className="text-slate-400 text-sm" aria-hidden>{open ? '▾' : '▸'}</span>
      </div>
      {open && <div className="px-5 pb-5 border-t border-slate-100 pt-4">{children}</div>}
    </div>
  );
}

function Pill({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[11px] uppercase tracking-widest text-slate-500">{label}</span>
      <span className="text-sm font-bold text-slate-900">{value == null ? '—' : formatCompactINR(value)}</span>
    </div>
  );
}

function KpiTile({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 min-w-0">
      <div className="text-[11px] uppercase tracking-widest text-slate-500 truncate">{label}</div>
      <div className="text-xl font-bold text-slate-900 mt-1 truncate">
        {value == null ? '—' : formatCompactINR(value)}
      </div>
    </div>
  );
}

function KpiGrid({ k, loading }: { k: AnalyticsKpis | undefined; loading: boolean }) {
  if (loading) return <div className="text-slate-400 text-sm">Loading…</div>;
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KpiTile label="Amount Issued (₹)"       value={k?.amountIssued} />
        <KpiTile label="Top Ups + Preload (₹)"   value={k?.topUpsPreload} />
        <KpiTile label="Total Redeems (₹)"       value={k?.totalRedeems} />
        <KpiTile label="Left Over (₹)"           value={k?.leftOver} />
        <KpiTile label="Edited Amount (₹)"       value={k?.editedAmount} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-3">
        <KpiTile label="Online Amount (₹)"       value={k?.paymentBreakdown.online} />
        <KpiTile label="Cash Amount (₹)"         value={k?.paymentBreakdown.cash} />
        <KpiTile label="Card Amount (₹)"         value={k?.paymentBreakdown.card} />
        <KpiTile label="UPI Amount (₹)"          value={k?.paymentBreakdown.upi} />
        <KpiTile label="Ticket Amount (₹)"       value={k?.paymentBreakdown.ticket} />
      </div>
    </>
  );
}

function CalIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-500" aria-hidden>
      <rect x="3" y="5" width="18" height="16" rx="2"/>
      <path d="M3 9h18M8 3v4M16 3v4"/>
    </svg>
  );
}
function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
    </svg>
  );
}
