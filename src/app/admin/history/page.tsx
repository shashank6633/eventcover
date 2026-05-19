'use client';

import { useEffect, useMemo, useState } from 'react';

type TxnKind = 'entry' | 'redemption';
type TxnStatus = 'Active' | 'Exhausted' | 'Expired' | 'Voided' | 'Pending' | 'Settled' | 'Reversed';

interface TransactionRow {
  id: string;
  kind: TxnKind;
  invoice_no: string;
  amount: number;
  redeemed_by: string;
  customer_name: string;
  customer_phone: string;
  created_at: number;
  transaction_type: string;
  status: TxnStatus;
  wallet_txn_id: string;
  payment_method?: string;
  balance?: number;
  cover_issued?: number;
  expires_at?: number | null;
  settled_by?: string | null;
  settled_at?: number | null;
}

interface Totals {
  entries_count: number;
  entries_amount: number;
  redemptions_count: number;
  redemptions_amount: number;
  settled_amount: number;
  pending_amount: number;
  voided_count: number;
  reversed_count: number;
}

interface ApiResponse {
  ok: boolean;
  range: { from: number; to: number };
  rows: TransactionRow[];
  staff: string[];
  totals: Totals;
}

interface Me { id: string; name: string; role: 'host' | 'manager' | 'cashier' | 'captain' | 'entry' }

// ─── helpers ───────────────────────────────────────────────────────────────

