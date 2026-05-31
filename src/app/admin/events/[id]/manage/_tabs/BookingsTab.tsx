'use client';

/**
 * Bookings tab (Manage > Bookings).
 *
 * Surfaces every reservation tied to THIS event:
 *   • 3 KPI cards — Total Bookings · Total Revenue · Total Tickets Sold
 *   • Debounced search (name / phone / email / txn id)
 *   • Export CSV (anchor download — backend streams text/csv)
 *   • Table with quick visual columns + a payment-status pill
 *   • Empty state per spec
 *
 * Backend contract (other dev is building):
 *   GET /api/events/[id]/manage/bookings
 *     ?q=<search> &limit=<n>
 *   → { ok, items: BookingRow[], kpis: { totalBookings, totalRevenue,
 *        totalTickets }, eventName, eventDate, eventStatus, message? }
 *   GET /api/events/[id]/manage/bookings/export.csv → CSV blob
 *
 * We tolerate a missing endpoint (404) by rendering the empty shell so the
 * tab never blows up while backend ships incrementally.
 */

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface BookingRow {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  pax: number;
  amount: number;
  paymentStatus: 'captured' | 'pending' | 'failed' | 'refunded' | null;
  bookedAt: number | null;
  zone: string | null;
  slot: string | null;
  txnId: string | null;
}

interface Kpis {
  totalBookings: number;
  totalRevenue: number;
  totalTickets: number;
}

interface BookingsResponse {
  ok: boolean;
  items?: BookingRow[];
  kpis?: Partial<Kpis>;
  message?: string;
}

const EMPTY_KPIS: Kpis = { totalBookings: 0, totalRevenue: 0, totalTickets: 0 };

export function BookingsTab({ eventId, eventSlug }: { eventId: string; eventSlug: string | null }) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [items, setItems] = useState<BookingRow[]>([]);
  const [kpis, setKpis] = useState<Kpis>(EMPTY_KPIS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // Debounce — 250ms per spec.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebounced(query.trim()), 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = new URL(
        `/api/events/${encodeURIComponent(eventId)}/manage/bookings`,
        window.location.origin,
      );
      if (debounced) url.searchParams.set('q', debounced);
      url.searchParams.set('limit', '200');

      const res = await fetch(url.toString(), { cache: 'no-store' });
      // 404 / 501 — backend hasn't shipped this surface yet. Render the empty
      // shell rather than an error toast.
      if (res.status === 404 || res.status === 501) {
        setItems([]);
        setKpis(EMPTY_KPIS);
        return;
      }
      const d: BookingsResponse = await res.json();
      if (!d.ok) {
        setError(d.message || 'Could not load bookings.');
        return;
      }
      setItems(d.items || []);
      setKpis({
        totalBookings: Number(d.kpis?.totalBookings ?? 0),
        totalRevenue:  Number(d.kpis?.totalRevenue ?? 0),
        totalTickets:  Number(d.kpis?.totalTickets ?? 0),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
    } finally {
      setLoading(false);
    }
  }, [eventId, debounced]);

  useEffect(() => { void load(); }, [load]);

  async function handleExport() {
    setExporting(true);
    try {
      // Anchor-style download — open the CSV URL in a new tab so the browser
      // hands it to the user as a file. Using <a download> directly avoids
      // a fetch-then-blob round-trip and keeps memory usage flat.
      const a = document.createElement('a');
      a.href = `/api/events/${encodeURIComponent(eventId)}/manage/bookings/export.csv`;
      a.download = `bookings-${eventId}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } finally {
      // brief debounce — the click is synchronous, but the user sees the
      // spinner state long enough to know the action fired.
      setTimeout(() => setExporting(false), 600);
    }
  }

  const isEmpty = !loading && items.length === 0 && !debounced;
  const isNoMatch = !loading && items.length === 0 && !!debounced;

  return (
    <div className="space-y-5">
      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <KpiCard label="Total Bookings"     value={kpis.totalBookings}     money={false} loading={loading} />
        <KpiCard label="Total Revenue"      value={kpis.totalRevenue}      money={true}  loading={loading} />
        <KpiCard label="Total Tickets Sold" value={kpis.totalTickets}      money={false} loading={loading} hint="Sum of pax across confirmed" />
      </div>

      {/* Search + Export */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
        <div className="relative flex-1 min-w-0">
          <input
            className="w-full pl-10 pr-4 py-2 rounded-full bg-white border border-slate-200 text-sm
                       placeholder:text-slate-400 focus:outline-none focus:border-brand-400
                       focus:ring-2 focus:ring-brand-100"
            placeholder="Search name, phone, email, or transaction id…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search bookings"
          />
          <svg className="absolute left-3.5 top-2.5 text-slate-400" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7"/>
            <path d="M21 21l-5-5"/>
          </svg>
        </div>
        <button
          type="button"
          onClick={handleExport}
          disabled={exporting || (isEmpty && !loading)}
          className="btn btn-dark inline-flex items-center justify-center gap-2 whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <path d="M7 10l5 5 5-5"/>
            <path d="M12 15V3"/>
          </svg>
          {exporting ? 'Exporting…' : 'Export CSV'}
        </button>
      </div>

      {/* Body */}
      {error ? (
        <div className="card text-center py-8">
          <div className="text-sm text-rose-700 font-medium">{error}</div>
          <button onClick={() => void load()} className="mt-3 text-sm text-brand-600 hover:text-brand-700 font-medium">
            Retry
          </button>
        </div>
      ) : isEmpty ? (
        <EmptyBookings eventSlug={eventSlug} />
      ) : isNoMatch ? (
        <div className="card text-center py-8">
          <div className="text-sm text-slate-500">No bookings match this search.</div>
          <button onClick={() => setQuery('')} className="mt-3 text-sm text-brand-600 hover:text-brand-700 font-medium">
            Clear search
          </button>
        </div>
      ) : (
        <BookingsTable items={items} loading={loading} />
      )}
    </div>
  );
}

// ─── KPI card ─────────────────────────────────────────────────────────────

function KpiCard({
  label, value, money, loading, hint,
}: {
  label: string; value: number; money: boolean; loading: boolean; hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card min-w-0">
      <div className="text-[10px] uppercase tracking-widest text-slate-500 truncate">{label}</div>
      <div className="text-2xl font-bold text-slate-900 mt-1 truncate">
        {loading ? '—' : money ? formatINR(value) : value.toLocaleString('en-IN')}
      </div>
      {hint && <div className="text-[10px] text-slate-400 mt-1 truncate">{hint}</div>}
    </div>
  );
}

// ─── Table ────────────────────────────────────────────────────────────────

function BookingsTable({ items, loading }: { items: BookingRow[]; loading: boolean }) {
  // Show or hide zone / slot columns based on whether any row has them — keeps
  // the table compact for flat-pricing single-slot events.
  const hasZone = useMemo(() => items.some((r) => !!r.zone), [items]);
  const hasSlot = useMemo(() => items.some((r) => !!r.slot), [items]);

  return (
    <div className="card !p-0 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-widest text-slate-500">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Name</th>
              <th className="text-left px-4 py-3 font-medium">Phone</th>
              <th className="text-left px-4 py-3 font-medium hidden md:table-cell">Email</th>
              <th className="text-right px-4 py-3 font-medium">Pax</th>
              <th className="text-right px-4 py-3 font-medium">Amount</th>
              <th className="text-left px-4 py-3 font-medium">Payment</th>
              <th className="text-left px-4 py-3 font-medium hidden md:table-cell">Booked</th>
              {hasZone && <th className="text-left px-4 py-3 font-medium hidden lg:table-cell">Zone</th>}
              {hasSlot && <th className="text-left px-4 py-3 font-medium hidden lg:table-cell">Slot</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && items.length === 0 ? (
              <tr>
                <td colSpan={9} className="text-center py-10 text-sm text-slate-500">Loading bookings…</td>
              </tr>
            ) : (
              items.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50/60 transition">
                  <td className="px-4 py-3 font-medium text-slate-900 truncate max-w-[180px]">{r.name || '—'}</td>
                  <td className="px-4 py-3 text-slate-700 font-mono text-xs">{formatPhone(r.phone)}</td>
                  <td className="px-4 py-3 text-slate-600 text-xs hidden md:table-cell truncate max-w-[200px]">{r.email || '—'}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{r.pax}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium">{r.amount > 0 ? formatINR(r.amount) : '—'}</td>
                  <td className="px-4 py-3"><PaymentPill status={r.paymentStatus} /></td>
                  <td className="px-4 py-3 text-slate-500 text-xs hidden md:table-cell">{formatBookedAt(r.bookedAt)}</td>
                  {hasZone && <td className="px-4 py-3 text-slate-600 text-xs hidden lg:table-cell">{r.zone || '—'}</td>}
                  {hasSlot && <td className="px-4 py-3 text-slate-600 text-xs hidden lg:table-cell">{r.slot || '—'}</td>}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {items.length >= 200 && (
        <div className="px-4 py-3 border-t border-slate-100 text-xs text-slate-500 text-center">
          Showing first 200 results — refine the search above to find specific bookings.
        </div>
      )}
    </div>
  );
}

function PaymentPill({ status }: { status: BookingRow['paymentStatus'] }) {
  const meta = paymentMeta(status);
  return (
    <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border font-semibold ${meta.cls}`}>
      {meta.label}
    </span>
  );
}

