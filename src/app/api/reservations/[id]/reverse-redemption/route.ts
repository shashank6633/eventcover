/**
 * POST /api/reservations/[id]/reverse-redemption
 *
 * Body: { redemptionId: string, reason?: string }
 *
 * Marks a previously-recorded cover redemption as reversed and credits the
 * amount back to the reservation's cover_redeemed running total. The
 * reversed row drops out of the partial unique index on bill_id, so a
 * corrected bill (same bill_id) can be re-billed afterwards.
 *
 * Manager / host only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { reverseRedemption } from '@/lib/cover-redemption';
import { getReservationSummary } from '@/lib/reservation-ledger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ReverseBody {
  redemptionId?: unknown;
  reason?: unknown;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  const { id } = await ctx.params;

  const body = (await req.json().catch(() => ({}))) as ReverseBody;
  const redemptionId = typeof body.redemptionId === 'string' ? body.redemptionId.trim() : '';
  if (!redemptionId) {
    return NextResponse.json({ ok: false, message: 'redemptionId is required.' }, { status: 400 });
  }
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!reason) {
    return NextResponse.json(
      { ok: false, message: 'Reason required for audit trail.' },
      { status: 400 },
    );
  }

  const result = reverseRedemption({
    redemptionId,
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
    newRedeemed: result.newRedeemed,
    newBalance: result.newBalance,
    coverStatus: result.coverStatus,
  });
}
