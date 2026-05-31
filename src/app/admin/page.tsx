'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Event } from '@/lib/events';
import { formatCompactINR } from '@/lib/format';

interface KpiSnapshot {
  totalCustomers: number;
  totalIncoming: number;
  totalCoverCharge: number;
  amountIssued: number;
  totalRedeems: number;
}

type Filter = 'published' | 'today' | 'all' | 'upcoming' | 'past' | 'draft';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'published', label: 'All Published Events' },
  { id: 'today',     label: "Today's Events" },
  { id: 'all',       label: 'All Events' },
  { id: 'upcoming',  label: 'Upcoming Events' },
  { id: 'past',      label: 'Past Events' },
  { id: 'draft',     label: 'Drafts' },
];

export default function DashboardPage() {
  const router = useRouter();
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('published');
  const [query, setQuery] = useState('');
  const [kpis, setKpis] = useState<KpiSnapshot | null>(null);
  const [kpisLoading, setKpisLoading] = useState(true);

  useEffect(() => {
    fetch('/api/events', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => { if (d.ok) setEvents(d.events || []); setLoading(false); });
  }, []);

  // Hub at-a-glance widget — fire-and-forget, doesn't block the events list.
  // 403/401 (e.g. cashier-only or logged-out) silently leaves the widget hidden.
  useEffect(() => {
    fetch('/api/analytics/kpis?from=last7d', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.ok && d.range) {
          setKpis({
            totalCustomers: d.range.totalCustomers ?? 0,
            totalIncoming: d.range.totalIncoming ?? 0,
            totalCoverCharge: d.range.totalCoverCharge ?? 0,
            amountIssued: d.range.amountIssued ?? 0,
            totalRedeems: d.range.totalRedeems ?? 0,
          });
        }
        setKpisLoading(false);
      })
      .catch(() => setKpisLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const today = todayISO();
    const q = query.trim().toLowerCase();
    return events.filter((e) => {
      // status / time filter
      if (filter === 'published' && e.status === 'draft') return false;
      if (filter === 'today'    && e.event_date !== today) return false;
      if (filter === 'upcoming' && (e.event_date < today || e.status === 'closed')) return false;
      if (filter === 'past'     && e.event_date >= today)  return false;
      if (filter === 'draft'    && e.status !== 'draft')   return false;
      // search
      if (q && !e.name.toLowerCase().includes(q) && !e.event_date.includes(q)) return false;
      return true;
    });
  }, [events, filter, query]);

  if (loading) {
    return <div className="max-w-6xl mx-auto px-6 md:px-8 py-6 text-slate-500">Loading events…</div>;
  }

  return (
    <div className="max-w-6xl mx-auto px-6 md:px-8 py-6">
      {/* Last 7 days at a glance — top KPIs pulled from /api/analytics/kpis.
          Silently hidden if the role isn't allowed (e.g. captain / entry). */}
      <Last7DaysGlance kpis={kpis} loading={kpisLoading} />

      {/* Filters + search + CTA */}
      <div className="flex flex-col lg:flex-row lg:items-center gap-3 lg:gap-4">
        <div className="flex flex-wrap gap-2 flex-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`chip ${filter === f.id ? 'chip-active' : 'chip-default'}`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="flex gap-2 lg:gap-3 items-center">
          <div className="relative">
            <input
              className="w-64 pl-10 pr-4 py-2 rounded-full bg-white border border-slate-200 text-sm
                         placeholder:text-slate-400 focus:outline-none focus:border-brand-400
                         focus:ring-2 focus:ring-brand-100"
              placeholder="Search Events..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <svg className="absolute left-3.5 top-2.5 text-slate-400" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="7"/>
              <path d="M21 21l-5-5"/>
            </svg>
          </div>
          <Link href="/admin/events?new=1" className="btn btn-dark inline-flex items-center gap-2 whitespace-nowrap">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14"/>
            </svg>
            Add Event
          </Link>
        </div>
      </div>

      {/* Body */}
      {filtered.length === 0 ? (
        <EmptyState
          query={query}
          filter={filter}
          onClear={() => { setFilter('all'); setQuery(''); }}
          onCreate={() => router.push('/admin/events?new=1')}
        />
      ) : (
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((e) => (
            <EventCard key={e.id} event={e} />
          ))}
        </div>
      )}
    </div>
  );
}

