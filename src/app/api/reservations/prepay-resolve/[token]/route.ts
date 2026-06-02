/**
 * GET /api/reservations/prepay-resolve/[token]
 *
 * PUBLIC endpoint — no session auth. Access is gated by the HMAC-signed
 * prepay token baked into the URL. Powers the /p/[token] landing page:
 *   - Verifies the token's HMAC + purpose + expiry
 *   - Checks the token matches the row's current payment_link_token
 *     (so an old/revoked link returns 410 even with a valid signature)
 *   - Returns the reservation + event context the prepay form needs
 *
 * Why also check payment_link_token equality?
 * The token itself is HMAC-valid for 7 days. But the host might have sent
 * a fresh link to extend the TTL or invalidate a leaked one — in either
 * case we want the OLD token to stop working immediately, not silently
 * point at the same reservation. The row stores the LATEST issued token;
 * any other signature-valid payload is a stale link.
 *
 * Response shape mirrors /api/events/by-slug/[slug]/public so the prepay
 * page can share components (PublicBookingForm, EventAnalyticsTracker)
 * with the regular booking page.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyReservationPrepayToken } from '@/lib/signed-url';
import { getReservation } from '@/lib/reservations';
import { getEvent } from '@/lib/events';
import { getConfig } from '@/lib/db';
import { getPhasePricesForBooking } from '@/lib/ticket-phases';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function clampPercent(v: number): number {
  if (!Number.isFinite(v) || v < 0) return 0;
  return Math.min(100, v);
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const decoded = decodeURIComponent(token);

  // Step 1 — verify the HMAC + purpose + expiry. Returns null on any fail.
  const payload = verifyReservationPrepayToken(decoded);
  if (!payload) {
    return NextResponse.json(
      { ok: false, message: 'This payment link is invalid or has expired.' },
      { status: 404 },
    );
  }

  // Step 2 — load the reservation row.
  const reservation = getReservation(payload.reservationId);
  if (!reservation) {
    return NextResponse.json(
      { ok: false, message: 'Reservation not found.' },
      { status: 404 },
    );
  }

  // Step 3 — guard rails on the row state.
  if (reservation.status === 'cancelled') {
    return NextResponse.json(
      { ok: false, message: 'This reservation has been cancelled. Please contact the venue.' },
      { status: 410 },
    );
  }
  if (reservation.status === 'converted') {
    // Already paid — render a friendly state on the landing page rather
    // than throwing. The page UI uses `paid: true` to switch into the
    // "thank-you / your wallet" view.
    return NextResponse.json({
      ok: true,
      paid: true,
      reservation: projectReservation(reservation),
    });
  }

  // Step 4 — token must match the latest issued one. Without this, an old
  // link a guest copied yesterday would still work even after the host
  // sent a fresh one (intentionally invalidating the previous URL).
  const rowToken = (reservation as unknown as { payment_link_token?: string | null }).payment_link_token;
  if (!rowToken || rowToken !== decoded) {
    return NextResponse.json(
      { ok: false, message: 'This payment link has been replaced by a newer one. Please use the latest link from the venue.' },
      { status: 410 },
    );
  }

  // Step 5 — load the linked event so the prepay form can render cover
  // rates + phase pricing + fee structure. Reservego rows may not be
  // linked to an event yet (event_date is set but event_id is NULL until
  // the host creates the matching event); we surface that as a clean error.
  if (!reservation.event_id) {
    return NextResponse.json(
      {
        ok: false,
        message: 'No event is linked to this reservation yet. Please contact the venue.',
      },
      { status: 409 },
    );
  }
  const event = getEvent(reservation.event_id);
  if (!event) {
    return NextResponse.json(
      { ok: false, message: 'Event not found.' },
      { status: 404 },
    );
  }
  if (event.status === 'closed') {
    return NextResponse.json(
      { ok: false, message: 'This event has already ended.' },
      { status: 410 },
    );
  }

  // Step 6 — shape the response. Pull the same payer / GST / phase config
  // the /by-slug/[slug]/public endpoint exposes so the prepay form shares
  // its computation. coverRates is in non-secret-platform-constants
  // territory (every patron sees the rates at the door) — safe to leak.
  const eventRow = event as unknown as {
    cover_male_stag?: number;
    cover_female_stag?: number;
    cover_couple?: number;
    entry_fee_per_person?: number;
    payment_gateway_fee_payer?: string;
    platform_fee_payer?: string;
    gst_enabled?: number | boolean;
    gst_percent?: number;
    discount_percent?: number;
    payment_mode?: string;
    deposit_amount?: number;
  };
  const gatewayPct = clampPercent(Number(getConfig('PAYMENT_GATEWAY_FEE_PCT', '2')) || 0);
  const platformPct = clampPercent(Number(getConfig('PLATFORM_FEE_PCT', '0')) || 0);
  const phaseBooking = getPhasePricesForBooking(event.id);
  const activePhase = phaseBooking.phase
    ? {
        id: phaseBooking.phase.id,
        name: phaseBooking.phase.name,
        ends_at: phaseBooking.phase.ends_at,
        ends_on_sellout: phaseBooking.phase.ends_on_sellout,
      }
    : null;

  return NextResponse.json({
    ok: true,
    paid: false,
    reservation: projectReservation(reservation),
    event: {
      id: event.id,
      slug: event.slug,
      name: event.name,
      event_date: event.event_date,
      start_time: event.start_time,
      description: event.description,
      image_data: event.image_data,
      genre: event.genre,
    },
    paymentMode: (eventRow.payment_mode || 'full_cover') as 'none' | 'deposit' | 'full_cover',
    paymentAmount: Number(eventRow.entry_fee_per_person) || 0,
    paymentGatewayFeePayer: eventRow.payment_gateway_fee_payer === 'customer' ? 'customer' : 'host',
    platformFeePayer: eventRow.platform_fee_payer === 'customer' ? 'customer' : 'host',
    gstEnabled: !!eventRow.gst_enabled,
    paymentGatewayFeePct: gatewayPct,
    platformFeePct: platformPct,
    gstPercent: clampPercent(Number(eventRow.gst_percent) || 0),
    discountPercent: clampPercent(Number(eventRow.discount_percent) || 0),
    coverRates: {
      male_stag: Number(eventRow.cover_male_stag) || 0,
      female_stag: Number(eventRow.cover_female_stag) || 0,
      couple: Number(eventRow.cover_couple) || 0,
    },
    entryFeePerPerson: Number(eventRow.entry_fee_per_person) || 0,
    activePhase,
    phasePrices: phaseBooking.prices.map((p) => ({
      id: p.id, scope: p.scope, scope_id: p.scope_id,
      price: p.price, inventory: p.inventory, sold: p.sold,
    })),
  });
}

/**
 * Strip the reservation row down to what the landing page actually needs.
 * Keeps the wire payload small + hides operator-internal columns (audit
 * raw payload, internal notes, etc.). The customer sees their own name +
 * phone + pax — nothing else.
 */
function projectReservation(r: {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  pax: number;
  event_id: string | null;
  event_date: string | null;
  arrival_time: string | null;
  tables_json: string | null;
  status: string;
  payment_id?: string | null;
}) {
  let tables: string[] = [];
  if (r.tables_json) {
    try {
      const parsed = JSON.parse(r.tables_json);
      if (Array.isArray(parsed)) tables = parsed.map((s) => String(s));
    } catch { /* ignore */ }
  }
  return {
    id: r.id,
    name: r.name,
    phone: r.phone,
    email: r.email,
    pax: r.pax,
    eventDate: r.event_date,
    arrivalTime: r.arrival_time,
    tables,
    status: r.status,
    paymentId: r.payment_id ?? null,
  };
}
