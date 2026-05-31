import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import {
  assignEvent,
  deleteAffiliate,
  getAffiliate,
  getAffiliateByCode,
  getEventAffiliateLinks,
  unassignEvent,
  type CommissionType,
} from '@/lib/affiliates';
import { getEvent } from '@/lib/events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/events/[id]/promote/affiliate-links
 *   List commission affiliates assigned to this event with stats.
 *
 * POST /api/events/[id]/promote/affiliate-links { code, commissionType?, commissionValue? }
 *   Attach an EXISTING commission affiliate to this event. We don't let
 *   operators create whole new commission profiles from the Promote page —
 *   that's the /admin/affiliates surface. Optional override pair lets the
 *   operator set a per-event commission different from the affiliate default.
 *
 * DELETE /api/events/[id]/promote/affiliate-links?linkId=…&mode=unassign|delete
 *   mode='unassign' (default): drop the affiliate_event_assignments row only.
 *   mode='delete'             : hard-delete the affiliate. Refused if any
 *                               commissions / payouts exist — operator must
 *                               use the affiliates surface in that case.
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
  const links = getEventAffiliateLinks(eventId);
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
    code?: unknown;
    commissionType?: unknown;
    commissionValue?: unknown;
  };

  const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
  if (!code) {
    return NextResponse.json({ ok: false, message: 'code is required.' }, { status: 400 });
  }
  const aff = getAffiliateByCode(code);
  if (!aff) {
    return NextResponse.json(
      { ok: false, message: 'No active affiliate found with that code.' },
      { status: 404 },
    );
  }
  if (aff.kind !== 'commission') {
    return NextResponse.json(
      { ok: false, message: 'That code is a tracking link — use the Tracking tab.' },
      { status: 400 },
    );
  }

  const commissionType =
    body.commissionType === 'percent' || body.commissionType === 'flat'
      ? (body.commissionType as CommissionType)
      : null;
  const commissionValue =
    body.commissionValue === undefined ||
    body.commissionValue === null ||
    body.commissionValue === ''
      ? null
      : Number(body.commissionValue);

  try {
    assignEvent(aff.id, eventId, commissionType, commissionValue, session.name);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to attach affiliate.';
    return NextResponse.json({ ok: false, message: msg }, { status: 400 });
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
  const mode = req.nextUrl.searchParams.get('mode') || 'unassign';
  if (!linkId) {
    return NextResponse.json({ ok: false, message: 'linkId is required.' }, { status: 400 });
  }
  const existing = getAffiliate(linkId);
  if (!existing) {
    return NextResponse.json({ ok: false, message: 'not found' }, { status: 404 });
  }
  if (existing.kind !== 'commission') {
    return NextResponse.json(
      { ok: false, message: 'Use the tracking-links endpoint for tracking links.' },
      { status: 400 },
    );
  }

  if (mode === 'delete') {
    try {
      const ok = deleteAffiliate(linkId, session.name);
      if (!ok) return NextResponse.json({ ok: false, message: 'not found' }, { status: 404 });
      return NextResponse.json({ ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to delete affiliate.';
      return NextResponse.json({ ok: false, message: msg }, { status: 400 });
    }
  }

  // Default: unassign from this event only (keeps the affiliate intact).
  const removed = unassignEvent(linkId, eventId, session.name);
  if (!removed) {
    return NextResponse.json(
      { ok: false, message: 'Affiliate was not assigned to this event.' },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true });
}
