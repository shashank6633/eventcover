import { NextRequest, NextResponse } from 'next/server';
import {
  getAffiliate,
  getAffiliateEventBreakdown,
  getAffiliateStats,
  listTicketsForAffiliateEvent,
} from '@/lib/affiliates';
import { requireRole } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/affiliates/[id]/breakdown
 *   → per-event breakdown rows + overall stats
 *
 * GET /api/affiliates/[id]/breakdown?eventId=...
 *   → ticket-level drill-down for one (affiliate, event) pair
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  const { id } = await params;
  const aff = getAffiliate(id);
  if (!aff) return NextResponse.json({ ok: false, message: 'Not found.' }, { status: 404 });

  const eventId = req.nextUrl.searchParams.get('eventId');
  if (eventId) {
    return NextResponse.json({
      ok: true,
      affiliate: aff,
      tickets: listTicketsForAffiliateEvent(id, eventId),
    });
  }

  return NextResponse.json({
    ok: true,
    affiliate: aff,
    overall: getAffiliateStats(id),
    events: getAffiliateEventBreakdown(id),
  });
}
