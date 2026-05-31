/**
 * POST /api/reservations/[id]/checkin
 *
 * Body: { count: number, notes?: string }
 *
 * Increments checked_in_pax for the reservation. The underlying lib call
 * wraps the read/validate/write in a single db.transaction() — two
 * simultaneous scans serialise and the second sees the updated counter,
 * rejecting any over-count attempt with a 409.
 *
 * Roles: entry (primary door-staff path), manager, host.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { checkInGuests } from '@/lib/reservation-checkin';
import { getReservationSummary } from '@/lib/reservation-ledger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface CheckinBody {
  // The scan UI ships `guests`; older curl recipes + manual probes use
  // `count`. We accept either — first non-empty wins — so existing tooling
  // doesn't break while the client stays on its preferred key.
  count?: unknown;
  guests?: unknown;
  notes?: unknown;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['host', 'manager', 'entry']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  const { id } = await ctx.params;

  const body = (await req.json().catch(() => ({}))) as CheckinBody;
  const raw = body.guests ?? body.count;
  const rawCount = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(rawCount) || rawCount <= 0) {
    return NextResponse.json(
      { ok: false, message: 'count must be a positive integer.' },
      { status: 400 },
    );
  }
  const notes = typeof body.notes === 'string' ? body.notes : null;
  const guestsCheckedIn = Math.floor(rawCount);

  const result = checkInGuests({
    reservationId: id,
    count: guestsCheckedIn,
    actor: session.name,
    notes,
  });

  if (!result.ok) {
    // 404 for missing; 409 for state-machine / overcount / cancel races.
    const status = result.reason === 'not_found' ? 404 : 409;
    return NextResponse.json({ ok: false, message: result.message, reason: result.reason }, { status });
  }

  const reservation = getReservationSummary(id);
  return NextResponse.json({
    ok: true,
    checkinId: result.checkinId,
    reservation,
    guests_checked_in: guestsCheckedIn,
  });
}
