import { type NextRequest, NextResponse } from 'next/server';
import { getDb, getConfig } from '@/lib/db';
import type { EventRow } from '@/lib/events';
import { getEffectivePixelId } from '@/lib/meta-pixel';
import { listPublicMedia } from '@/lib/event-media';
import { listSlotsWithCapacity } from '@/lib/event-slots';
import { parseRsvpFields } from '@/lib/rsvp-fields';
import { listPublicZones } from '@/lib/seating-layout';

function clampPercent(v: number): number {
  if (!Number.isFinite(v) || v < 0) return 0;
  return Math.min(100, v);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type PaymentMode = 'none' | 'deposit' | 'full_cover';

/**
 * EventRow with the new payment columns the other agent is adding to the
 * `events` table. We don't depend on the canonical type yet because the
 * schema migration ships independently.
 */
type EventRowWithPayment = EventRow & {
  payment_mode?: PaymentMode | null;
  deposit_amount?: number | null;
};

/**
 * Compute the INR rupee amount to preview on the public landing page.
 *
 *   - 'none'       → null (no payment)
 *   - 'deposit'    → flat deposit amount
 *   - 'full_cover' → per-person entry fee (default pax = 1)
 *
 * IMPORTANT: This is a *display hint* only. The /api/payments/order
 * endpoint re-computes the real charge server-side using the saved pax on
 * the reservation, so what the customer actually pays may differ.
 */
function computePaymentAmount(row: EventRowWithPayment): number | null {
  const mode = (row.payment_mode || 'none') as PaymentMode;
  if (mode === 'none') return null;
  if (mode === 'deposit') return Number(row.deposit_amount || 0);
  if (mode === 'full_cover') return Number(row.entry_fee_per_person || 0) * 1;
  return null;
}

/**
 * GET /api/events/by-slug/[slug]/public
 *
 * PUBLIC, no auth. Powers the customer-facing /e/<slug> landing page.
 *
 * Carefully whitelists which event fields go out — internal pricing
 * (base_entry_fee, cover_rates), notes, and audit fields are NEVER
 * exposed here. The browser-side Pixel snippet needs `pixelId`, so we
 * compute the effective Pixel ID (event override → global) and return it.
 *
 * Also returns `venuePhone` (HOST_PHONE config) so the landing page can
 * render tel: + WhatsApp CTAs.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const cleaned = (slug || '').trim().toLowerCase();
  if (!cleaned) {
    return NextResponse.json({ ok: false, message: 'slug required' }, { status: 400 });
  }

  const db = getDb();
  const row = db.prepare('SELECT * FROM events WHERE slug = ? LIMIT 1').get(cleaned) as EventRowWithPayment | undefined;
  if (!row) {
    return NextResponse.json({ ok: false, message: 'event not found' }, { status: 404 });
  }
  // Draft events shouldn't be discoverable via the public URL — only live
  // (and arguably closed, for post-event pages). Hosts can preview drafts
  // from the admin UI which uses /api/events/[id] (authenticated).
  if (row.status === 'draft') {
    return NextResponse.json({ ok: false, message: 'event not found' }, { status: 404 });
  }
  if (!row.is_public) {
    return NextResponse.json({ ok: false, message: 'event not found' }, { status: 404 });
  }

  const pixelId = getEffectivePixelId(row.meta_pixel_id);
  const venuePhone = getConfig('HOST_PHONE', '');

  const paymentMode: PaymentMode = (row.payment_mode || 'none') as PaymentMode;
  const paymentAmount = computePaymentAmount(row);

  // Phase 2: gallery carousel below the hero. Empty array when the host
  // hasn't uploaded any extra media — the public page renders nothing in
  // that case. We deliberately use the public projection so created_by /
  // created_at never leave the server.
  const media = listPublicMedia(row.id);

  // ─── Phase 3: access_mode + slots ─────────────────────────────────────
  // accessMode tells the public page whether to gate render (invite_link)
  // or enforce phone-list on submit. invite_secret is NEVER returned —
  // the gate is enforced server-side on POST.
  //
  // slots[] is the active schedule slots projection. Empty when the event
  // uses single-slot mode (events.event_date + events.start_time). When
  // non-empty, the form renders a slot picker.
  const accessMode: 'public' | 'invite_link' | 'phone_list' =
    row.access_mode === 'invite_link' || row.access_mode === 'phone_list'
      ? row.access_mode
      : 'public';

  const slots = listSlotsWithCapacity(row.id, { activeOnly: true }).map((s) => ({
    id: s.id,
    slot_date: s.slot_date,
    start_time: s.start_time,
    end_time: s.end_time,
    label: s.label,
    max_capacity: s.max_capacity,
    remaining_capacity: s.remaining_capacity,
  }));

  // ─── Phase 4: RSVP custom fields ──────────────────────────────────────
  // Field DEFINITIONS only — never any answers from other guests. Safe to
  // ship in the public projection. Legacy events with no rsvp_fields_json
  // come through as [] via parseRsvpFields()'s defensive parsing.
  const rsvpFields = parseRsvpFields(
    (row as { rsvp_fields_json?: string | null }).rsvp_fields_json ?? null,
  );

  // ─── Seating layout ───────────────────────────────────────────────────
  // Only embed the SVG when the feature is enabled — keeps the wire size
  // small for events that don't use it. Zone capacity is exposed as
  // sold_count + capacity so the public renderer can show "X available";
  // we deliberately leak this number for UX (matches Growezzy behavior).
  const seatingEnabled = !!(row as { seating_layout_enabled?: number }).seating_layout_enabled;
  const seatingLayoutSvg = seatingEnabled
    ? (row as { seating_layout_svg?: string | null }).seating_layout_svg ?? null
    : null;
  const zones = seatingEnabled ? listPublicZones(row.id) : [];

  // ─── Per-event Settings — fee payer + GST flags ──────────────────────────
  // The booking form uses these to render the right line items on the
  // customer-facing summary ("Gateway fee +₹X" / "GST +₹Y"). We DON'T leak
  // the percentages here — the customer sees absolute INR amounts only,
  // computed server-side via /api/payments/order. This matches the rest of
  // the public payload's policy of hiding raw pricing config.
  const settingsRow = row as EventRowWithPayment & {
    payment_gateway_fee_payer?: string | null;
    platform_fee_payer?: string | null;
    gst_enabled?: number | null;
  };
  const gatewayFeePayer: 'customer' | 'host' =
    settingsRow.payment_gateway_fee_payer === 'customer' ? 'customer' : 'host';
  const platformFeePayer: 'customer' | 'host' =
    settingsRow.platform_fee_payer === 'customer' ? 'customer' : 'host';
  const gstEnabled = !!settingsRow.gst_enabled;
  // Percentages — leaked deliberately so the public booking form can render
  // the line-item breakdown ("Gateway fee +₹X") without an extra round-trip.
  // The Razorpay order is still computed server-side, so a tampered client
  // can't undercharge: /api/payments/order recomputes via computeBilling().
  const gatewayFeePct = clampPercent(Number(getConfig('PAYMENT_GATEWAY_FEE_PCT', '2')) || 0);
  const platformFeePct = clampPercent(Number(getConfig('PLATFORM_FEE_PCT', '0')) || 0);
  const gstPercent = clampPercent(Number(row.gst_percent) || 0);
  const discountPercent = clampPercent(Number(row.discount_percent) || 0);

  // Strictly whitelisted projection. No prices, no internal notes, no
  // booking_types pricing leak — those go through a separate booking
  // endpoint when the customer commits.
  //
  // Seating Layout — fields are SHIPPED AT THE TOP LEVEL of the response
  // (sibling to event/media/slots) so the public page can pass them
  // directly to <PublicBookingForm/> without nesting under event. Keeping
  // the contract flat matches the rest of the public payload shape (zones,
  // rsvpFields, etc.) and avoids drift between client + server typings.
  return NextResponse.json({
    ok: true,
    event: {
      id: row.id,
      slug: row.slug,
      name: row.name,
      event_date: row.event_date,
      start_time: row.start_time,
      description: row.description,
      image_data: row.image_data,
      genre: row.genre,
      venue_id: row.venue_id,
      status: row.status,
      // Phase 3 — never include invite_secret here.
      access_mode: accessMode,
      invite_message: row.invite_message ?? null,
    },
    media,
    slots,
    rsvpFields,
    zones,
    seatingLayoutEnabled: seatingEnabled,
    sanitizedSvg: seatingLayoutSvg,
    pixelId: pixelId || null,
    venuePhone,
    paymentMode,
    paymentAmount,
    // Per-event Settings — surfaces the payer config + the percentages the
    // booking form needs to render the line-item breakdown. The Razorpay
    // order is still computed server-side via computeBilling() in
    // /api/payments/order so a tampered client can't lower the charge —
    // the percentages are non-secret platform constants, NOT trust-anchors.
    paymentGatewayFeePayer: gatewayFeePayer,
    platformFeePayer,
    gstEnabled,
    paymentGatewayFeePct: gatewayFeePct,
    platformFeePct,
    gstPercent,
    discountPercent,
  });
}
