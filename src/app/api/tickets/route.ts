import { NextRequest, NextResponse } from 'next/server';
import { listTicketsForEvent, createTicket, getTicket, type TicketCategory, type Gender } from '@/lib/tickets';
import { attributeTicket } from '@/lib/affiliates';
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

    // ─── Affiliate attribution (best-effort) ──────────────────────────────
    // Source priority for the code:
    //   1. Explicit `affiliateCode` in the request body — set by the future
    //      public booking flow.
    //   2. `ec_ref` cookie — set by RefCapture when a customer visits any
    //      page with ?ref=CODE. Works automatically when a customer creates
    //      the booking from their own browser.
    // Never throws — failed attribution must not block ticket creation.
    const explicit = typeof body.affiliateCode === 'string' ? body.affiliateCode.trim() : '';
    const cookieRef = req.cookies.get('ec_ref')?.value || '';
    const affCode = explicit || cookieRef;
    if (affCode && !ticket.complimentary && ticket.price > 0) {
      attributeTicket({
        ticketId: ticket.id,
        affiliateCode: affCode,
        eventId: ticket.event_id,
        saleAmount: ticket.price,
        pax: ticket.pax,
      });
      const updated = getTicket(ticket.id);
      return NextResponse.json({ ok: true, ticket: updated ?? ticket });
    }

    return NextResponse.json({ ok: true, ticket });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to create ticket.';
    return NextResponse.json({ ok: false, message: msg }, { status: 400 });
  }
}
