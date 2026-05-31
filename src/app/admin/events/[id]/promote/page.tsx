/**
 * Per-event Promote page.
 *
 * Two tabs:
 *   • Tracking Links — commission-free channel-attribution URLs (?t=…).
 *     Operators create as many as they need (e.g. instagram, story1, whatsapp)
 *     to see which channel actually drives ticket sales for THIS event.
 *   • Affiliate Links — existing commission affiliates attached to the event.
 *     Adding here just wires up an affiliate_event_assignments row; the
 *     affiliate itself is created on the global /admin/affiliates surface.
 *
 * Both tabs surface live stats: clicks, sales (issued tickets), revenue,
 * conversion %, last-sale timestamp. Same attribution funnel — RefCapture
 * accepts ?t= and ?ref= equivalently, last touch wins.
 *
 * AdminShell wraps automatically via /admin/layout.tsx.
 */

import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { getEvent } from '@/lib/events';
import { PromoteShell } from './PromoteShell';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}

export default async function PromotePage({ params, searchParams }: PageProps) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) redirect('/admin');

  const { id } = await params;
  const sp = await searchParams;
  const event = getEvent(id);
  if (!event) notFound();

  const initialTab: PromoteTabId = sp.tab === 'affiliate' ? 'affiliate' : 'tracking';

  return (
    <div className="px-6 md:px-8 py-6 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center gap-3 mb-2">
        <Link
          href="/admin"
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 transition"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back
        </Link>
        <h1 className="text-2xl font-bold text-slate-900 truncate">{event.name}</h1>
        {event.status === 'live' && (
          <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border font-semibold bg-emerald-50 text-emerald-700 border-emerald-200">
            Live
          </span>
        )}
        <span className="text-xs text-slate-500 hidden sm:inline">· {event.event_date}</span>

        <div className="ml-auto flex items-center gap-3">
          {event.slug && (
            <a
              href={`/event/${event.slug}`}
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
        Channel attribution + commission affiliates for this event. Tracking links share the same
        cookie slot as commission affiliates — last-touch wins.
      </p>

      <PromoteShell
        eventId={event.id}
        eventSlug={event.slug}
        initialTab={initialTab}
      />
    </div>
  );
}

export type PromoteTabId = 'tracking' | 'affiliate';
