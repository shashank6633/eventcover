'use client';

/**
 * Manage tab container.
 *
 * Owns:
 *   • Top bar (back arrow + event title + LIVE badge + Public-page link +
 *     small Insights deep-link)
 *   • 6-item left vertical sub-nav
 *   • URL-synced tab routing via ?tab=
 *   • Soft-block when event.status !== 'live' (the Manage feature only makes
 *     sense once an event is collecting bookings — pre-live there's nothing
 *     to manage)
 *
 * Each tab is its own client subcomponent so they fetch independently. Tabs
 * 1 (Bookings) and 2 (Check-In) are implemented in this workflow; tabs 3-6
 * are stubbed with a small placeholder until the other devs fill them in,
 * but the sidebar entries remain so the routing + URL deep-links keep
 * working end-to-end.
 */

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { BookingsTab } from './_tabs/BookingsTab';
import { CheckinTab } from './_tabs/CheckinTab';
import { PlaceholderTab } from './_tabs/PlaceholderTab';
import type { ManageTabId } from './page';

interface Props {
  eventId: string;
  eventName: string;
  eventStatus: string;
  eventDate: string;
  eventSlug: string | null;
  initialTab: ManageTabId;
}

interface TabMeta {
  id: ManageTabId;
  label: string;
  icon: React.ReactNode;
}

const TABS: TabMeta[] = [
  { id: 'bookings',   label: 'Bookings',                icon: <IconTicket /> },
  { id: 'checkin',    label: 'Check-In',                icon: <IconScan /> },
  { id: 'reminders',  label: 'Reminders',               icon: <IconBell /> },
  { id: 'post-sale',  label: 'Post Sale Communication', icon: <IconChat /> },
  { id: 'gallery',    label: 'Photo Gallery',           icon: <IconImage /> },
  { id: 'refundable', label: 'Refundable Entries',      icon: <IconAlert /> },
];

export function ManageShell({
  eventId, eventName, eventStatus, eventDate, eventSlug, initialTab,
}: Props) {
  const [tab, setTab] = useState<ManageTabId>(initialTab);

  // Reflect the active tab back into the URL without re-running the server
  // component / auth gate (same pattern as InsightsShell).
  const syncUrl = useCallback((nextTab: ManageTabId) => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    url.searchParams.set('tab', nextTab);
    window.history.replaceState(null, '', url.toString());
  }, []);

  useEffect(() => { syncUrl(tab); }, [tab, syncUrl]);

  const isLive = eventStatus === 'live';

  return (
    <div className="px-6 md:px-8 py-6 max-w-7xl mx-auto">
      {/* Top bar — back, title, LIVE badge, public link, Insights deep-link */}
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
        {isLive && (
          <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border font-semibold bg-emerald-50 text-emerald-700 border-emerald-200">
            Live
          </span>
        )}
        <span className="text-xs text-slate-500 hidden sm:inline">· {eventDate}</span>

        <div className="ml-auto flex items-center gap-3">
          {isLive && (
            <Link
              href={`/admin/events/${eventId}/insights`}
              className="inline-flex items-center gap-1 text-sm text-brand-600 hover:text-brand-700 font-medium"
              title="Open per-event analytics"
            >
              <span aria-hidden>📊</span> Insights
            </Link>
          )}
          {eventSlug && (
            <a
              href={`/event/${eventSlug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm text-brand-600 hover:text-brand-700 font-medium"
            >
              ↗ Public page
            </a>
          )}
        </div>
      </div>
      <p className="text-sm text-slate-500 mb-5">
        Manage bookings, check-ins, reminders, post-sale comms, recap photos, and refundable entries for this event.
      </p>

      {/* Soft block when the event is not live yet — the rest of the surface
          doesn't make sense pre-publication. A direct URL still lands here. */}
      {!isLive ? (
        <div className="card text-center py-10">
          <div className="text-3xl mb-2" aria-hidden>📋</div>
          <div className="text-base font-semibold text-slate-900">Manage is available once the event is live</div>
          <div className="text-sm text-slate-500 mt-1">
            Publish this event from the wizard to unlock bookings, check-ins, and post-sale tools.
          </div>
          <Link
            href={`/admin/events?edit=${eventId}`}
            className="btn btn-dark inline-flex items-center gap-2 mt-4"
          >
            Edit event
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-5">
          {/* Left sub-nav */}
          <nav className="card !p-2 h-fit sticky lg:top-4 self-start" aria-label="Manage sections">
            <ul className="flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible">
              {TABS.map((t) => {
                const active = tab === t.id;
                return (
                  <li key={t.id} className="flex-1 lg:flex-none">
                    <button
                      type="button"
                      onClick={() => setTab(t.id)}
                      className={`w-full text-left text-sm font-medium px-3 py-2 rounded-lg inline-flex items-center gap-2 transition whitespace-nowrap ${
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

          {/* Right content — mount only the active tab so background fetches
              don't pile up. Tabs 3-6 are placeholders until the other devs
              ship them; the routing + URL deep-linking already works. */}
          <div className="min-w-0">
            {tab === 'bookings'   && <BookingsTab eventId={eventId} eventSlug={eventSlug} />}
            {tab === 'checkin'    && <CheckinTab eventId={eventId} />}
            {tab === 'reminders'  && <PlaceholderTab title="Reminders" subtitle="WhatsApp reminders before the event." />}
            {tab === 'post-sale'  && <PlaceholderTab title="Post Sale Communication" subtitle="Auto-message buyers after a successful purchase." />}
            {tab === 'gallery'    && <PlaceholderTab title="Photo Gallery" subtitle="Post-event recap photos shared with attendees." />}
            {tab === 'refundable' && <PlaceholderTab title="Refundable Entries" subtitle="Accommodate or re-send tickets for bookings whose payment expired." />}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Icons ────────────────────────────────────────────────────────────────

function IconTicket() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a2 2 0 0 0 0-4z"/>
      <path d="M13 6v12"/>
    </svg>
  );
}

function IconScan() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 7V5a2 2 0 0 1 2-2h2"/>
      <path d="M21 7V5a2 2 0 0 0-2-2h-2"/>
      <path d="M3 17v2a2 2 0 0 0 2 2h2"/>
      <path d="M21 17v2a2 2 0 0 1-2 2h-2"/>
      <rect x="8" y="8" width="3" height="3"/>
      <rect x="13" y="8" width="3" height="3"/>
      <rect x="8" y="13" width="3" height="3"/>
      <path d="M13 13h3v3"/>
    </svg>
  );
}

function IconBell() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/>
      <path d="M13.7 21a2 2 0 0 1-3.4 0"/>
    </svg>
  );
}

function IconChat() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
  );
}

function IconImage() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <circle cx="8.5" cy="8.5" r="1.5"/>
      <path d="M21 15l-5-5L5 21"/>
    </svg>
  );
}

function IconAlert() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M10.3 3.86a2 2 0 0 1 3.4 0l8 14A2 2 0 0 1 20 21H4a2 2 0 0 1-1.7-3z"/>
      <path d="M12 9v4M12 17h.01"/>
    </svg>
  );
}
