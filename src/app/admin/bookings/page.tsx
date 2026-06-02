'use client';

/**
 * /admin/bookings — global cross-event Bookings dashboard.
 *
 * Surfaces every payment-bearing row across every event (captured, pending,
 * abandoned, refunded) in one place so the operator doesn't have to drill
 * into each event to track booking activity. Replaces the old standalone
 * /admin/abandoned-bookings — that flow lives here now as a status filter.
 *
 * Header strip:
 *   • 4 KPI tiles — Total Bookings · Revenue · Pax · Abandoned-%
 *
 * Toolbar:
 *   • Status tab strip (All / Captured / Pending / Abandoned / Refunded)
 *   • Event dropdown (filters to one event)
 *   • Search box (name / phone / email / order id) — debounced 300ms
 *
 * Table:
 *   • Customer (name + phone) → Event/date → M·F·C breakdown → Zone/slot →
 *     Amount → Status pill → Created-at
 *   • Each row links to /admin/issue?r=<reservationId> when applicable so
 *     the operator can convert a paid booking into a wallet pass quickly.
 *
 * Backend: GET /api/bookings/list — see route.ts for the contract.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';

interface BookingRow {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  eventId: string | null;
  eventName: string | null;
  eventDate: string | null;
  eventSlug: string | null;
  reservationId: string | null;
  pax: number | null;
  maleCount: number | null;
  femaleCount: number | null;
  coupleCount: number | null;
  zoneName: string | null;
  slotLabel: string | null;
  amount: number;
  discount: number;
  razorpayOrderId: string | null;
  razorpayPaymentId: string | null;
  couponCode: string | null;
  status: 'captured' | 'created' | 'failed' | 'refunded' | 'recovered';
  createdAt: number;
  capturedAt: number | null;
  errorDescription: string | null;
  ticketTypeLabel: string | null;
}

interface Counts {
  total: number;
  captured: number;
  pending: number;
  abandoned: number;
  refunded: number;
  totalRevenue: number;
  totalPax: number;
}

interface EventOption { id: string; name: string; event_date: string }

type StatusBucket = 'all' | 'captured' | 'pending' | 'abandoned' | 'refunded';

interface ListResponse {
  ok: boolean;
  items?: BookingRow[];
  counts?: Counts;
  message?: string;
}

const EMPTY_COUNTS: Counts = {
  total: 0, captured: 0, pending: 0, abandoned: 0, refunded: 0,
  totalRevenue: 0, totalPax: 0,
};

export default function BookingsPage() {
  // URL → local state. We honor ?status= so the abandoned-bookings redirect
  // (which forwards ?status=abandoned) lands on the right tab.
  const initialStatus = (() => {
    if (typeof window === 'undefined') return 'all' as StatusBucket;
    const v = new URL(window.location.href).searchParams.get('status') || 'all';
    return (['all', 'captured', 'pending', 'abandoned', 'refunded'].includes(v) ? v : 'all') as StatusBucket;
  })();

  const [status, setStatus] = useState<StatusBucket>(initialStatus);
  const [eventId, setEventId] = useState<string>('');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [items, setItems] = useState<BookingRow[]>([]);
  const [counts, setCounts] = useState<Counts>(EMPTY_COUNTS);
  const [events, setEvents] = useState<EventOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Debounce search input — 300ms feels snappy without spamming the DB.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  // Pull the event list for the filter dropdown once. Cheap — typical
  // venue has under 100 events.
  useEffect(() => {
    fetch('/api/events')
      .then((r) => r.json())
      .then((d) => {
        if (d.ok && Array.isArray(d.events)) {
          setEvents(d.events.map((e: { id: string; name: string; event_date: string }) => ({
            id: e.id, name: e.name, event_date: e.event_date,
          })));
        }
      })
      .catch(() => { /* silent — filter just stays empty */ });
  }, []);

  // Refetch whenever any filter changes.
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const u = new URL('/api/bookings/list', window.location.origin);
      u.searchParams.set('status', status);
      if (eventId) u.searchParams.set('eventId', eventId);
      if (debouncedQuery) u.searchParams.set('q', debouncedQuery);
      const res = await fetch(u.toString());
      const data = (await res.json().catch(() => ({}))) as ListResponse;
      if (!res.ok || !data.ok) {
        setError(data.message || `HTTP ${res.status}`);
        setItems([]);
        setCounts(EMPTY_COUNTS);
        return;
      }
      setItems(data.items || []);
      setCounts(data.counts || EMPTY_COUNTS);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
      setItems([]);
      setCounts(EMPTY_COUNTS);
    } finally {
      setLoading(false);
    }
  }, [status, eventId, debouncedQuery]);

  useEffect(() => { void load(); }, [load]);

  const abandonedPct = useMemo(() => {
    if (counts.total === 0) return 0;
    return Math.round((counts.abandoned / counts.total) * 100);
  }, [counts]);

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <header className="mb-6">
        <div className="text-[11px] tracking-widest uppercase text-slate-400">Online sales</div>
        <h1 className="text-2xl font-bold text-slate-900 mt-1">Bookings</h1>
        <p className="text-sm text-slate-400 mt-1 max-w-2xl">
          Every payment-bearing booking that came through your event pages — captured,
          pending, abandoned, refunded. Reservego entries live separately under{' '}
          <Link href="/admin/reservations" className="text-brand-600 hover:underline">Reservego</Link>.
        </p>
      </header>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Stat label="Total bookings" value={counts.total} />
        <Stat label="Revenue" value={`₹${counts.totalRevenue.toLocaleString('en-IN')}`} tone="emerald" />
        <Stat label="Pax" value={counts.totalPax} />
        <Stat label="Abandoned" value={`${abandonedPct}%`} tone="amber" />
      </div>

      {/* Toolbar */}
      <div className="rounded-xl border border-slate-200 bg-white p-3 mb-4 space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {(['all', 'captured', 'pending', 'abandoned', 'refunded'] as StatusBucket[]).map((b) => (
            <button
              key={b}
              type="button"
              onClick={() => setStatus(b)}
              className={
                'text-xs font-medium px-3 py-1.5 rounded-lg border transition ' +
                (status === b
                  ? 'bg-brand-50 border-brand-300 text-brand-800'
                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50')
              }
            >
              {labelFor(b)}{b !== 'all' && countFor(b, counts) > 0 ? ` · ${countFor(b, counts)}` : ''}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <select
            className="input !py-1.5 !px-2 text-sm flex-1 min-w-[180px]"
            value={eventId}
            onChange={(e) => setEventId(e.target.value)}
          >
            <option value="">All events</option>
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} · {e.event_date}
              </option>
            ))}
          </select>
          <input
            type="search"
            className="input !py-1.5 !px-2 text-sm flex-1 min-w-[220px]"
            placeholder="Search name, phone, email, order id…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        {error && (
          <div className="px-4 py-3 text-sm text-rose-700 bg-rose-50 border-b border-rose-200">
            {error}
          </div>
        )}
        {loading && items.length === 0 ? (
          <div className="px-4 py-16 text-center text-sm text-slate-400">Loading bookings…</div>
        ) : items.length === 0 ? (
          <EmptyState status={status} eventId={eventId} query={debouncedQuery} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold">Customer</th>
                  <th className="text-left px-3 py-2 font-semibold">Event</th>
                  <th className="text-left px-3 py-2 font-semibold">Mix</th>
                  <th className="text-left px-3 py-2 font-semibold">Seat / Slot</th>
                  <th className="text-right px-3 py-2 font-semibold">Amount</th>
                  <th className="text-left px-3 py-2 font-semibold">Status</th>
                  <th className="text-left px-3 py-2 font-semibold">When</th>
                  <th className="text-right px-3 py-2 font-semibold"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <BookingRowComp key={row.id} row={row} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function labelFor(b: StatusBucket): string {
  switch (b) {
    case 'all': return 'All';
    case 'captured': return 'Captured';
    case 'pending': return 'Pending';
    case 'abandoned': return 'Abandoned';
    case 'refunded': return 'Refunded';
  }
}

function countFor(b: StatusBucket, c: Counts): number {
  switch (b) {
    case 'captured': return c.captured;
    case 'pending': return c.pending;
    case 'abandoned': return c.abandoned;
    case 'refunded': return c.refunded;
    case 'all': return c.total;
  }
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: 'emerald' | 'amber' }) {
  const toneCls =
    tone === 'emerald' ? 'text-emerald-700' :
    tone === 'amber' ? 'text-amber-700' :
    'text-slate-900';
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wider text-slate-400">{label}</div>
      <div className={`text-xl font-bold mt-0.5 ${toneCls}`}>{value}</div>
    </div>
  );
}

