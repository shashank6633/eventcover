'use client';

/**
 * Check-In tab (Manage > Check-In).
 *
 * Surfaces per-event attendee verification:
 *   • 3 KPI cards — Registered · Checked-In · Progress %
 *   • Big "Scan QR Code to Check-in" CTA → /admin/scan (existing surface)
 *   • Search bar (debounced)
 *   • Two sub-tabs:
 *      - Recent Check-ins (timestamp, name, +N guests, staff)
 *      - Search Results (each row with quick "Check In" button)
 *
 * Backend contract:
 *   GET /api/events/[id]/manage/checkin
 *   → { ok, kpis: { registered, checkedIn, progressPct }, recent:
 *        CheckinRow[], event: { name, status } }
 *
 *   Search reuses the existing /api/reservations/search?eventId= endpoint
 *   so we don't pay for a parallel implementation. If the backend ships a
 *   manage-scoped variant later we can swap in a new URL.
 *
 *   Quick check-in: POST /api/reservations/[id]/checkin (existing).
 */

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

interface CheckinRow {
  id: string;
  reservationId: string;
  guestName: string;
  count: number;
  staffName: string | null;
  checkedInAt: number;
}

interface Kpis {
  registered: number;
  checkedIn: number;
  progressPct: number;
}

interface ManageCheckinResponse {
  ok: boolean;
  kpis?: Partial<Kpis>;
  recent?: CheckinRow[];
  message?: string;
}

const EMPTY_KPIS: Kpis = { registered: 0, checkedIn: 0, progressPct: 0 };

type SubTab = 'recent' | 'search';

interface SearchHit {
  id: string;
  name: string;
  phone: string | null;
  pax: number;
  checkedInPax: number;
  status: string;
}

