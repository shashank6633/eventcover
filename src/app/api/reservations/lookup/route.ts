import { NextRequest, NextResponse } from 'next/server';
import { searchReservations } from '@/lib/reservations';
import { requireRole } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/reservations/lookup?q=&phone=&eventId=
 *
 * Searches reservations by name (substring) or phone (exact + substring).
 * Used by the Issue Cover page so door staff can pull up a customer's
 * reservation details by mobile number OR name.
 *
 * Available to host/manager/entry/captain — anyone working the door needs
 * to look up reservations.
 */
export async function GET(req: NextRequest) {
  const session = await requireRole(['host', 'manager', 'entry', 'captain', 'cashier']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }

  const q = req.nextUrl.searchParams.get('q')?.trim() || '';
  const phone = req.nextUrl.searchParams.get('phone')?.trim() || '';
  const eventId = req.nextUrl.searchParams.get('eventId')?.trim() || '';

  if (!q && !phone) {
    return NextResponse.json({ ok: true, results: [] });
  }

  const results = searchReservations({
    query: q || undefined,
    phone: phone || undefined,
    eventId: eventId || undefined,
    limit: 20,
  });

  return NextResponse.json({ ok: true, results });
}
