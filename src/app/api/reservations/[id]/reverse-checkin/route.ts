/**
 * POST /api/reservations/[id]/reverse-checkin
 *
 * Body: { checkinId: string, reason?: string }
 *
 * Marks a previously-recorded check-in as reversed and decrements the
 * reservation's checked_in_pax counter. Manager / host only — this is an
 * audit-bearing correction action, not a door-staff path.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { reverseCheckin } from '@/lib/reservation-checkin';
import { getReservationSummary } from '@/lib/reservation-ledger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ReverseBody {
  checkinId?: unknown;
  reason?: unknown;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  const { id } = await ctx.params;

  const body = (await req.json().catch(() => ({}))) as ReverseBody;
  const checkinId = typeof body.checkinId === 'string' ? body.checkinId.trim() : '';
  if (!checkinId) {
    return NextResponse.json({ ok: false, message: 'checkinId is required.' }, { status: 400 });
  }
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!reason) {
    return NextResponse.json(
      { ok: false, message: 'Reason required for audit trail.' },
      { status: 400 },
    );
  }

  const result = reverseCheckin({
    checkinId,
    reservationId: id,
    actor: session.name,
    reason,
  });

  if (!result.ok) {
    const status = result.reason === 'not_found' ? 404 : 409;
    return NextResponse.json({ ok: false, message: result.message, reason: result.reason }, { status });
  }

  const reservation = getReservationSummary(id);
  return NextResponse.json({
    ok: true,
    reservation,
    newCheckedInPax: result.newCheckedInPax,
    reservationStatus: result.reservationStatus,
  });
}
