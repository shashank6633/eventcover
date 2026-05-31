/**
 * GET /api/events/[id]/abandoned-carts?stage=…&minAge=…&limit=…
 *
 * Event-scoped wrapper around listAbandonedBookings. Mirrors the response
 * shape of /api/abandoned-bookings so the existing UI table can be reused.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { listEventAbandonedCarts } from '@/lib/event-analytics';
import { getDb } from '@/lib/db';
import type { AbandonStage } from '@/lib/abandoned-bookings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_STAGES: Array<AbandonStage | 'all'> = [
  'all', 'payment_created', 'payment_failed', 'reservation_only',
];

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }

  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ ok: false, message: 'Event id is required.' }, { status: 400 });
  }

  const db = getDb();
  const ev = db.prepare('SELECT id FROM events WHERE id = ?').get(id) as { id: string } | undefined;
  if (!ev) {
    return NextResponse.json({ ok: false, message: 'Event not found.' }, { status: 404 });
  }

  const { searchParams } = req.nextUrl;
  const stageRaw = searchParams.get('stage') ?? 'all';
  const minAge = Number(searchParams.get('minAge') ?? '60');
  const limit = Number(searchParams.get('limit') ?? '200');

  const stage = (VALID_STAGES.includes(stageRaw as AbandonStage) ? stageRaw : 'all') as AbandonStage | 'all';

  const items = listEventAbandonedCarts(id, {
    stage,
    minAgeMinutes: Number.isFinite(minAge) ? minAge : 60,
    limit: Number.isFinite(limit) ? limit : 200,
  });

  // Compute event-scoped counts in-process from the same list so the KPI
  // strip matches the table exactly.
  const counts = {
    total: items.length,
    paymentCreated: items.filter((b) => b.stage === 'payment_created').length,
    paymentFailed: items.filter((b) => b.stage === 'payment_failed').length,
    reservationOnly: items.filter((b) => b.stage === 'reservation_only').length,
    potentialRevenue: items.reduce((sum, b) => sum + b.amount, 0),
  };

  return NextResponse.json({ ok: true, items, counts });
}
