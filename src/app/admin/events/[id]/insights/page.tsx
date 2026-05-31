/**
 * Per-event Insights page.
 *
 * Server component that:
 *   • Auth-gates host/manager only
 *   • Loads the event by id so we can show the title / public link / LIVE badge
 *     in the page top-bar without paying a client-fetch round-trip
 *   • Renders the InsightsShell which owns the tab routing + data fetching
 *
 * The AdminShell wraps automatically via /admin/layout.tsx — do not wrap again.
 */

import { redirect, notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { getEvent } from '@/lib/events';
import { InsightsShell } from './InsightsShell';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; range?: string }>;
}

export default async function InsightsPage({ params, searchParams }: PageProps) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    redirect('/admin');
  }

  const { id } = await params;
  const sp = await searchParams;
  const event = getEvent(id);
  if (!event) notFound();

  return (
    <InsightsShell
      eventId={event.id}
      eventName={event.name}
      eventStatus={event.status}
      eventSlug={event.slug}
      initialTab={(sp.tab as 'overview' | 'abandoned-carts' | 'cart-recovery') || 'overview'}
      initialRange={(sp.range as '7d' | '14d' | '30d' | '90d') || '30d'}
    />
  );
}
