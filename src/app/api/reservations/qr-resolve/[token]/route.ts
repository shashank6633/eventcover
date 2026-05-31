/**
 * GET /api/reservations/qr-resolve/[token]
 *
 * Scanner endpoint. Door / captain devices decode the QR off the customer
 * phone, then hit this endpoint with the token. We verify the HMAC and
 * return the reservation summary + the set of allowed actions for the
 * caller's role so the client can render the right next-step UI.
 *
 * Roles: entry, captain, manager, host. Cashier explicitly NOT included
 * — cashier owns wallet settlement, not reservation ledger mutations.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { verifyReservationQrToken } from '@/lib/signed-url';
import { getReservationSummary } from '@/lib/reservation-ledger';
import type { UserRole } from '@/lib/roles';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function allowedActionsFor(role: UserRole): { canCheckin: boolean; canRedeem: boolean; canReverse: boolean; canClose: boolean } {
  switch (role) {
    case 'host':
    case 'manager':
      return { canCheckin: true, canRedeem: true, canReverse: true, canClose: true };
    case 'entry':
      return { canCheckin: true, canRedeem: false, canReverse: false, canClose: false };
    case 'captain':
      return { canCheckin: false, canRedeem: true, canReverse: false, canClose: false };
    default:
      return { canCheckin: false, canRedeem: false, canReverse: false, canClose: false };
  }
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const session = await requireRole(['host', 'manager', 'captain', 'entry']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  const { token } = await ctx.params;
  const payload = verifyReservationQrToken(decodeURIComponent(token));
  if (!payload) {
    return NextResponse.json(
      { ok: false, message: 'Invalid or expired QR.' },
      { status: 400 },
    );
  }
  const summary = getReservationSummary(payload.reservationId);
  if (!summary) {
    return NextResponse.json(
      { ok: false, message: 'Reservation not found.' },
      { status: 404 },
    );
  }
  // reservation_id already lives inside `summary` after the snake_case
  // contract change — drop the redundant top-level key. allowedActions +
  // role stay top-level because they're a property of the caller's session,
  // not the reservation row.
  return NextResponse.json({
    ok: true,
    reservation: summary,
    allowedActions: allowedActionsFor(session.role),
    role: session.role,
  });
}