function EmptyState({ status, eventId, query }: { status: StatusBucket; eventId: string; query: string }) {
  const filtered = eventId || query || status !== 'all';
  return (
    <div className="px-4 py-16 text-center text-sm text-slate-400">
      {filtered
        ? 'No bookings match those filters yet.'
        : 'No online bookings yet. Bookings show up here as soon as customers pay on your event pages.'}
    </div>
  );
}

function BookingRowComp({ row }: { row: BookingRow }) {
  const mixSummary = formatMfc(row);
  return (
    <tr className="border-t border-slate-100 hover:bg-slate-50/50">
      <td className="px-3 py-2.5 align-top">
        <div className="text-sm font-semibold text-slate-900">{row.name || '—'}</div>
        <div className="text-xs text-slate-500">{row.phone || ''}</div>
        {row.email && <div className="text-[11px] text-slate-400">{row.email}</div>}
      </td>
      <td className="px-3 py-2.5 align-top">
        {row.eventName ? (
          <>
            <div className="text-sm text-slate-800">{row.eventName}</div>
            <div className="text-[11px] text-slate-500">{row.eventDate}</div>
          </>
        ) : (
          <span className="text-slate-400">—</span>
        )}
      </td>
      <td className="px-3 py-2.5 align-top">
        <div className="text-sm text-slate-700">
          {row.pax != null ? `${row.pax} pax` : '—'}
        </div>
        {mixSummary && (
          <div className="text-[11px] font-mono text-slate-500 mt-0.5">{mixSummary}</div>
        )}
      </td>
      <td className="px-3 py-2.5 align-top">
        {row.ticketTypeLabel || row.zoneName ? (
          <div className="text-xs text-slate-700">{row.ticketTypeLabel || row.zoneName}</div>
        ) : (
          <span className="text-slate-400 text-xs">—</span>
        )}
        {row.slotLabel && (
          <div className="text-[11px] text-slate-500 mt-0.5">{row.slotLabel}</div>
        )}
      </td>
      <td className="px-3 py-2.5 align-top text-right font-mono">
        <div className="text-sm font-semibold text-slate-900">₹{row.amount.toLocaleString('en-IN')}</div>
        {row.discount > 0 && (
          <div className="text-[10px] text-emerald-600">−₹{row.discount} {row.couponCode ? `· ${row.couponCode}` : ''}</div>
        )}
      </td>
      <td className="px-3 py-2.5 align-top">
        <StatusPill status={row.status} />
        {row.errorDescription && (
          <div className="text-[10px] text-rose-600 mt-0.5 line-clamp-2 max-w-[200px]">
            {row.errorDescription}
          </div>
        )}
      </td>
      <td className="px-3 py-2.5 align-top whitespace-nowrap">
        <div className="text-xs text-slate-700">{formatRelative(row.createdAt)}</div>
        <div className="text-[10px] text-slate-400">{new Date(row.createdAt).toLocaleString()}</div>
      </td>
      <td className="px-3 py-2.5 align-top text-right">
        {row.reservationId && (
          <Link
            href={`/admin/issue?r=${encodeURIComponent(row.reservationId)}`}
            className="text-[11px] font-medium text-brand-700 hover:underline whitespace-nowrap"
          >
            Issue cover →
          </Link>
        )}
      </td>
    </tr>
  );
}

