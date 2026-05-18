import { NextRequest, NextResponse } from 'next/server';
import { calculateForEvent, type BookingLineInput } from '@/lib/bookings';
import { requireRole } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Live-preview endpoint — runs the pricing engine WITHOUT persisting anything.
 * Used by the booking form to show running totals as the user types.
 *
 * Body: { eventId, lines: BookingLineInput[] }
 * Returns the same shape as createBooking's internal total, so the UI can render
 * per-line breakdowns + final amount + validation errors live.
 */
export async function POST(req: NextRequest) {
  const session = await requireRole(['host', 'manager', 'entry']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }

  const body = await req.json().catch(() => ({}));
  try {
    const result = calculateForEvent(
      String(body.eventId || ''),
      (Array.isArray(body.lines) ? body.lines : []) as BookingLineInput[],
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Calculation failed.';
    return NextResponse.json({ ok: false, message: msg }, { status: 400 });
  }
}
