'use client';

/**
 * Abandoned Bookings — admin recovery dashboard.
 *
 * Lists customers who started a booking journey on a public event page but
 * never completed it. Three sources:
 *   • Razorpay order created → modal dismissed / timed out
 *   • Razorpay payment failed (decline)
 *   • Reservation submitted → never reached payment screen
 *
 * Each row offers quick actions: WhatsApp the customer (deep-link, no API
 * call) and Mark Recovered (POST). Marking recovered closes the row out
 * of this list so the inbox shrinks over time.
 *
 * Header strip surfaces total count + potential-revenue-at-risk so the
 * host can prioritize follow-up.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';

interface AbandonedBooking {
  id: string;
  source: 'payment' | 'reservation';
  stage: 'reservation_only' | 'payment_created' | 'payment_failed';
  abandonedAt: number;
  name: string | null;
  phone: string | null;
  email: string | null;
  eventId: string | null;
  eventName: string | null;
  eventDate: string | null;
  amount: number;
  razorpayOrderId: string | null;
  razorpayPaymentId: string | null;
  errorCode: string | null;
  errorDescription: string | null;
  recoveryNotes: string | null;
}

interface Counts {
  total: number;
  paymentCreated: number;
  paymentFailed: number;
  reservationOnly: number;
  potentialRevenue: number;
}

type StageFilter = 'all' | 'reservation_only' | 'payment_created' | 'payment_failed';

const STAGE_META: Record<AbandonedBooking['stage'], { label: string; tone: 'amber' | 'rose' | 'slate' }> = {
  reservation_only: { label: 'Form only', tone: 'slate' },
  payment_created:  { label: 'Checkout dropped', tone: 'amber' },
  payment_failed:   { label: 'Payment failed', tone: 'rose' },
};

function toneClass(tone: 'amber' | 'rose' | 'slate'): string {
  switch (tone) {
    case 'amber': return 'bg-amber-50 text-amber-700 border-amber-200';
    case 'rose':  return 'bg-rose-50 text-rose-700 border-rose-200';
    default:      return 'bg-slate-50 text-slate-600 border-slate-200';
  }
}

function formatINR(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—';
  return '₹' + Math.round(n).toLocaleString('en-IN');
}

function formatAgo(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function whatsappUrl(phone: string, name: string | null, eventName: string | null): string {
  const cleaned = phone.replace(/\D/g, '');
  const msg = `Hi ${name || 'there'}, I noticed you started booking for ${eventName || 'our event'} but didn’t finish. Anything I can help with?`;
  return `https://wa.me/${cleaned}?text=${encodeURIComponent(msg)}`;
}

export default function AbandonedBookingsPage() {
  return (
    <AdminShell>
      <AbandonedBookingsClient />
    </AdminShell>
  );
}

function AbandonedBookingsClient() {
  const [items, setItems] = useState<AbandonedBooking[]>([]);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<StageFilter>('all');
  const [search, setSearch] = useState('');
  const [recovering, setRecovering] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = new URL('/api/abandoned-bookings', window.location.origin);
      url.searchParams.set('stage', stage);
      url.searchParams.set('minAge', '60');
      url.searchParams.set('limit', '200');
      const res = await fetch(url.toString(), { cache: 'no-store' });
      const d = await res.json();
      if (!d.ok) {
        setError(d.message || 'Could not load abandoned bookings.');
        return;
      }
      setItems(d.items || []);
      setCounts(d.counts || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
    } finally {
      setLoading(false);
    }
  }, [stage]);

  useEffect(() => { void load(); }, [load]);

  async function recover(id: string) {
    const note = window.prompt('Recovery note (optional) — e.g. "settled cash at door":', '');
    if (note === null) return; // cancelled
    setRecovering(id);
    try {
      const res = await fetch(`/api/abandoned-bookings/${encodeURIComponent(id)}/recover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: note || undefined }),
      });
      const d = await res.json();
      if (!d.ok) {
        alert(d.message || 'Could not mark recovered.');
        return;
      }
      // Drop locally so the table updates instantly without a full reload
      setItems((prev) => prev.filter((b) => b.id !== id));
      setCounts((prev) => prev ? { ...prev, total: Math.max(0, prev.total - 1) } : prev);
    } finally {
      setRecovering(null);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((b) =>
      (b.name || '').toLowerCase().includes(q) ||
      (b.phone || '').toLowerCase().includes(q) ||
      (b.email || '').toLowerCase().includes(q) ||
      (b.eventName || '').toLowerCase().includes(q),
    );
  }, [items, search]);

  return (
    <div className="px-6 md:px-8 py-6 max-w-7xl mx-auto">
      <header className="mb-5">
        <h1 className="text-2xl font-bold text-slate-900">Abandoned Bookings</h1>
        <p className="text-sm text-slate-500 mt-1">
          Customers who started booking but never finished. Recover them with a quick WhatsApp follow-up.
        </p>
      </header>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <KpiCard label="Total open" value={counts ? String(counts.total) : '—'} tone="slate" />
        <KpiCard label="Form only" value={counts ? String(counts.reservationOnly) : '—'} tone="slate" />
        <KpiCard label="Checkout dropped" value={counts ? String(counts.paymentCreated) : '—'} tone="amber" />
        <KpiCard label="Revenue at risk" value={counts ? formatINR(counts.potentialRevenue) : '—'} tone="brand" />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <FilterChip active={stage === 'all'} onClick={() => setStage('all')}>All</FilterChip>
        <FilterChip active={stage === 'reservation_only'} onClick={() => setStage('reservation_only')}>Form only</FilterChip>
        <FilterChip active={stage === 'payment_created'} onClick={() => setStage('payment_created')}>Checkout dropped</FilterChip>
        <FilterChip active={stage === 'payment_failed'} onClick={() => setStage('payment_failed')}>Payment failed</FilterChip>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, phone, email, event…"
          className="input ml-auto !w-72 max-w-full"
        />
        <button onClick={() => void load()} className="btn btn-secondary" disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {/* Body */}
      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-700 px-4 py-3 text-sm mb-4">
          {error}
        </div>
      )}

      {loading && filtered.length === 0 ? (
        <div className="card text-slate-500 text-sm">Loading abandoned bookings…</div>
      ) : filtered.length === 0 ? (
        <div className="card text-center py-12">
          <div className="text-4xl mb-2">🎉</div>
          <div className="text-sm font-semibold text-slate-700">No abandoned bookings.</div>
          <div className="text-xs text-slate-500 mt-1">
            {search ? 'No matches for your search.' : 'Either everyone’s converting, or your event is brand new. Either way — nice.'}
          </div>
        </div>
      ) : (
        <div className="card !p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-[10px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold">Stage</th>
                  <th className="text-left px-4 py-3 font-semibold">Customer</th>
                  <th className="text-left px-4 py-3 font-semibold">Event</th>
                  <th className="text-right px-4 py-3 font-semibold">Amount</th>
                  <th className="text-left px-4 py-3 font-semibold">Abandoned</th>
                  <th className="text-right px-4 py-3 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((b) => {
                  const meta = STAGE_META[b.stage];
                  return (
                    <tr key={b.id} className="hover:bg-slate-50/50">
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border font-semibold ${toneClass(meta.tone)}`}>
                          {meta.label}
                        </span>
                        {b.errorCode && (
                          <div className="text-[10px] text-rose-600 mt-0.5 font-mono" title={b.errorDescription || ''}>
                            {b.errorCode}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{b.name || '—'}</div>
                        <div className="text-xs text-slate-500">{b.phone || ''}</div>
                        {b.email && <div className="text-[11px] text-slate-400 truncate max-w-[200px]">{b.email}</div>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-slate-700">{b.eventName || '—'}</div>
                        {b.eventDate && <div className="text-xs text-slate-500">{b.eventDate}</div>}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium text-slate-900">
                        {formatINR(b.amount)}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                        {formatAgo(b.abandonedAt)}
                        {b.recoveryNotes && (
                          <div className="text-[10px] text-slate-400 mt-0.5 truncate max-w-[180px]" title={b.recoveryNotes}>
                            {b.recoveryNotes}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          {b.phone && (
                            <a
                              href={whatsappUrl(b.phone, b.name, b.eventName)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-medium"
                            >
                              WhatsApp
                            </a>
                          )}
                          <button
                            onClick={() => void recover(b.id)}
                            disabled={recovering === b.id}
                            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 font-medium disabled:opacity-50"
                          >
                            {recovering === b.id ? 'Saving…' : 'Mark recovered'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="text-[11px] text-slate-400 mt-4">
        Only entries older than 1 hour are shown — in-flight checkouts are excluded.
      </div>
    </div>
  );
}

function KpiCard({ label, value, tone }: { label: string; value: string; tone: 'slate' | 'amber' | 'brand' }) {
  const accent =
    tone === 'amber' ? 'text-amber-700' :
    tone === 'brand' ? 'text-brand-700' : 'text-slate-900';
  return (
    <div className="card !p-4">
      <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-1">{label}</div>
      <div className={`text-2xl font-bold tabular-nums ${accent}`}>{value}</div>
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-xs px-3 py-1.5 rounded-full border font-medium transition ${
        active
          ? 'bg-brand-500 border-brand-500 text-white'
          : 'bg-white border-slate-200 text-slate-700 hover:border-slate-400'
      }`}
    >
      {children}
    </button>
  );
}
