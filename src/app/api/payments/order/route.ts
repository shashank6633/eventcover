import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { getDb } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { getEvent } from '@/lib/events';
import { getReservation } from '@/lib/reservations';
import { validateCoupon } from '@/lib/coupons';
import { computeBilling } from '@/lib/pricing-calculator';
import {
  getRazorpayConfig,
  createRazorpayOrder,
} from '@/lib/razorpay';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ─── In-memory rate limit ──────────────────────────────────────────────────
// Same pattern as /api/reservations/public — 5 requests per IP per 10
// minutes. Map is process-local; periodic cleanup keeps it bounded. We
// deliberately don't import the Map from the other route so each endpoint
// has its own quota (a customer who already created a reservation should
// still be able to retry checkout if the first attempt failed).

const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 5;
const ipHits = new Map<string, number[]>();
let lastCleanupAt = 0;

function getClientIp(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for') || '';
  const first = fwd.split(',')[0]?.trim();
  if (first) return first;
  return req.headers.get('x-real-ip') || 'unknown';
}

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  if (now - lastCleanupAt > 60_000) {
    lastCleanupAt = now;
    for (const [key, hits] of ipHits) {
      const filtered = hits.filter((t) => now - t < RATE_WINDOW_MS);
      if (filtered.length === 0) ipHits.delete(key);
      else if (filtered.length !== hits.length) ipHits.set(key, filtered);
    }
  }
  const existing = ipHits.get(ip) || [];
  const fresh = existing.filter((t) => now - t < RATE_WINDOW_MS);
  if (fresh.length >= RATE_MAX) {
    ipHits.set(ip, fresh);
    return false;
  }
  fresh.push(now);
  ipHits.set(ip, fresh);
  return true;
}

// ─── Handler ───────────────────────────────────────────────────────────────