function StatusPill({ status }: { status: BookingRow['status'] }) {
  const map: Record<BookingRow['status'], { label: string; cls: string }> = {
    captured: { label: 'Captured', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    created:  { label: 'Pending',  cls: 'bg-amber-50 text-amber-700 border-amber-200' },
    failed:   { label: 'Failed',   cls: 'bg-rose-50 text-rose-700 border-rose-200' },
    refunded: { label: 'Refunded', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
    recovered:{ label: 'Recovered',cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  };
  const { label, cls } = map[status] || { label: status, cls: 'bg-slate-100 text-slate-600 border-slate-200' };
  return (
    <span className={`inline-block text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border font-semibold ${cls}`}>
      {label}
    </span>
  );
}

function formatMfc(row: BookingRow): string | null {
  const m = Number(row.maleCount || 0);
  const f = Number(row.femaleCount || 0);
  const c = Number(row.coupleCount || 0);
  if (m + f + c === 0) return null;
  const parts: string[] = [];
  if (m > 0) parts.push(`${m}M`);
  if (f > 0) parts.push(`${f}F`);
  if (c > 0) parts.push(`${c}C`);
  return parts.join(' · ');
}

function formatRelative(ts: number): string {
  const delta = Date.now() - ts;
  if (delta < 60_000) return 'just now';
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  if (delta < 7 * 86_400_000) return `${Math.floor(delta / 86_400_000)}d ago`;
  return new Date(ts).toLocaleDateString();
}
