'use client';

/**
 * Insights tab container.
 *
 * Owns the three-tab routing (Overview / Abandoned Carts / Cart Recovery) +
 * the time-range chips at the top. The shell is intentionally dumb about
 * the data layer — each tab fetches its own backend endpoint so a slow
 * Cart Recovery call doesn't block the Overview render.
 *
 * Tab + range are stored in the URL query string so deep-linking + browser
 * back/forward Just Works. We use replaceState rather than router.replace
 * to avoid full re-renders when only the tab pill changes.
 */

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { OverviewTab } from './OverviewTab';
import { AbandonedTab } from './AbandonedTab';
import { RecoveryTab } from './RecoveryTab';

export type InsightsTab = 'overview' | 'abandoned-carts' | 'cart-recovery';
export type InsightsRange = '7d' | '14d' | '30d' | '90d';

interface Props {
  eventId: string;
  eventName: string;
  eventStatus: string;
  eventSlug: string | null;
  initialTab: InsightsTab;
  initialRange: InsightsRange;
}

const TABS: { id: InsightsTab; label: string; icon: React.ReactNode }[] = [
  { id: 'overview',        label: 'Overview',       icon: <IconChart /> },
  { id: 'abandoned-carts', label: 'Abandoned Carts',icon: <IconCart /> },
  { id: 'cart-recovery',   label: 'Cart Recovery',  icon: <IconRecover /> },
];

const RANGES: { id: InsightsRange; label: string }[] = [
  { id: '7d',  label: '7 days' },
  { id: '14d', label: '14 days' },
  { id: '30d', label: '30 days' },
  { id: '90d', label: '90 days' },
];

export function InsightsShell({
  eventId, eventName, eventStatus, eventSlug, initialTab, initialRange,
}: Props) {
  const [tab, setTab] = useState<InsightsTab>(initialTab);
  const [range, setRange] = useState<InsightsRange>(initialRange);

  // Reflect tab/range changes back into the URL without triggering a re-render
  // of the Server Component. history.replaceState is intentional — using
  // router.replace would re-run the auth gate + getEvent lookup on every chip
  // click, which is wasteful.
  const syncUrl = useCallback((nextTab: InsightsTab, nextRange: InsightsRange) => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    url.searchParams.set('tab', nextTab);
    url.searchParams.set('range', nextRange);
    window.history.replaceState(null, '', url.toString());
  }, []);

  useEffect(() => { syncUrl(tab, range); }, [tab, range, syncUrl]);

  return (
    <div className="px-6 md:px-8 py-6 max-w-7xl mx-auto">
      {/* Top bar — back arrow + title + LIVE badge + public-page link */}
      <div className="flex flex-wrap items-center gap-3 mb-2">
        <Link
          href="/admin"
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 transition"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
          Back
        </Link>
        <h1 className="text-2xl font-bold text-slate-900 truncate">{eventName}</h1>
        {eventStatus === 'live' && (
          <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border font-semibold bg-emerald-50 text-emerald-700 border-emerald-200">
            Live
          </span>
        )}
        {eventSlug && (
          <a
            href={`/event/${eventSlug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto inline-flex items-center gap-1 text-sm text-brand-600 hover:text-brand-700 font-medium"
          >
            ↗ Public page
          </a>
        )}
      </div>
      <p className="text-sm text-slate-500 mb-5">
        Per-event funnel, cart recovery, and abandoned-checkout follow-up.
      </p>

      {/* Range chips — only meaningful on Overview, but rendered consistently
          so the layout doesn't jump when users tab around. */}
      {tab === 'overview' && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <div className="text-[10px] uppercase tracking-widest text-slate-500 mr-1">Range</div>
          {RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setRange(r.id)}
              className={`text-xs px-3 py-1.5 rounded-full border font-medium transition ${
                range === r.id
                  ? 'bg-brand-500 border-brand-500 text-white'
                  : 'bg-white border-slate-200 text-slate-700 hover:border-slate-400'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[200px_1fr] gap-5">
        {/* Left sub-nav (vertical pills) */}
        <nav className="card !p-2 h-fit sticky lg:top-4 self-start">
          <ul className="flex lg:flex-col gap-1">
            {TABS.map((t) => {
              const active = tab === t.id;
              return (
                <li key={t.id} className="flex-1 lg:flex-none">
                  <button
                    type="button"
                    onClick={() => setTab(t.id)}
                    className={`w-full text-left text-sm font-medium px-3 py-2 rounded-lg inline-flex items-center gap-2 transition ${
                      active
                        ? 'bg-brand-50 text-brand-700 border border-brand-200'
                        : 'text-slate-600 hover:bg-slate-50 border border-transparent'
                    }`}
                    aria-current={active ? 'page' : undefined}
                  >
                    <span className={active ? 'text-brand-600' : 'text-slate-400'}>{t.icon}</span>
                    <span className="truncate">{t.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Right content area — mount only the active tab so each tab's
            internal fetch + useState doesn't burn cycles in the background. */}
        <div className="min-w-0">
          {tab === 'overview' && <OverviewTab eventId={eventId} range={range} />}
          {tab === 'abandoned-carts' && <AbandonedTab eventId={eventId} eventName={eventName} />}
          {tab === 'cart-recovery' && <RecoveryTab eventId={eventId} />}
        </div>
      </div>
    </div>
  );
}

function IconChart() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 3v18h18"/>
      <path d="M7 14l4-4 4 3 5-6"/>
    </svg>
  );
}

function IconCart() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
      <path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6"/>
    </svg>
  );
}

function IconRecover() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 12a9 9 0 1 0 3-6.7"/>
      <path d="M3 4v5h5"/>
    </svg>
  );
}
