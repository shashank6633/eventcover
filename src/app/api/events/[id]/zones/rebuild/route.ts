/**
 * /api/events/[id]/zones/rebuild — admin escape hatch.
 *
 * Recomputes event_zones.sold_count from the sum of
 * reservations.zone_pax_count where status NOT IN ('cancelled','no_show').
 * Use when the denormalized counter drifts (rare — should only happen if
 * a verify path was bypassed manually).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getEvent } from '@/lib/events';
import { requireRole } from '@/lib/auth';
import { rebuildSoldCountFromReservations, listZones } from '@/lib/seating-layout';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  const { id } = await ctx.params;
  const event = getEvent(id);
  if (!event) return NextResponse.json({ ok: false, message: 'event not found' }, { status: 404 });

  const result = rebuildSoldCountFromReservations(id, session.name);
  return NextResponse.json({ ok: true, updated: result.updated, zones: listZones(id) });
}