function EventCard({ event }: { event: Event }) {
  return (
    <Link href={`/admin/events?edit=${event.id}`} className="card hover:shadow-elevated transition group">
      <div className="flex items-start justify-between">
        <div className="text-[11px] tracking-widest uppercase text-slate-500">{event.event_date}</div>
        <span className={`tag ${statusTag(event.status)}`}>{event.status}</span>
      </div>
      <div className="text-lg font-semibold text-slate-900 mt-2 group-hover:text-brand-700 transition">
        {event.name}
      </div>
      <div className="text-xs text-slate-500 mt-1">
        Base ₹{event.base_entry_fee.toLocaleString('en-IN')} · cover {coverDesc(event)}
      </div>
      {event.pax_rules.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {event.pax_rules.slice(0, 4).map((r) => (
            <span key={r.label} className="text-[10px] px-2 py-0.5 rounded-full bg-slate-50 border border-slate-200 text-slate-600">
              {r.label}
            </span>
          ))}
        </div>
      )}
      <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
        <span className="text-slate-500">Cutoff {String(event.cutoff_hour).padStart(2,'0')}:00 IST</span>
        <span className="flex items-center gap-3">
          {event.status === 'live' && (
            // Per-event Insights surface — only relevant when the event is actually
            // live (otherwise there's no traffic to analyse). Stops event-card
            // navigation by handling the click locally so the wrapping <Link>
            // doesn't take precedence.
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                window.location.href = `/admin/events/${event.id}/insights`;
              }}
              className="text-brand-600 font-medium hover:text-brand-700 inline-flex items-center gap-1"
              aria-label="Open Insights"
            >
              <span aria-hidden>📊</span> Insights
            </button>
          )}
          {event.status === 'live' && (
            // Per-event Manage page — bookings, check-in, reminders, post-sale,
            // recap photos, refundable entries. Same click-defuse pattern as
            // Insights so the wrapping card <Link> doesn't take over.
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                window.location.href = `/admin/events/${event.id}/manage`;
              }}
              className="text-brand-600 font-medium hover:text-brand-700 inline-flex items-center gap-1"
              aria-label="Open Manage"
            >
              <span aria-hidden>📋</span> Manage
            </button>
          )}
          {event.status === 'live' && (
            // Per-event Promote page — tracking links + commission affiliate
            // assignments. Only relevant once the event is publicly bookable.
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                window.location.href = `/admin/events/${event.id}/promote`;
              }}
              className="text-brand-600 font-medium hover:text-brand-700 inline-flex items-center gap-1"
              aria-label="Open Promote"
            >
              <span aria-hidden>📣</span> Promote
            </button>
          )}
          <span className="text-brand-600 font-medium group-hover:text-brand-700">Manage →</span>
        </span>
      </div>
    </Link>
  );
}

function statusTag(s: string): string {
  if (s === 'live')   return 'tag-active';
  if (s === 'draft')  return 'tag-expired';
  if (s === 'closed') return 'tag-exhausted';
  return 'tag-exhausted';
}

function coverDesc(e: Event): string {
  if (e.cover_policy === 'equal')   return '1:1 entry';
  if (e.cover_policy === 'fixed')   return `₹${e.cover_value}/pax flat`;
  if (e.cover_policy === 'percent') return `${e.cover_value}% of entry`;
  return '—';
}