/**
 * POST /api/payments/order — PUBLIC, rate-limited.
 *
 * Body: { reservationId }
 *
 * Looks up the reservation + its event, computes the amount based on
 * event.payment_mode, creates a local `payments` row in 'created' state, then
 * calls Razorpay to mint an order_XXX id. Returns the bits the Razorpay
 * Checkout SDK needs (key_id, order_id, amount, customer prefill).
 *
 * Amount derivation:
 *   none        → 400 (event isn't accepting online payments)
 *   deposit     → event.deposit_amount
 *   full_cover  → entry_fee_per_person × pax  (gender breakdown isn't on the
 *                 public reservation form yet, so we use entry-only as a
 *                 conservative default — the cover top-up auto-issues in the
 *                 verify route when payment captures)
 */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { ok: false, message: 'Too many requests. Please try again in a few minutes.' },
      { status: 429 },
    );
  }

  const body = await req.json().catch(() => ({})) as {
    reservationId?: unknown;
    couponCode?: unknown;
    sessionId?: unknown;
    ticketType?: unknown;
    zoneName?: unknown;
  };
  const reservationId = String(body.reservationId || '').trim();
  const rawCouponCode = typeof body.couponCode === 'string' ? body.couponCode.trim() : '';
  // Phase-4 analytics: the customer's per-session analytics id, captured by
  // <EventAnalyticsTracker> on the public event page. We persist it into
  // payments.notes JSON so /api/payments/verify (and the failure webhook)
  // can stitch the checkout_success / checkout_failed funnel rows back to
  // the originating page-view + book_click events. Empty string => omit.
  const rawSessionId = typeof body.sessionId === 'string' ? body.sessionId.trim().slice(0, 64) : '';
  // Insights v2: stash the ticket type (or zone label, for seating events)
  // chosen by the customer. /api/events/:id/cart-recovery joins on this so
  // the activity table can render "EARLY BIRD SINGLE ENTRY x2" instead of
  // a bare amount; the Ticket Popularity widget also keys off it on the
  // checkout_success leg of the funnel.
  const rawTicketType = typeof body.ticketType === 'string' ? body.ticketType.trim().slice(0, 80) : '';
  const rawZoneName = typeof body.zoneName === 'string' ? body.zoneName.trim().slice(0, 80) : '';
  if (!reservationId) {
    return NextResponse.json({ ok: false, message: 'reservationId is required.' }, { status: 400 });
  }

  const cfg = getRazorpayConfig();
  if (!cfg.isConfigured) {
    return NextResponse.json(
      { ok: false, message: 'Online payments are not configured for this venue.' },
      { status: 503 },
    );
  }

  const reservation = getReservation(reservationId);
  if (!reservation) {
    return NextResponse.json({ ok: false, message: 'Reservation not found.' }, { status: 404 });
  }
  if (reservation.status === 'cancelled') {
    return NextResponse.json({ ok: false, message: 'This reservation has been cancelled.' }, { status: 400 });
  }
  if (reservation.status === 'converted') {
    return NextResponse.json({ ok: false, message: 'This reservation has already been paid.' }, { status: 400 });
  }
  if (!reservation.event_id) {
    return NextResponse.json({ ok: false, message: 'Reservation is not linked to an event yet.' }, { status: 400 });
  }

  const event = getEvent(reservation.event_id);
  if (!event) {
    return NextResponse.json({ ok: false, message: 'Event not found.' }, { status: 404 });
  }

  // ── Amount derivation ──
  const mode = event.payment_mode || 'none';
  if (mode === 'none') {
    return NextResponse.json(
      { ok: false, message: 'This event does not require online payment.' },
      { status: 400 },
    );
  }

  const pax = Math.max(1, Math.floor(Number(reservation.pax) || 1));

  // ── Determine the per-unit price + base amount (pre fee/GST overlay) ──
  // We feed the pricing-calculator a single zonePrice so it can compute
  // base = price * pax uniformly across deposit / full_cover / zone modes.
  // The mode-specific selection just picks WHICH price-per-unit to feed in.
  //   • deposit   — flat deposit, pax forced to 1 (deposit is a sunk amount)
  //   • full_cover w/ zone — frozen zone_price_snapshot per seat
  //   • full_cover flat    — entry_fee_per_person per seat
  // Cover charges are NOT applied here because the public reservation form
  // doesn't currently capture a gender breakdown — entry-only matches the
  // legacy behavior and the cover top-up auto-issues on capture.
  let pricePerUnit = 0;
  let pricedPax = pax;
  if (mode === 'deposit') {
    pricePerUnit = Number(event.deposit_amount) || 0;
    pricedPax = 1;
  } else if (mode === 'full_cover') {
    const zonePrice = reservation.zone_id ? Number(reservation.zone_price_snapshot) : NaN;
    pricePerUnit = Number.isFinite(zonePrice) && zonePrice >= 0
      ? zonePrice
      : (Number(event.entry_fee_per_person) || 0);
  }
  if (!Number.isFinite(pricePerUnit) || pricePerUnit <= 0) {
    return NextResponse.json(
      { ok: false, message: 'Could not determine a valid payment amount for this event.' },
      { status: 400 },
    );
  }

  // ── Coupon application (optional) ──
  // We validate server-side so a malicious client can't fake the discount.
  // The validator works against the BASE (price × pax) so the coupon's
  // percent / fixed semantics match what the customer sees on the booking
  // page. We then hand the resulting INR reduction to computeBilling()
  // which folds it into the discount layer before the gateway/platform/GST
  // overlay — keeping the spec calculation (gateway × subtotal) consistent.
  const baseSubtotal = pricePerUnit * pricedPax;
  let couponDiscount = 0;
  let couponId: string | null = null;
  let couponCodeStamp: string | null = null;
  if (rawCouponCode) {
    const couponResult = validateCoupon({
      code: rawCouponCode,
      eventId: event.id,
      subtotal: baseSubtotal,
    });
    if (!couponResult.ok) {
      return NextResponse.json(
        { ok: false, message: couponResult.reason || 'Invalid or expired coupon code.' },
        { status: 400 },
      );
    }
    couponDiscount = couponResult.discountAmount;
    couponId = couponResult.couponId;
    couponCodeStamp = couponResult.code || null;
  }

  // ── Final amount via the pricing-calculator (spec) ──
  // Feeds the per-unit price as `zonePrice` so the calculator's flat-pricing
  // path runs uniformly across deposit + full_cover + zone modes. The
  // event-level discount_percent is layered IN ADDITION to the coupon
  // reduction — see pricing-calculator.ts for the exact merge rules.
  const breakdown = computeBilling({
    event,
    pax: pricedPax,
    zonePrice: pricePerUnit,
    couponDiscount,
  });
  const amountInr = breakdown.final;
  const subtotalInr = breakdown.subtotal;
  const discountInr = breakdown.discount;

  // Razorpay requires a minimum order amount of 100 paise (₹1). If a
  // 100%-off coupon (or fixed discount ≥ subtotal) zeroed out the bill,
  // we can't push it through checkout — surface a clean error instead.
  if (!Number.isFinite(amountInr) || amountInr < 1) {
    return NextResponse.json(
      {
        ok: false,
        message: 'This coupon makes the booking free. Please contact the venue to confirm directly.',
      },
      { status: 400 },
    );
  }

  // ── Create local payment row first (so a Razorpay failure still leaves a trail) ──
  const db = getDb();
  const paymentId = nanoid();
  const now = Date.now();
  const amountPaise = Math.round(amountInr * 100);

  // Stash the analytics sessionId + ticket attribution in payments.notes
  // JSON so verify + the payment.failed webhook can stitch
  // checkout_success / checkout_failed back to the originating session,
  // and so cart-recovery / Ticket Popularity can label the row. Build the
  // object lazily — keep `notes` NULL when none of the optional fields are
  // present to match the legacy shape (verify guards against malformed
  // JSON anyway).
  //
  // fee_breakdown lives alongside the funnel-attribution keys so a single
  // SELECT against payments.notes JSON can reconstruct the full bill (base,
  // discount, gateway, platform, GST, final) + the payer config that was
  // active at the time of booking. Reconciliation auditors lean on this:
  // even if the host flips payment_gateway_fee_payer later, the per-row
  // history stays accurate.
  const notesPayload: Record<string, unknown> = {};
  if (rawSessionId) notesPayload.sessionId = rawSessionId;
  if (rawTicketType) notesPayload.ticketType = rawTicketType;
  if (rawZoneName) notesPayload.zoneName = rawZoneName;
  notesPayload.fee_breakdown = breakdown;
  const notesJson = JSON.stringify(notesPayload);

  db.prepare(`
    INSERT INTO payments (
      id, reservation_id, event_id,
      razorpay_order_id, razorpay_payment_id, razorpay_signature,
      amount, amount_paise, currency, status,
      payer_name, payer_phone, payer_email, payment_mode,
      txn_id, notes, error_code, error_description,
      webhook_received_at, verified_at,
      coupon_id, coupon_code, discount_amount,
      zone_id,
      created_at, updated_at
    ) VALUES (?, ?, ?, '', NULL, NULL, ?, ?, 'INR', 'created',
              ?, ?, ?, ?, NULL, ?, NULL, NULL, NULL, NULL,
              ?, ?, ?,
              ?,
              ?, ?)
  `).run(
    paymentId,
    reservation.id,
    event.id,
    amountInr,
    amountPaise,
    reservation.name,
    reservation.phone,
    reservation.email || null,
    mode,
    notesJson,
    couponId,
    couponCodeStamp,
    discountInr,
    // Denormalized for audit; matches the coupon_id / coupon_code pattern
    // already on this row.
    reservation.zone_id || null,
    now,
    now,
  );

  // ── Call Razorpay ──
  const result = await createRazorpayOrder({
    amount: amountInr,
    currency: 'INR',
    // Razorpay caps receipt at 40 chars — nanoid() is 21, well under.
    receipt: paymentId,
    notes: {
      reservation_id: reservation.id,
      event_id: event.id,
      payment_mode: mode,
      // Phase 3 — slot context so the eventual wallet has the right time
      // slot (e.g. "9 PM doors") visible at door scan. Always a string
      // because Razorpay notes only accept string values; we send '' when
      // the reservation isn't slot-scoped (single-slot event).
      slot_id: reservation.slot_id || '',
    },
  });

  if (!result.ok || !result.order) {
    db.prepare(`
      UPDATE payments
      SET status = 'failed', error_description = ?, updated_at = ?
      WHERE id = ?
    `).run(result.error || 'order_create_failed', Date.now(), paymentId);

    logAudit({
      actor: 'public',
      action: 'payment_order_failed',
      entityType: 'payment',
      entityId: paymentId,
      details: { reservation_id: reservation.id, error: result.error, status: result.status },
    });

    return NextResponse.json(
      { ok: false, message: 'Could not initiate payment. Please try again.' },
      { status: 502 },
    );
  }

  db.prepare(`
    UPDATE payments
    SET razorpay_order_id = ?, updated_at = ?
    WHERE id = ?
  `).run(result.order.id, Date.now(), paymentId);

  logAudit({
    actor: 'public',
    action: 'payment_order_create',
    entityType: 'payment',
    entityId: paymentId,
    details: {
      reservation_id: reservation.id,
      event_id: event.id,
      subtotal_inr: subtotalInr,
      discount_inr: discountInr,
      amount_inr: amountInr,
      amount_paise: amountPaise,
      payment_mode: mode,
      razorpay_order_id: result.order.id,
      coupon_id: couponId,
      coupon_code: couponCodeStamp,
    },
  });

  return NextResponse.json({
    ok: true,
    paymentId,
    razorpayOrderId: result.order.id,
    amount: amountPaise,
    currency: result.order.currency,
    keyId: cfg.keyId,
    customer: {
      name: reservation.name,
      phone: reservation.phone,
      email: reservation.email,
    },
    eventName: event.name,
  });
}