export function CheckinTab({ eventId }: { eventId: string }) {
  const [kpis, setKpis] = useState<Kpis>(EMPTY_KPIS);
  const [recent, setRecent] = useState<CheckinRow[]>([]);
  const [loadingKpis, setLoadingKpis] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [subTab, setSubTab] = useState<SubTab>('recent');
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [checkingId, setCheckingId] = useState<string | null>(null);

  // Debounce search query
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebounced(query.trim()), 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  // Switch to Search sub-tab automatically when the user starts typing — UX
  // win: Recent ↔ Search swap feels natural without an explicit pill press.
  useEffect(() => {
    if (debounced) setSubTab('search');
  }, [debounced]);

  const loadKpis = useCallback(async () => {
    setLoadingKpis(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/events/${encodeURIComponent(eventId)}/manage/checkin`,
        { cache: 'no-store' },
      );
      if (res.status === 404 || res.status === 501) {
        setKpis(EMPTY_KPIS);
        setRecent([]);
        return;
      }
      const d: ManageCheckinResponse = await res.json();
      if (!d.ok) {
        setError(d.message || 'Could not load check-in summary.');
        return;
      }
      setKpis({
        registered:  Number(d.kpis?.registered ?? 0),
        checkedIn:   Number(d.kpis?.checkedIn ?? 0),
        progressPct: Number(d.kpis?.progressPct ?? 0),
      });
      setRecent(d.recent || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
    } finally {
      setLoadingKpis(false);
    }
  }, [eventId]);

  useEffect(() => { void loadKpis(); }, [loadKpis]);

  // Search runs against the existing reservation-search endpoint scoped to
  // this event. We tolerate 404 (older deploy) by falling back to the manage
  // checkin endpoint's search support (if any) — current implementations
  // simply return an empty list which renders the no-match state.
  const runSearch = useCallback(async (q: string) => {
    if (!q) { setSearchHits([]); return; }
    setSearching(true);
    try {
      const url = new URL('/api/reservations/search', window.location.origin);
      url.searchParams.set('q', q);
      url.searchParams.set('eventId', eventId);
      url.searchParams.set('limit', '25');
      const res = await fetch(url.toString(), { cache: 'no-store' });
      if (!res.ok) { setSearchHits([]); return; }
      const d = await res.json();
      const items: SearchHit[] = (d.results || d.items || []).map((r: Record<string, unknown>) => ({
        id: String(r.id),
        name: String(r.name || ''),
        phone: r.phone != null ? String(r.phone) : null,
        pax: Number(r.pax || r.total_pax || 0),
        checkedInPax: Number(r.checked_in_pax || 0),
        status: String(r.reservation_status || r.status || 'pending'),
      }));
      setSearchHits(items);
    } catch {
      setSearchHits([]);
    } finally {
      setSearching(false);
    }
  }, [eventId]);

  useEffect(() => { void runSearch(debounced); }, [debounced, runSearch]);

  async function handleCheckIn(reservationId: string, pax: number) {
    if (pax <= 0) return;
    setCheckingId(reservationId);
    try {
      const res = await fetch(`/api/reservations/${encodeURIComponent(reservationId)}/checkin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: pax }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        alert(d.message || 'Could not check in.');
        return;
      }
      // Refresh both KPIs + search results so the row reflects the new state.
      await Promise.all([loadKpis(), runSearch(debounced)]);
    } finally {
      setCheckingId(null);
    }
  }

  return (
    <div className="space-y-5">
      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <KpiCard label="Registered"  value={kpis.registered} loading={loadingKpis} />
        <KpiCard label="Checked-In"  value={kpis.checkedIn}  loading={loadingKpis} />
        <KpiCard
          label="Progress"
          value={kpis.progressPct}
          loading={loadingKpis}
          suffix="%"
          hint={kpis.registered > 0 ? `${kpis.checkedIn} of ${kpis.registered}` : undefined}
        />
      </div>

      {/* Scan CTA */}
      <Link
        href={`/admin/scan?event=${encodeURIComponent(eventId)}`}
        className="card flex items-center justify-between gap-3 hover:shadow-elevated transition group"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-11 h-11 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center flex-shrink-0">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M3 7V5a2 2 0 0 1 2-2h2"/>
              <path d="M21 7V5a2 2 0 0 0-2-2h-2"/>
              <path d="M3 17v2a2 2 0 0 0 2 2h2"/>
              <path d="M21 17v2a2 2 0 0 1-2 2h-2"/>
              <rect x="8" y="8" width="3" height="3"/>
              <rect x="13" y="8" width="3" height="3"/>
              <rect x="8" y="13" width="3" height="3"/>
              <path d="M13 13h3v3"/>
            </svg>
          </div>
          <div className="min-w-0">
            <div className="text-base font-semibold text-slate-900">Scan QR Code to Check-in</div>
            <div className="text-xs text-slate-500 mt-0.5 truncate">
              Open the scanner — works on phones, tablets, and laptop cameras.
            </div>
          </div>
        </div>
        <span className="text-brand-600 font-medium text-sm group-hover:text-brand-700 hidden sm:inline">
          Open scanner →
        </span>
      </Link>

      {/* Search bar */}
      <div className="relative">
        <input
          className="w-full pl-10 pr-4 py-2 rounded-full bg-white border border-slate-200 text-sm
                     placeholder:text-slate-400 focus:outline-none focus:border-brand-400
                     focus:ring-2 focus:ring-brand-100"
          placeholder="Search name, phone, or email…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search attendees"
        />
        <svg className="absolute left-3.5 top-2.5 text-slate-400" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="7"/>
          <path d="M21 21l-5-5"/>
        </svg>
      </div>

      {/* Sub-tab pills */}
      <div className="flex gap-2 border-b border-slate-200">
        <SubTabButton active={subTab === 'recent'} onClick={() => setSubTab('recent')}>
          Recent Check-ins
        </SubTabButton>
        <SubTabButton active={subTab === 'search'} onClick={() => setSubTab('search')}>
          Search Results {debounced && <span className="text-[10px] text-slate-400 ml-1">({searchHits.length})</span>}
        </SubTabButton>
      </div>

      {error && (
        <div className="card !py-3 !px-4 text-sm text-rose-700">
          {error}
        </div>
      )}

      {/* Body */}
      {subTab === 'recent' ? (
        recent.length === 0 && !loadingKpis ? (
          <EmptyRecent />
        ) : (
          <RecentList items={recent} loading={loadingKpis} />
        )
      ) : (
        <SearchResults
          items={searchHits}
          query={debounced}
          searching={searching}
          checkingId={checkingId}
          onCheckIn={handleCheckIn}
        />
      )}
    </div>
  );
}

// ─── KPI card ─────────────────────────────────────────────────────────────

