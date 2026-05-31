import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import {
  createTrackingLink,
  deleteAffiliate,
  getAffiliate,
  getEventTrackingLinks,
} from '@/lib/affiliates';
import { getEvent } from '@/lib/events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/events/[id]/promote/tracking-links
 *   List tracking-link affiliates assigned to this event, each with
 *   live promote stats (clicks / sales / revenue / conversion / last sale).
 *
 * POST /api/events/[id]/promote/tracking-links { name, notes? }
 *   Create a tracking-link affiliate (kind='tracking', commission_value=0)
 *   and assign it to this event. Name is the slugified short code surfaced
 *   in the ?t= URL param. 409 on duplicate name within the event.
 *
 * DELETE /api/events/[id]/promote/tracking-links?linkId=…
 *   Hard-delete a tracking link. Cascades to clicks + assignments.
 *   Refuses if linkId doesn't actually belong to a tracking link (defense
 *   against accidental commission-affiliate deletion via this endpoint).
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json(
      { ok: false, message: session.message },
      { status: session.status },
    );
  }
  const { id: eventId } = await ctx.params;
  if (!getEvent(eventId)) {
    return NextResponse.json({ ok: false, message: 'Event not found.' }, { status: 404 });
  }
  const links = getEventTrackingLinks(eventId);
  return NextResponse.json({ ok: true, links });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json(
      { ok: false, message: session.message },
      { status: session.status },
    );
  }
  const { id: eventId } = await ctx.params;
  if (!getEvent(eventId)) {
    return NextResponse.json({ ok: false, message: 'Event not found.' }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    name?: unknown;
    notes?: unknown;
  };

  try {
    const link = createTrackingLink({
      eventId,
      name: String(body.name ?? '').trim(),
      notes: typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null,
      createdBy: session.name,
    });
    return NextResponse.json({ ok: true, link });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to create tracking link.';
    const status =
      (err as Error & { status?: number })?.status === 409 ? 409 : 400;
    return NextResponse.json({ ok: false, message: msg }, { status });
  }
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json(
      { ok: false, message: session.message },
      { status: session.status },
    );
  }
  const { id: eventId } = await ctx.params;
  if (!getEvent(eventId)) {
    return NextResponse.json({ ok: false, message: 'Event not found.' }, { status: 404 });
  }

  const linkId = req.nextUrl.searchParams.get('linkId') || '';
  if (!linkId) {
    return NextResponse.json({ ok: false, message: 'linkId is required.' }, { status: 400 });
  }
  const existing = getAffiliate(linkId);
  if (!existing) {
    return NextResponse.json({ ok: false, message: 'not found' }, { status: 404 });
  }
  if (existing.kind !== 'tracking') {
    return NextResponse.json(
      { ok: false, message: 'Use the affiliate-links endpoint for commission affiliates.' },
      { status: 400 },
    );
  }
  const ok = deleteAffiliate(linkId, session.name);
  if (!ok) return NextResponse.json({ ok: false, message: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