function EmptyState({ query, filter, onClear, onCreate }: {
  query: string; filter: Filter; onClear: () => void; onCreate: () => void;
}) {
  const isSearching = query.trim().length > 0;
  const isFiltered = filter !== 'all';

  if (isSearching || isFiltered) {
    return (
      <div className="card mt-6 text-center py-10">
        <div className="text-sm text-slate-500">No events match this view.</div>
        <button className="mt-3 text-sm text-brand-600 hover:text-brand-700 font-medium" onClick={onClear}>
          Clear filter
        </button>
      </div>
    );
  }

  return (
    <div className="mt-12 flex flex-col items-center text-center px-4">
      <EventsIllustration />
      <div className="text-xl font-semibold text-slate-900 mt-6">Start building your first event</div>
      <button
        onClick={onCreate}
        className="mt-3 inline-flex items-center gap-1.5 text-brand-600 hover:text-brand-700 font-medium text-sm"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 5v14M5 12h14"/>
        </svg>
        Create an event
      </button>
    </div>
  );
}

function EventsIllustration() {
  return (
    <svg width="280" height="200" viewBox="0 0 280 200" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      {/* Squiggle 1 - brand rust */}
      <path d="M40 80 Q 30 60 50 50 Q 70 40 75 60 Q 80 80 60 90 Q 40 100 50 120"
            stroke="#C1551A" strokeWidth="9" strokeLinecap="round" fill="none"/>
      {/* Squiggle 2 - amber */}
      <path d="M100 50 Q 90 35 110 30 Q 130 25 130 45 Q 130 65 110 70 Q 90 75 95 95"
            stroke="#F59E0B" strokeWidth="9" strokeLinecap="round" fill="none"/>
      {/* Squiggle 3 - emerald */}
      <path d="M155 80 Q 140 65 150 50 Q 165 35 180 50 Q 195 65 180 80 Q 165 95 175 115"
            stroke="#10B981" strokeWidth="9" strokeLinecap="round" fill="none"/>
      {/* Squiggle 4 - pink */}
      <path d="M195 130 Q 185 110 205 105 Q 225 100 230 120 Q 235 140 215 145 Q 195 150 205 170"
            stroke="#EC4899" strokeWidth="9" strokeLinecap="round" fill="none"/>
      {/* Tiny pencils */}
      <g stroke="#1F2937" strokeWidth="1.5" fill="none">
        <path d="M80 130 l8 8 M88 138 l3 -3 M81 137 l1 -2"/>
        <path d="M180 150 l8 -8 M188 142 l3 3 M179 144 l1 2"/>
      </g>
    </svg>
  );
}

function Last7DaysGlance({ kpis, loading }: { kpis: KpiSnapshot | null; loading: boolean }) {
  // Hide entirely if the request failed / 403'd — we never want to render an
  // empty widget skeleton for users who can't see analytics in the first place.
  if (!loading && !kpis) return null;

  const tiles: { label: string; value: number | undefined; money: boolean }[] = [
    { label: 'Total Customers',    value: kpis?.totalCustomers,    money: false },
    { label: 'Total Incoming',     value: kpis?.totalIncoming,     money: true  },
    { label: 'Total Cover Charge', value: kpis?.totalCoverCharge,  money: true  },
    { label: 'Amount Issued',      value: kpis?.amountIssued,      money: true  },
  ];

  return (
    <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-card">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[11px] tracking-widest uppercase text-slate-400">Last 7 days at a glance</div>
          <div className="text-sm text-slate-500 mt-0.5">Wallet, cover, and redemption activity across all events.</div>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-xl border border-slate-200 bg-[#FAFAF7] p-3 min-w-0">
            <div className="text-[10px] uppercase tracking-widest text-slate-500 truncate">{t.label}</div>
            <div className="text-lg font-bold text-slate-900 mt-1 truncate">
              {loading || t.value == null
                ? '—'
                : t.money
                  ? formatCompactINR(t.value)
                  : t.value.toLocaleString('en-IN')}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 flex justify-end">
        <Link
          href="/admin/analytics"
          className="text-sm font-medium text-brand-600 hover:text-brand-700 transition"
        >
          View full analytics →
        </Link>
      </div>
    </section>
  );
}

function todayISO(): string {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });
  return fmt.format(new Date());
}