function toLocalDateInput(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function fromDateInput(s: string, endOfDay = false): number {
  if (!s) return 0;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0).getTime();
}
function fmtINR(n: number): string {
  return `₹${(n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}
function fmtDateTime(ms: number): string {
  return new Date(ms).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

const STATUS_PILL: Record<TxnStatus, string> = {
  Active:    'bg-sky-50      text-sky-700      border-sky-200',
  Exhausted: 'bg-slate-50    text-slate-600    border-slate-200',
  Expired:   'bg-amber-50    text-amber-700    border-amber-200',
  Voided:    'bg-rose-50     text-rose-700     border-rose-200',
  Pending:   'bg-amber-50    text-amber-700    border-amber-200',
  Settled:   'bg-emerald-50  text-emerald-700  border-emerald-200',
  Reversed:  'bg-rose-50     text-rose-700     border-rose-200',
};

function statusIsCritical(s: TxnStatus): boolean {
  return s === 'Voided' || s === 'Reversed';
}

// ─── page ──────────────────────────────────────────────────────────────────

export default function HistoryPage() {
  const today = useMemo(() => new Date(), []);
  const sevenAgo = useMemo(() => new Date(today.getTime() - 7 * 24 * 3600 * 1000), [today]);

  const [fromDate, setFromDate] = useState(toLocalDateInput(sevenAgo.getTime()));
  const [toDate, setToDate]     = useState(toLocalDateInput(today.getTime()));
  const [kind, setKind]         = useState<'all' | TxnKind>('all');
  const [redeemedBy, setRedeemedBy] = useState<string>('all');
  const [q, setQ]               = useState('');
  const [qDebounced, setQDebounced] = useState('');

  const [data, setData]         = useState<ApiResponse | null>(null);
  const [loading, setLoading]   = useState(true);
  const [me, setMe]             = useState<Me | null>(null);
  const [busyId, setBusyId]     = useState<string | null>(null);
  const [toast, setToast]       = useState<string | null>(null);

  // session — to gate the Action column
  useEffect(() => {
    fetch('/api/auth/me').then((r) => r.json()).then((d) => { if (d?.ok) setMe(d.user); });
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const fetchData = useMemo(() => () => {
    const params = new URLSearchParams();
    params.set('from', String(fromDateInput(fromDate)));
    params.set('to',   String(fromDateInput(toDate, true)));
    if (kind !== 'all') params.set('kind', kind);
    if (redeemedBy !== 'all') params.set('redeemedBy', redeemedBy);
    if (qDebounced) params.set('q', qDebounced);
    params.set('limit', '2000');

    setLoading(true);
    fetch(`/api/transactions?${params.toString()}`)
      .then((r) => r.json())
      .then((d: ApiResponse) => { if (d.ok) setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [fromDate, toDate, kind, redeemedBy, qDebounced]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const rows = data?.rows ?? [];
  const totals = data?.totals;
  const criticalCount = (totals?.voided_count ?? 0) + (totals?.reversed_count ?? 0);

  async function voidWallet(txnId: string) {
    if (!confirm('Void this cover? This refunds the customer and cannot be undone.')) return;
    setBusyId(txnId);
    try {
      const res = await fetch(`/api/wallets/${encodeURIComponent(txnId)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Admin void' }),
      });
      const d = await res.json();
      if (!d.ok) { setToast(d.message || 'Could not void.'); return; }
      setToast(`Voided ${txnId}`);
      fetchData();
    } finally {
      setBusyId(null);
      setTimeout(() => setToast(null), 3500);
    }
  }

  async function settle(redemptionId: string) {
    setBusyId(redemptionId);
    try {
      const res = await fetch(`/api/cashier/settle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: redemptionId }),
      });
      const d = await res.json();
      if (!d.ok) { setToast(d.message || 'Could not settle.'); return; }
      fetchData();
    } finally { setBusyId(null); setTimeout(() => setToast(null), 3500); }
  }
  async function unsettle(redemptionId: string) {
    if (!confirm('Reverse this settlement?')) return;
    setBusyId(redemptionId);
    try {
      const res = await fetch(`/api/cashier/unsettle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: redemptionId }),
      });
      const d = await res.json();
      if (!d.ok) { setToast(d.message || 'Could not unsettle.'); return; }
      fetchData();
    } finally { setBusyId(null); setTimeout(() => setToast(null), 3500); }
  }

  // Destructive transaction actions (Void wallet, Unsettle redemption) are
  // strictly admin-only — manager, cashier and other roles cannot reverse real
  // money. Settling itself is operational and stays open to manager + cashier.
  const canMutate = me?.role === 'host';
  const canSettle = me?.role === 'host' || me?.role === 'manager' || me?.role === 'cashier';

  function exportCsv() {
    const params = new URLSearchParams();
    params.set('from', String(fromDateInput(fromDate)));
    params.set('to',   String(fromDateInput(toDate, true)));
    if (kind !== 'all') params.set('kind', kind);
    if (redeemedBy !== 'all') params.set('redeemedBy', redeemedBy);
    if (qDebounced) params.set('q', qDebounced);
    params.set('limit', '5000');
    params.set('format', 'csv');
    // CSV endpoint not wired yet — synthesize one from current rows in the browser
    const lines: string[] = [
      'Invoice No,Amount,Redeem By,Customer Name,Customer Mobile,Date & Time,Transaction,Status,Wallet Txn',
    ];
    const esc = (v: string | number) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    for (const r of rows) {
      lines.push([
        r.invoice_no, r.amount, r.redeemed_by, r.customer_name, r.customer_phone,
        fmtDateTime(r.created_at), r.transaction_type, r.status, r.wallet_txn_id,
      ].map(esc).join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `history_${fromDate}_${toDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 md:py-8">
      <div className="text-[11px] tracking-widest uppercase text-slate-400">Ledger</div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900 mt-1">Transaction History</h1>
        <button type="button" onClick={exportCsv} className="btn btn-secondary whitespace-nowrap">
          Export CSV
        </button>
      </div>
      <p className="text-sm text-slate-500 mt-1 max-w-3xl">
        Every entry and cover-charge transaction — issuances, redemptions, settlements
        and alterations (voids, refunds, reversals).
      </p>

      {/* KPI strip */}
      {totals && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 mt-4">
          <Kpi label="Entries"           value={fmtINR(totals.entries_amount)}      sub={`${totals.entries_count} txn`} />
          <Kpi label="Redemptions"       value={fmtINR(totals.redemptions_amount)}  sub={`${totals.redemptions_count} txn`} />
          <Kpi label="Settled"           value={fmtINR(totals.settled_amount)} />
          <Kpi label="Pending settle"    value={fmtINR(totals.pending_amount)} tone={totals.pending_amount > 0 ? 'amber' : undefined} />
        </div>
      )}

      {/* Critical banner */}
      {criticalCount > 0 && (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-rose-500 text-white flex items-center justify-center font-bold">!</div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-rose-800">
              {criticalCount} alteration{criticalCount === 1 ? '' : 's'} in this range
            </div>
            <div className="text-xs text-rose-700/80">
              {totals?.voided_count ?? 0} voided cover{(totals?.voided_count ?? 0) === 1 ? '' : 's'}, {totals?.reversed_count ?? 0} reversed redemption{(totals?.reversed_count ?? 0) === 1 ? '' : 's'}. Review before closing shift.
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="card mt-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div>
            <label className="label">From</label>
            <input type="date" className="input" value={fromDate} max={toDate} onChange={(e) => setFromDate(e.target.value)} />
          </div>
          <div>
            <label className="label">To</label>
            <input type="date" className="input" value={toDate} min={fromDate} onChange={(e) => setToDate(e.target.value)} />
          </div>
          <div>
            <label className="label">Redeem By</label>
            <select className="input" value={redeemedBy} onChange={(e) => setRedeemedBy(e.target.value)}>
              <option value="all">All staff</option>
              {(data?.staff ?? []).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Search</label>
            <input
              type="text"
              className="input"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Invoice, customer, phone…"
            />
          </div>
          <div>
            <label className="label">Type</label>
            <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1 h-[42px]">
              {(['all', 'entry', 'redemption'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={`flex-1 text-xs font-medium rounded-md py-1.5 transition ${
                    kind === k ? 'bg-white text-slate-900 shadow' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {k === 'all' ? 'All' : k === 'entry' ? 'Entries' : 'Redeems'}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Desktop table */}
      <div className="card mt-4 p-0 overflow-hidden hidden md:block">
        {loading ? (
          <div className="p-6 text-slate-400 text-sm">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-slate-400 text-sm">
            No transactions in this range. Widen the date range or clear filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr className="text-left text-[11px] uppercase tracking-widest text-slate-500">
                  <th className="px-4 py-3">Invoice No</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3">Redeem By User</th>
                  <th className="px-4 py-3">Customer Name</th>
                  <th className="px-4 py-3">Mobile No</th>
                  <th className="px-4 py-3">Date &amp; Time</th>
                  <th className="px-4 py-3">Transaction</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const critical = statusIsCritical(r.status);
                  return (
                    <tr
                      key={r.id}
                      className={`border-b border-slate-100 ${
                        critical ? 'bg-rose-50/30 hover:bg-rose-50/60' : 'hover:bg-slate-50'
                      }`}
                    >
                      <td className="px-4 py-3 font-mono text-xs text-slate-800">
                        {r.invoice_no}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-900 whitespace-nowrap">
                        {fmtINR(r.amount)}
                      </td>
                      <td className="px-4 py-3 text-slate-700">{r.redeemed_by}</td>
                      <td className="px-4 py-3 text-slate-900">{r.customer_name}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-600">{r.customer_phone}</td>
                      <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{fmtDateTime(r.created_at)}</td>
                      <td className="px-4 py-3 text-slate-700">
                        <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                          r.kind === 'entry' ? 'bg-sky-50 text-sky-700 border-sky-200' : 'bg-violet-50 text-violet-700 border-violet-200'
                        }`}>
                          {r.transaction_type}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border font-medium ${STATUS_PILL[r.status]}`}>
                          {r.status}
                        </span>
                        {r.kind === 'redemption' && r.settled_by && (
                          <div className="text-[10px] text-slate-400 mt-1">by {r.settled_by}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <ActionButtons
                          row={r}
                          busy={busyId === r.wallet_txn_id || busyId === r.id.replace(/^redeem:/, '')}
                          canMutate={!!canMutate}
                          canSettle={!!canSettle}
                          onVoid={() => voidWallet(r.wallet_txn_id)}
                          onSettle={() => settle(r.id.replace(/^redeem:/, ''))}
                          onUnsettle={() => unsettle(r.id.replace(/^redeem:/, ''))}
                          onPivot={() => setQ(r.wallet_txn_id)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Mobile cards */}
      <ul className="space-y-2 mt-4 md:hidden">
        {loading ? (
          <li className="card text-slate-400 text-sm">Loading…</li>
        ) : rows.length === 0 ? (
          <li className="card text-slate-400 text-sm">No transactions in this range.</li>
        ) : rows.map((r) => {
          const critical = statusIsCritical(r.status);
          return (
            <li key={r.id} className={`card ${critical ? 'border-rose-200 bg-rose-50/30' : ''}`}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-xs text-slate-800 truncate">{r.invoice_no}</span>
                <span className="text-lg font-bold text-slate-900 whitespace-nowrap">{fmtINR(r.amount)}</span>
              </div>
              <div className="mt-1 text-sm font-semibold text-slate-900">{r.customer_name}</div>
              <div className="text-xs text-slate-500 font-mono">{r.customer_phone}</div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wider">
                <span className={`px-2 py-0.5 rounded-full border ${r.kind === 'entry' ? 'bg-sky-50 text-sky-700 border-sky-200' : 'bg-violet-50 text-violet-700 border-violet-200'}`}>
                  {r.transaction_type}
                </span>
                <span className={`px-2 py-0.5 rounded-full border font-medium ${STATUS_PILL[r.status]}`}>
                  {r.status}
                </span>
                <span className="text-slate-400 normal-case">· by {r.redeemed_by}</span>
              </div>
              <div className="mt-2 flex items-center justify-between gap-2 flex-wrap">
                <span className="text-[11px] text-slate-400 whitespace-nowrap">{fmtDateTime(r.created_at)}</span>
                <ActionButtons
                  row={r}
                  busy={busyId === r.wallet_txn_id || busyId === r.id.replace(/^redeem:/, '')}
                  canMutate={!!canMutate}
                  canSettle={!!canSettle}
                  onVoid={() => voidWallet(r.wallet_txn_id)}
                  onSettle={() => settle(r.id.replace(/^redeem:/, ''))}
                  onUnsettle={() => unsettle(r.id.replace(/^redeem:/, ''))}
                  onPivot={() => setQ(r.wallet_txn_id)}
                />
              </div>
            </li>
          );
        })}
      </ul>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-lg bg-slate-900 text-white text-sm shadow-elevated">
          {toast}
        </div>
      )}
    </div>
  );
}

// ─── sub-components ────────────────────────────────────────────────────────

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'amber' }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className={`kpi-value ${tone === 'amber' ? 'text-amber-700' : ''}`}>{value}</div>
      {sub && <div className="text-[11px] text-slate-500 mt-1">{sub}</div>}
    </div>
  );
}