function KpiCard({
  label, value, loading, suffix, hint,
}: {
  label: string; value: number; loading: boolean; suffix?: string; hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card min-w-0">
      <div className="text-[10px] uppercase tracking-widest text-slate-500 truncate">{label}</div>
      <div className="text-2xl font-bold text-slate-900 mt-1 truncate">
        {loading ? '—' : `${value.toLocaleString('en-IN')}${suffix || ''}`}
      </div>
      {hint && <div className="text-[10px] text-slate-400 mt-1 truncate">{hint}</div>}
    </div>
  );
}

function SubTabButton({
  active, onClick, children,
}: {
  active: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-sm px-3 py-2 -mb-px border-b-2 transition ${
        active
          ? 'border-brand-500 text-brand-700 font-semibold'
          : 'border-transparent text-slate-500 hover:text-slate-800'
      }`}
    >
      {children}
    </button>
  );
}

// ─── Recent list ──────────────────────────────────────────────────────────

function RecentList({ items, loading }: { items: CheckinRow[]; loading: boolean }) {
  return (
    <div className="card !p-0 overflow-hidden">
      <ul className="divide-y divide-slate-100">
        {loading && items.length === 0 ? (
          <li className="p-4 text-sm text-slate-500 text-center">Loading recent check-ins…</li>
        ) : (
          items.map((row) => (
            <li key={row.id} className="p-4 flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-emerald-50 text-emerald-700 flex items-center justify-center flex-shrink-0">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M20 6L9 17l-5-5"/>
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-slate-900 truncate">
                  {row.guestName || 'Unknown guest'}
                  <span className="text-slate-500 font-normal"> · +{row.count} {row.count === 1 ? 'guest' : 'guests'}</span>
                </div>
                <div className="text-xs text-slate-500 truncate">
                  {formatTime(row.checkedInAt)}
                  {row.staffName && <span> · by {row.staffName}</span>}
                </div>
              </div>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

function EmptyRecent() {
  return (
    <div className="card text-center py-12">
      <div className="text-3xl mb-2" aria-hidden>📋</div>
      <div className="text-base font-semibold text-slate-900">No check-ins yet</div>
      <div className="text-sm text-slate-500 mt-1 max-w-sm mx-auto">
        Scan QR codes or search attendees to check them in.
      </div>
    </div>
  );
}

// ─── Search results ───────────────────────────────────────────────────────

function SearchResults({
  items, query, searching, checkingId, onCheckIn,
}: {
  items: SearchHit[];
  query: string;
  searching: boolean;
  checkingId: string | null;
  onCheckIn: (id: string, pax: number) => void;
}) {
  if (!query) {
    return (
      <div className="card text-center py-10">
        <div className="text-sm text-slate-500">Start typing above to search attendees.</div>
      </div>
    );
  }
  if (searching && items.length === 0) {
    return (
      <div className="card text-center py-10 text-sm text-slate-500">Searching…</div>
    );
  }
  if (!searching && items.length === 0) {
    return (
      <div className="card text-center py-10">
        <div className="text-sm text-slate-500">No matching reservations.</div>
      </div>
    );
  }
  return (
    <div className="card !p-0 overflow-hidden">
      <ul className="divide-y divide-slate-100">
        {items.map((r) => {
          const remaining = Math.max(0, r.pax - r.checkedInPax);
          const fullyCheckedIn = remaining === 0;
          return (
            <li key={r.id} className="p-4 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-slate-900 truncate">{r.name || 'Unknown'}</div>
                <div className="text-xs text-slate-500 truncate">
                  {r.phone ? `+91 ${r.phone.replace(/^\+?91/, '')}` : '—'}
                  <span> · {r.checkedInPax}/{r.pax} checked in</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onCheckIn(r.id, remaining)}
                disabled={fullyCheckedIn || checkingId === r.id}
                className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition whitespace-nowrap ${
                  fullyCheckedIn
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200 cursor-default'
                    : 'bg-brand-500 text-white border-brand-500 hover:bg-brand-600 disabled:opacity-60'
                }`}
              >
                {fullyCheckedIn
                  ? 'All in'
                  : checkingId === r.id
                    ? 'Checking…'
                    : `Check in +${remaining}`}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function formatTime(ts: number): string {
  try {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short',
    }).format(new Date(ts));
  } catch {
    return '—';
  }
}
