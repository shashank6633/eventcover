import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import {
  listAbandonedBookings,
  getAbandonedCounts,
  type AbandonStage,
} from '@/lib/abandoned-bookings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/abandoned-bookings?stage=all|payment_created|payment_failed|reservation_only
 *                            &minAge=60&limit=200
 *
 * Manager/host only — lists customers who started a booking journey and
 * never finished, plus aggregate counts for the dashboard header.
 */
export async function GET(req: NextRequest) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }

  const { searchParams } = req.nextUrl;
  const stageRaw = searchParams.get('stage') ?? 'all';
  const minAge = Number(searchParams.get('minAge') ?? '60');
  const limit = Number(searchParams.get('limit') ?? '200');

  const validStages: Array<AbandonStage | 'all'> = [
    'all', 'payment_created', 'payment_failed', 'reservation_only',
  ];
  const stage = (validStages.includes(stageRaw as AbandonStage) ? stageRaw : 'all') as AbandonStage | 'all';

  const items = listAbandonedBookings({
    stage,
    minAgeMinutes: Number.isFinite(minAge) ? minAge : 60,
    limit: Number.isFinite(limit) ? limit : 200,
  });
  const counts = getAbandonedCounts(Number.isFinite(minAge) ? minAge : 60);

  return NextResponse.json({ ok: true, items, counts });
}
