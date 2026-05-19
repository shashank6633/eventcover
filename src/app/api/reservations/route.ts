import { NextRequest, NextResponse } from 'next/server';
import {
  listReservationsForEvent,
  listAllReservations,
  createManualReservation,
} from '@/lib/reservations';
import { requireRole } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }

  const eventId = req.nextUrl.searchParams.get('eventId') || '';
  const reservations = eventId
    ? listReservationsForEvent(eventId)
    : listAllReservations();
  return NextResponse.json({ ok: true, reservations });
}

/**
 * POST creates a manual reservation. Used by the "Add reservation" form on
 * the admin Reservations page when an operator is taking the booking by
 * phone or in person.
 */
export async function POST(req: NextRequest) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }

  const body = await req.json().catch(() => ({}));
  try {
    const reservation = createManualReservation({
      eventDate: String(body.eventDate || ''),
      eventId: body.eventId ?? null,
      name: String(body.name || ''),
      phone: String(body.phone || ''),
      email: body.email ?? null,
      pax: Number(body.pax ?? 1),
      arrivalTime: body.arrivalTime ?? null,
      notes: body.notes ?? null,
      createdBy: session.name,
    });
    return NextResponse.json({ ok: true, reservation });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to create reservation.';
    return NextResponse.json({ ok: false, message: msg }, { status: 400 });
  }
}