function ActionButtons({
  row, busy, canMutate, canSettle, onVoid, onSettle, onUnsettle, onPivot,
}: {
  row: TransactionRow;
  busy: boolean;
  canMutate: boolean;
  canSettle: boolean;
  onVoid: () => void;
  onSettle: () => void;
  onUnsettle: () => void;
  onPivot: () => void;
}) {
  return (
    <div className="inline-flex items-center gap-1 flex-wrap justify-end">
      <button
        type="button"
        onClick={onPivot}
        className="text-[11px] text-slate-500 hover:text-brand-600 px-2 py-1 rounded hover:bg-slate-100"
        title="Show every event for this wallet"
      >
        View
      </button>
      {row.kind === 'entry' && row.status === 'Active' && canMutate && (
        <button
          type="button"
          disabled={busy}
          onClick={onVoid}
          className="text-[11px] text-rose-600 hover:text-rose-800 font-medium px-2 py-1 rounded hover:bg-rose-50 disabled:opacity-50"
        >
          {busy ? '…' : 'Void'}
        </button>
      )}
      {row.kind === 'redemption' && row.status === 'Pending' && canSettle && (
        <button
          type="button"
          disabled={busy}
          onClick={onSettle}
          className="text-[11px] text-emerald-700 hover:text-emerald-900 font-medium px-2 py-1 rounded hover:bg-emerald-50 disabled:opacity-50"
        >
          {busy ? '…' : 'Settle'}
        </button>
      )}
      {row.kind === 'redemption' && row.status === 'Settled' && canSettle && (
        <button
          type="button"
          disabled={busy}
          onClick={onUnsettle}
          className="text-[11px] text-rose-600 hover:text-rose-800 font-medium px-2 py-1 rounded hover:bg-rose-50 disabled:opacity-50"
        >
          {busy ? '…' : 'Unsettle'}
        </button>
      )}
    </div>
  );
}
