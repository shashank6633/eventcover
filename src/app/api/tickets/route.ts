import { NextRequest, NextResponse } from 'next/server';
import { listTicketsForEvent, createTicket, getTicket, type TicketCategory, type Gender } from '@/lib/tickets';
import { attributeTicket } from '@/lib/affiliates';
import { requireRole } from '@/lib/auth';
import { getEvent } from '@/lib/events';
import {
  getEffectivePixelId,
  getCapiAccessToken,
  hashSha256Lowercase,
  normalizePhoneForCapi,
  sendCapiEvent,
} from '@/lib/meta-pixel';

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
    //      page with ?ref=CODE or ?t=CODE. The latter is the per-event
    //      Tracking Link form surfaced by the Promote tab. Both URL forms
    //      resolve to the same cookie/affiliate-row lookup — the kind of
    //      link is determined by affiliate.kind on the resolved row.
    // attributeTicket() handles both kinds: kind='commission' opens an
    // affiliate_commissions row and stamps tickets.commission_status=
    // 'pending'; kind='tracking' (commission_value=0) only stamps
    // tickets.affiliate_id / affiliate_code with commission_status='none',
    // so the per-event Promote page can count clicks→sales without
    // polluting the payouts pipeline.
    // Never throws — failed attribution must not block ticket creation.
    const explicit = typeof body.affiliateCode === 'string' ? body.affiliateCode.trim() : '';
    const cookieRef = req.cookies.get('ec_ref')?.value || '';
    const affCode = explicit || cookieRef;
    let finalTicket = ticket;
    if (affCode && !ticket.complimentary && ticket.price > 0) {
      attributeTicket({
        ticketId: ticket.id,
        affiliateCode: affCode,
        eventId: ticket.event_id,
        saleAmount: ticket.price,
        pax: ticket.pax,
      });
      finalTicket = getTicket(ticket.id) ?? ticket;
    }

    // ─── Meta CAPI Purchase (fire-and-forget) ─────────────────────────────
    // Only fires when the customer's browser came in with FB cookies AND
    // CAPI is fully configured. The browser Pixel snippet may also be
    // sending its own Purchase — we pass ticket.id as event_id so Meta
    // can dedupe the pair.
    const fbp = req.cookies.get('_fbp')?.value;
    const fbc = req.cookies.get('_fbc')?.value;
    if ((fbp || fbc) && !ticket.complimentary && ticket.price > 0) {
      const accessToken = getCapiAccessToken();
      if (accessToken) {
        const event = getEvent(ticket.event_id);
        const pixelId = getEffectivePixelId(event?.meta_pixel_id);
        if (pixelId) {
          const fwd = req.headers.get('x-forwarded-for') || '';
          const clientIp = fwd.split(',')[0]?.trim() || req.headers.get('x-real-ip') || undefined;
          const userAgent = req.headers.get('user-agent') || undefined;
          const phoneHash = hashSha256Lowercase(normalizePhoneForCapi(ticket.customer_phone));

          sendCapiEvent({
            pixelId,
            accessToken,
            eventName: 'Purchase',
            eventId: ticket.id,  // matches browser-side event_id for dedup
            actionSource: 'website',
            userData: {
              ph: [phoneHash],
              fbp: fbp || undefined,
              fbc: fbc || undefined,
              client_ip_address: clientIp,
              client_user_agent: userAgent,
            },
            customData: {
              value: ticket.price,
              currency: 'INR',
              content_name: event?.name || ticket.ticket_name,
              content_ids: [ticket.id],
              num_items: ticket.pax,
            },
          }).catch(() => { /* never block ticket response on Meta */ });
        }
      }
    }

    return NextResponse.json({ ok: true, ticket: finalTicket });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to create ticket.';
    return NextResponse.json({ ok: false, message: msg }, { status: 400 });
  }
}
