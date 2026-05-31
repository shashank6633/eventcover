/**
 * Per-event Manage page (Growezzy-style).
 *
 * Server component that:
 *   • Auth-gates host / manager only (captain / entry never need Manage)
 *   • Loads the event by id so we can show the title / LIVE badge / public-page
 *     link in the page top-bar without a client round-trip
 *   • Renders the ManageShell which owns the 6-tab routing + per-tab data fetch
 *
 * AdminShell wraps automatically via /admin/layout.tsx — do not wrap again.
 *
 * The Manage entry point on /admin (events list) is only shown when
 * event.status === 'live'. We still render the page for non-live events so a
 * direct URL doesn't 404; the shell shows a soft notice instead of the tabs.
 */

import { redirect, notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { getEvent } from '@/lib/events';
import { ManageShell } from './ManageShell';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}

export default async function ManagePage({ params, searchParams }: PageProps) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    redirect('/admin');
  }

  const { id } = await params;
  const sp = await searchParams;
  const event = getEvent(id);
  if (!event) notFound();

  return (
    <ManageShell
      eventId={event.id}
      eventName={event.name}
      eventStatus={event.status}
      eventDate={event.event_date}
      eventSlug={event.slug}
      initialTab={(sp.tab as ManageTabId) || 'bookings'}
    />
  );
}

// Exported so the shell + sub-tabs share a single source of truth for the
// 6 tab IDs. Other devs filling in tabs 3-6 will import this.
export type ManageTabId =
  | 'bookings'
  | 'checkin'
  | 'reminders'
  | 'post-sale'
  | 'gallery'
  | 'refundable';
