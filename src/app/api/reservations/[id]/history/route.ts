/**
 * GET /api/reservations/[id]/history
 *
 * Full audit trail for a reservation: every check-in row + every redemption
 * row, including reversed entries. Used by the manager/host reservation
 * detail page to render the ledger timeline.
 *
 * Roles: manager, host. Captains and entry staff don't need the full
 * history — their scan flows only show the current summary.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { getReservationLedger } from '@/lib/reservation-ledger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  const { id } = await ctx.params;
  const ledger = getReservationLedger(id);
  if (!ledger) {
    return NextResponse.json({ ok: false, message: 'Reservation not found.' }, { status: 404 });
  }
  // The ledger already carries `checkins` + `redemptions` inside it. We
  // also surface them at the top level so older client builds (which read
  // `d.checkins` / `d.redemptions` directly) keep working during deploy.
  return NextResponse.json({
    ok: true,
    reservation: ledger,
    checkins: ledger.checkins,
    redemptions: ledger.redemptions,
  });
}
