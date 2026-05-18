import { NextRequest, NextResponse } from 'next/server';
import { listReservationsForEvent } from '@/lib/reservations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const eventId = req.nextUrl.searchParams.get('eventId') || '';
  if (!eventId) return NextResponse.json({ ok: false, message: 'eventId required' }, { status: 400 });
  const reservations = listReservationsForEvent(eventId);
  return NextResponse.json({ ok: true, reservations });
}
