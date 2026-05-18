'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CashierTxnRow, CashierTotals } from '@/lib/cashier';

type Tab = 'unsettled' | 'settled';

interface Me { id: string; name: string; role: 'host' | 'manager' | 'cashier' | 'captain' | 'entry'; }

interface ApiResponse {
  ok: boolean;
  range?: { from: number; to: number };
  transactions?: CashierTxnRow[];
  totals?: CashierTotals;
  captains?: string[];
  message?: string;
}

export default function CashierPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [authorized, setAuthorized] = useState<boolean | null>(null);

  const defaultRange = useMemo(() => defaultShiftRange(), []);
  const [from, setFrom] = useState<number>(defaultRange.from);
  const [to, setTo] = useState<number>(defaultRange.to);
  const [editingRange, setEditingRange] = useState(false);

  const [tab, setTab] = useState<Tab>('unsettled');
  const [search, setSearch] = useState('');
  const [captain, setCaptain] = useState('all');
  const [summaryOpen, setSummaryOpen] = useState(true);

  const [transactions, setTransactions] = useState<CashierTxnRow[]>([]);
  const [totals, setTotals] = useState<CashierTotals | null>(null);
  const [captains, setCaptains] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [actingOn, setActingOn] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/auth/me').then((r) => r.json()).then((d) => {
      if (d.ok && ['host', 'manager', 'cashier'].includes(d.user.role)) {
        setMe(d.user); setAuthorized(true);
      } else { setAuthorized(false); }
    });
  }, []);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (authorized !== true) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(load, 200);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorized, from, to, tab, search, captain]);

  async function load() {
    setLoading(true);
    const sp = new URLSearchParams();
    sp.set('from', String(from));
    sp.set('to', String(to));
    sp.set('settled', String(tab === 'settled'));
    if (search.trim()) sp.set('search', search.trim());
    if (captain && captain !== 'all') sp.set('captain', captain);
    const data: ApiResponse = await fetch(`/api/cashier/transactions?${sp}`, { cache: 'no-store' }).then((r) => r.json());
    if (data.ok) {
      setTransactions(data.transactions || []);
      setTotals(data.totals || null);
      setCaptains(data.captains || []);
    }
    setLoading(false);
  }

  async function settle(id: string) {
    setActingOn(id);
    const prev = transactions;
    setTransactions((arr) => arr.map((t) => (t.id === id ? { ...t, settled: true, settled_by: me?.name ?? '…', settled_at: Date.now() } : t)));
    const res = await fetch('/api/cashier/settle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    const data = await res.json();
    if (!data.ok) { setTransactions(prev); alert(data.message); }
    setActingOn(null);
    load();
  }

  async function unsettle(id: string) {
    if (!confirm('Unsettle this transaction? The settlement record will be cleared.')) return;
    setActingOn(id);
    const prev = transactions;
    setTransactions((arr) => arr.map((t) => (t.id === id ? { ...t, settled: false, settled_by: null, settled_at: null } : t)));
    const res = await fetch('/api/cashier/unsettle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    const data = await res.json();
    if (!data.ok) { setTransactions(prev); alert(data.message); }
    setActingOn(null);
    load();
  }

  function downloadCsv() {
    const sp = new URLSearchParams();
    sp.set('from', String(from));
    sp.set('to', String(to));
    sp.set('settled', String(tab === 'settled'));
    if (search.trim()) sp.set('search', search.trim());
    if (captain && captain !== 'all') sp.set('captain', captain);
    window.location.href = `/api/cashier/export?${sp}`;
  }

  if (authorized === false) {
    return (
      <div className="max-w-xl mx-auto px-4 py-12">
        <div className="card">
          <div className="font-semibold text-rose-700">Not allowed</div>
          <p className="text-sm text-slate-500 mt-2">
            Only Host, Manager, or Cashier can access this page.
          </p>
        </div>
      </div>
    );
  }
  if (authorized === null) {
    return <div className="max-w-6xl mx-auto px-4 py-8 text-slate-500">Loading…</div>;
  }

  return (
    <div className="max-w-6xl mx-auto px-6 md:px-8 py-6">
      {/* Top stats row */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <DateRangePicker
          from={from} to={to} editing={editingRange}
          onEdit={() => setEditingRange(true)}
          onCancel={() => setEditingRange(false)}
          onApply={(f, t) => { setFrom(f); setTo(t); setEditingRange(false); }}
        />
        <div className="text-sm flex flex-wrap gap-x-6 gap-y-1">
          <span className="text-slate-500">Unsettled: <b className="text-slate-900 ml-1">{formatINR(totals?.unsettled_amount ?? 0)}</b></span>
          <span className="text-slate-500">Settled: <b className="text-emerald-700 ml-1">{formatINR(totals?.settled_amount ?? 0)}</b></span>
        </div>
      </div>

      {/* Summary card */}
      <div className="mt-4 rounded-xl border border-slate-200 bg-white overflow-hidden">
        <button type="button" onClick={() => setSummaryOpen(!summaryOpen)}
                className="w-full flex items-center justify-between px-5 py-3">
          <div className="flex items-center gap-8">
            <div className="text-left">
              <div className="text-[10px] uppercase tracking-wider text-slate-500">Total Incoming</div>
              <div className="text-lg font-bold text-slate-900">{formatINR(totals?.total_incoming ?? 0)}</div>
            </div>
            <div className="text-left">
              <div className="text-[10px] uppercase tracking-wider text-slate-500">Total Cover charge</div>
              <div className="text-lg font-bold text-slate-900">{formatINR(totals?.total_cover_charge ?? 0)}</div>
            </div>
          </div>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
               className={`text-slate-400 transition ${summaryOpen ? 'rotate-180' : ''}`}>
            <path d="M6 9l6 6 6-6"/>
          </svg>
        </button>
        {summaryOpen && (
          <div className="px-5 pb-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm border-t border-slate-100 pt-3">
            <Stat label="Transactions" value={String(totals?.txn_count ?? 0)} />
            <Stat label="Avg redemption" value={
              totals && totals.txn_count > 0
                ? formatINR(Math.round((totals.settled_amount + totals.unsettled_amount) / totals.txn_count))
                : '—'
            } />
            <Stat label="% settled" tone="emerald" value={
              totals && (totals.settled_amount + totals.unsettled_amount) > 0
                ? `${Math.round(totals.settled_amount * 100 / (totals.settled_amount + totals.unsettled_amount))}%`
                : '0%'
            } />
            <Stat label="Window" value={formatRangeShort(from, to)} small />
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="mt-5 flex gap-2 border-b border-slate-200">
        <TabBtn active={tab === 'unsettled'} onClick={() => setTab('unsettled')}>Non Settled Transactions</TabBtn>
        <TabBtn active={tab === 'settled'} onClick={() => setTab('settled')}>Settled Transactions</TabBtn>
      </div>

      {/* Filter row */}
      <div className="mt-4 grid grid-cols-1 md:grid-cols-[1fr,260px,auto] gap-3 items-end">
        <div>
          <label className="label">Search</label>
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="7"/>
              <path d="M21 21l-5-5"/>
            </svg>
            <input
              className="input pl-9"
              placeholder="Search by Invoice Number, Name, Number, Amount"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <div>
          <label className="label">Redeem by</label>
          <select className="input" value={captain} onChange={(e) => setCaptain(e.target.value)}>
            <option value="all">Select host</option>
            {captains.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <button type="button" onClick={downloadCsv} className="btn btn-secondary inline-flex items-center gap-2 whitespace-nowrap">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <path d="M7 10l5 5 5-5M12 15V3"/>
          </svg>
          Download CSV
        </button>
      </div>

      {/* Mobile: card list. Desktop: full table. */}
      <div className="mt-4">
        {loading ? (
          <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">Loading…</div>
        ) : transactions.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-sm text-slate-500 text-center">
            No {tab === 'unsettled' ? 'unsettled' : 'settled'} transactions in this window.
          </div>
        ) : (
          <>
            {/* MOBILE — stacked cards */}
            <ul className="md:hidden space-y-3">
              {transactions.map((t) => {
                const isAdmin = me?.role === 'host' || me?.role === 'manager';
                const canUnsettle = t.settled && isAdmin;
                return (
                  <li key={t.id} className="rounded-xl border border-slate-200 bg-white p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-mono text-[11px] text-slate-500">{t.invoice_no}</div>
                        <div className="text-base font-semibold text-slate-900 mt-0.5">{t.customer_name}</div>
                        <div className="text-xs text-slate-500">{t.customer_phone}</div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="text-lg font-bold text-slate-900">{formatINR(t.amount)}</div>
                        {t.settled ? (
                          <span className="inline-flex items-center gap-1 text-[10px] text-emerald-700 mt-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                            Settled
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] text-amber-700 mt-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                            Pending
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                      <div>
                        <div className="text-slate-400 uppercase tracking-wider">Redeem by</div>
                        <div className="text-slate-700 truncate">{t.captain}</div>
                      </div>
                      <div>
                        <div className="text-slate-400 uppercase tracking-wider">Date · time</div>
                        <div className="text-slate-700">
                          {formatDate(t.created_at)} · {formatTime(t.created_at)}
                        </div>
                      </div>
                      {t.settled_by && (
                        <div className="col-span-2">
                          <div className="text-slate-400 uppercase tracking-wider">Settled by</div>
                          <div className="text-slate-700">{t.settled_by}</div>
                        </div>
                      )}
                    </div>
                    <div className="mt-3 flex justify-end">
                      {t.settled ? (
                        canUnsettle ? (
                          <button
                            onClick={() => unsettle(t.id)}
                            disabled={actingOn === t.id}
                            className="text-xs font-medium text-rose-600 hover:text-rose-700 py-2 px-3"
                          >
                            Unsettle
                          </button>
                        ) : null
                      ) : (
                        <button
                          onClick={() => settle(t.id)}
                          disabled={actingOn === t.id}
                          className="btn btn-primary text-xs px-5 py-2"
                        >
                          Settle
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>

            {/* DESKTOP — full table */}
            <div className="hidden md:block rounded-xl border border-slate-200 bg-white overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500 text-[10px] uppercase tracking-wider border-b border-slate-200">
                    <th className="px-4 py-3 font-semibold">Invoice No</th>
                    <th className="px-4 py-3 font-semibold">Amount</th>
                    <th className="px-4 py-3 font-semibold">Redeem By</th>
                    <th className="px-4 py-3 font-semibold">Customer Name</th>
                    <th className="px-4 py-3 font-semibold">Customer Number</th>
                    <th className="px-4 py-3 font-semibold">Date &amp; Time</th>
                    <th className="px-4 py-3 font-semibold">Type</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 font-semibold">Action</th>
                    <th className="px-4 py-3 font-semibold">Settled By</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((t) => {
                    const isAdmin = me?.role === 'host' || me?.role === 'manager';
                    const canUnsettle = t.settled && isAdmin;
                    return (
                      <tr key={t.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/40">
                        <td className="px-4 py-3 font-mono text-xs text-slate-700">{t.invoice_no}</td>
                        <td className="px-4 py-3 font-semibold text-slate-900">{formatINR(t.amount)}</td>
                        <td className="px-4 py-3 text-slate-700">{t.captain}</td>
                        <td className="px-4 py-3 text-slate-700">{t.customer_name}</td>
                        <td className="px-4 py-3 text-slate-700">{t.customer_phone}</td>
                        <td className="px-4 py-3 text-xs">
                          <div className="text-slate-900">{formatDate(t.created_at)}</div>
                          <div className="text-slate-500">{formatTime(t.created_at)}</div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center gap-1.5 text-[11px] text-emerald-700">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                            Redeemed
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {t.settled ? (
                            <span className="inline-flex items-center gap-1.5 text-[11px] text-emerald-700">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                              Settled
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-[11px] text-amber-700">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                              Pending
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {t.settled ? (
                            canUnsettle ? (
                              <button onClick={() => unsettle(t.id)} disabled={actingOn === t.id}
                                      className="text-xs font-medium text-rose-600 hover:text-rose-700">
                                Unsettle
                              </button>
                            ) : (
                              <span className="text-xs text-slate-400">—</span>
                            )
                          ) : (
                            <button onClick={() => settle(t.id)} disabled={actingOn === t.id}
                                    className="text-xs font-medium text-brand-600 hover:text-brand-700">
                              Settle
                            </button>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-700 text-xs">
                          {t.settled_by || <span className="text-slate-400">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

function DateRangePicker({
  from, to, editing, onEdit, onCancel, onApply,
}: {
  from: number; to: number; editing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onApply: (from: number, to: number) => void;
}) {
  const [fromInput, setFromInput] = useState(toDateTimeLocal(from));
  const [toInput, setToInput] = useState(toDateTimeLocal(to));

  useEffect(() => {
    setFromInput(toDateTimeLocal(from));
    setToInput(toDateTimeLocal(to));
  }, [from, to]);

  if (editing) {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <input className="input text-sm" type="datetime-local" value={fromInput} onChange={(e) => setFromInput(e.target.value)} />
        <span className="text-slate-400">–</span>
        <input className="input text-sm" type="datetime-local" value={toInput} onChange={(e) => setToInput(e.target.value)} />
        <button
          type="button"
          className="btn btn-primary text-xs px-4 py-2"
          onClick={() => {
            const f = fromDateTimeLocal(fromInput);
            const t = fromDateTimeLocal(toInput);
            if (f != null && t != null && t > f) onApply(f, t);
          }}
        >
          Apply
        </button>
        <button type="button" onClick={onCancel} className="text-xs text-slate-500 hover:text-slate-900">
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <div className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 bg-white text-sm">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-500">
          <rect x="3" y="5" width="18" height="16" rx="2"/>
          <path d="M3 9h18M8 3v4M16 3v4"/>
        </svg>
        <span className="text-slate-700">{formatRangeFull(from, to)}</span>
      </div>
      <button type="button" onClick={onEdit} className="btn btn-primary px-4 py-2 text-sm">
        Edit
      </button>
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium transition border-b-2 -mb-px ${
        active
          ? 'border-brand-500 text-brand-700'
          : 'border-transparent text-slate-500 hover:text-slate-900'
      }`}
    >
      {children}
    </button>
  );
}

function Stat({ label, value, tone, small }: { label: string; value: string; tone?: 'emerald'; small?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`mt-0.5 font-bold ${
        small ? 'text-xs text-slate-700'
        : tone === 'emerald' ? 'text-base text-emerald-700'
        : 'text-base text-slate-900'
      }`}>
        {value}
      </div>
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function defaultShiftRange() {
  const now = new Date();
  const istHour = parseInt(
    new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false }).format(now),
    10,
  );
  const base = new Date(now);
  if (istHour < 5) base.setUTCDate(base.getUTCDate() - 1);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(base);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const y = get('year'); const m = get('month'); const d = get('day');
  const IST_OFFSET = (5 * 60 + 30) * 60 * 1000;
  const from = Date.UTC(y, m - 1, d, 5, 0, 0) - IST_OFFSET;
  return { from, to: from + 24 * 3600 * 1000 };
}

function formatINR(n: number): string {
  if (n >= 100000) return `₹${(n / 100000).toFixed(2).replace(/\.00$/, '')}L`;
  return `₹${n.toLocaleString('en-IN')}`;
}

function formatRangeFull(from: number, to: number): string {
  const fmt = (ms: number) => new Date(ms).toLocaleString('en-US', {
    timeZone: 'Asia/Kolkata',
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
  return `${fmt(from)} – ${fmt(to)}`;
}

function formatRangeShort(from: number, to: number): string {
  const fmt = (ms: number) => new Date(ms).toLocaleString('en-US', {
    timeZone: 'Asia/Kolkata', month: 'short', day: 'numeric',
  });
  return `${fmt(from)} → ${fmt(to)}`;
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric' });
}
function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true });
}

function toDateTimeLocal(ms: number): string {
  const ist = new Date(ms + (5 * 60 + 30) * 60 * 1000);
  return ist.toISOString().slice(0, 16);
}
function fromDateTimeLocal(s: string): number | null {
  if (!s) return null;
  const [date, time] = s.split('T');
  if (!date || !time) return null;
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const asIfUtc = Date.UTC(y, m - 1, d, hh, mm, 0);
  return asIfUtc - (5 * 60 + 30) * 60 * 1000;
}