function paymentMeta(status: BookingRow['paymentStatus']): { label: string; cls: string } {
  switch (status) {
    case 'captured': return { label: 'Paid',     cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
    case 'pending':  return { label: 'Pending',  cls: 'bg-amber-50 text-amber-700 border-amber-200' };
    case 'failed':   return { label: 'Failed',   cls: 'bg-rose-50 text-rose-700 border-rose-200' };
    case 'refunded': return { label: 'Refunded', cls: 'bg-slate-50 text-slate-600 border-slate-200' };
    default:         return { label: '—',        cls: 'bg-slate-50 text-slate-500 border-slate-200' };
  }
}

// ─── Empty state (per spec) ───────────────────────────────────────────────

function EmptyBookings({ eventSlug }: { eventSlug: string | null }) {
  return (
    <div className="card text-center py-12">
      <div className="text-3xl mb-2" aria-hidden>🎟️</div>
      <div className="text-base font-semibold text-slate-900">No bookings found</div>
      <div className="text-sm text-slate-500 mt-1 max-w-sm mx-auto">
        No one has booked this event yet. Share it to get your first booking!
      </div>
      {eventSlug && (
        <a
          href={`/event/${eventSlug}`}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-dark inline-flex items-center gap-2 mt-4"
        >
          ↗ Share booking link
        </a>
      )}
    </div>
  );
}

// ─── Formatters ───────────────────────────────────────────────────────────

function formatINR(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '₹0';
  return '₹' + Math.round(n).toLocaleString('en-IN');
}

function formatPhone(phone: string | null): string {
  if (!phone) return '—';
  const cleaned = phone.replace(/^\+?91/, '');
  return `+91 ${cleaned}`;
}

function formatBookedAt(ts: number | null): string {
  if (!ts) return '—';
  try {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    }).format(new Date(ts));
  } catch {
    return '—';
  }
}
