import { NextRequest, NextResponse } from 'next/server';
import { listTicketsForEvent, createTicket, type TicketCategory, type Gender } from '@/lib/tickets';
import { requireRole } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await requireRole(['host', 'manager', 'entry']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  const eventId = req.nextUrl.searchParams.get('eventId') || '';
  if (!eventId) {
    return NextResponse.json({ ok: false, message: 'eventId is required.' }, { status: 400 });
  }
  return NextResponse.json({ ok: true, tickets: listTicketsForEvent(eventId) });
}

export async function POST(req: NextRequest) {
  const session = await requireRole(['host', 'manager', 'entry']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }

  const body = await req.json().catch(() => ({}));
  try {
    const ticket = createTicket({
      eventId: String(body.eventId || ''),
      customerName: String(body.customerName || ''),
      customerPhone: String(body.customerPhone || ''),
      customerGender: (body.customerGender || null) as Gender | null,
      customerNotes: body.customerNotes ?? null,
      ticketName: String(body.ticketName || ''),
      category: body.category as TicketCategory,
      pax: Number(body.pax ?? 1),
      ticketNotes: body.ticketNotes ?? null,
      internalNotes: body.internalNotes ?? null,
      price: Number(body.price ?? 0),
      paidOffline: !!body.paidOffline,
      complimentary: !!body.complimentary,
      createdBy: session.name,
    });
    return NextResponse.json({ ok: true, ticket });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to create ticket.';
    return NextResponse.json({ ok: false, message: msg }, { status: 400 });
  }
}
