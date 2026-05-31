import { NextRequest, NextResponse } from 'next/server';
import {
  listEvents, createEvent,
  type CoverPolicy, type EventStatus,
} from '@/lib/events';
import type { TicketDesign } from '@/lib/ticket-design';
import type { FieldDef } from '@/lib/rsvp-fields';
import { validatePaxRules, validateBookingTypes } from '@/lib/events-validators';
import { requireRole } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_POLICIES: CoverPolicy[] = ['equal', 'fixed', 'percent'];
const VALID_STATUSES: EventStatus[] = ['draft', 'live', 'closed'];

export async function GET() {
  return NextResponse.json({ ok: true, events: listEvents() });
}

export async function POST(req: NextRequest) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }

  const body = await req.json();

  if (!body?.name || typeof body.name !== 'string' || !body.name.trim()) {
    return NextResponse.json({ ok: false, message: 'Event title is required.' }, { status: 400 });
  }
  if (!body?.event_date || !/^\d{4}-\d{2}-\d{2}$/.test(body.event_date)) {
    return NextResponse.json({ ok: false, message: 'event_date must be YYYY-MM-DD.' }, { status: 400 });
  }

  const baseFee = Number(body.base_entry_fee ?? 0);
  if (!(baseFee >= 0)) {
    return NextResponse.json({ ok: false, message: 'base_entry_fee must be non-negative.' }, { status: 400 });
  }

  const paxRules = validatePaxRules(body.pax_rules);
  if (paxRules instanceof Error) {
    return NextResponse.json({ ok: false, message: paxRules.message }, { status: 400 });
  }

  const bookingTypes = validateBookingTypes(body.booking_types);
  if (bookingTypes instanceof Error) {
    return NextResponse.json({ ok: false, message: bookingTypes.message }, { status: 400 });
  }

  const policy: CoverPolicy = VALID_POLICIES.includes(body.cover_policy) ? body.cover_policy : 'equal';
  const status: EventStatus = VALID_STATUSES.includes(body.status) ? body.status : 'draft';

  const event = createEvent({
    name: body.name,
    event_date: body.event_date,
    base_entry_fee: baseFee,
    cover_policy: policy,
    cover_value: Number(body.cover_value ?? 100),
    pax_rules: paxRules,
    cutoff_hour: Number(body.cutoff_hour ?? 2),
    notes: body.notes ?? null,
    status,

    description: body.description ?? null,
    image_data: body.image_data ?? null,
    card_image: body.card_image ?? null,
    start_time: body.start_time ?? null,
    is_public: body.is_public !== false,
    venue_id: body.venue_id ?? null,
    artist_ids: Array.isArray(body.artist_ids) ? body.artist_ids.map((x: unknown) => String(x)) : [],
    genre: body.genre ?? null,
    tags: Array.isArray(body.tags) ? body.tags.map((x: unknown) => String(x)) : [],
    terms: body.terms ?? null,
    faqs: body.faqs ?? null,
    booking_types: bookingTypes,
    messages_config: body.messages_config ?? {},

    // Optional. Backend auto-generates slug from name+date if blank,
    // and uses venue-wide META_PIXEL_ID if meta_pixel_id is blank.
    slug: typeof body.slug === 'string' ? body.slug : null,
    meta_pixel_id: typeof body.meta_pixel_id === 'string' ? body.meta_pixel_id : null,
    refund_policy: typeof body.refund_policy === 'string' ? body.refund_policy : null,
    one_line_summary: typeof body.one_line_summary === 'string' ? body.one_line_summary : null,

    // Phase 4 — pass through ticket_design + rsvp_fields if the wizard sends
    // them on initial create. createEvent() runs both through their respective
    // parsers (parseTicketDesign / parseRsvpFields) so unknown fields, junk
    // hex colors, and malformed entries are all dropped before write.
    ticket_design:
      body.ticket_design && typeof body.ticket_design === 'object' && !Array.isArray(body.ticket_design)
        ? (body.ticket_design as Partial<TicketDesign>)
        : null,
    rsvp_fields: Array.isArray(body.rsvp_fields) ? (body.rsvp_fields as FieldDef[]) : null,

    // ─── Per-event Settings — fee payer + inquiry phone + GST toggle ──────
    // All optional on create; createEvent() falls back to safe defaults
    // ('host' / NULL / 0) when omitted. Enum gates prevent garbage from
    // reaching the DB write path.
    inquiry_phone: typeof body.inquiry_phone === 'string' ? body.inquiry_phone : null,
    payment_gateway_fee_payer:
      body.payment_gateway_fee_payer === 'customer' || body.payment_gateway_fee_payer === 'host'
        ? body.payment_gateway_fee_payer
        : undefined,
    platform_fee_payer:
      body.platform_fee_payer === 'customer' || body.platform_fee_payer === 'host'
        ? body.platform_fee_payer
        : undefined,
    gst_enabled: 'gst_enabled' in body ? !!body.gst_enabled : undefined,
  });

  return NextResponse.json({ ok: true, event });
}

