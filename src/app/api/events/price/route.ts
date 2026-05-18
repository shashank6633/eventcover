import { NextRequest, NextResponse } from 'next/server';
import { getEvent, priceEntry } from '@/lib/events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const eventId = req.nextUrl.searchParams.get('eventId') || '';
  const pax = Number(req.nextUrl.searchParams.get('pax') || '1');
  if (!eventId) return NextResponse.json({ ok: false, message: 'eventId required' }, { status: 400 });
  if (!(pax >= 1)) return NextResponse.json({ ok: false, message: 'pax must be >= 1' }, { status: 400 });

  const event = getEvent(eventId);
  if (!event) return NextResponse.json({ ok: false, message: 'event not found' }, { status: 404 });

  const result = priceEntry(event, pax);
  return NextResponse.json({
    ok: true,
    eventId: event.id,
    eventName: event.name,
    eventDate: event.event_date,
    coverPolicy: event.cover_policy,
    ...result,
  });
}
