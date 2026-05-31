/**
 * Abandoned-bookings ledger.
 *
 * "Abandoned" = a customer started but never finished the booking journey.
 * Two sources today:
 *
 *  1. payments rows with status='created' or 'failed' older than the grace
 *     window. status='created' means a Razorpay order was minted but the
 *     customer never completed checkout (modal dismissed, browser closed,
 *     payment timed out, card declined and they never retried). status='failed'
 *     is explicit decline / capture failure.
 *
 *  2. reservations with status='pending' AND no associated successful payment
 *     AND older than the grace window. Customer submitted the public booking
 *     form on a paid-event but never reached the payment screen, OR a free
 *     reservation that staff never converted to a wallet.
 *
 * Recovery actions:
 *  - Send WhatsApp reminder (manual today; eventual Interakt template)
 *  - Mark recovered (host knows customer paid offline / converted some other way)
 *  - Dismiss (intentionally giving up on this lead)
 *
 * NOTE: status='failed' payments and 'pending' reservations marked
 * 'recovered'/'dismissed' are filtered out so the list shrinks over time.
 * Recovery tracking lives on the source row (notes), not a separate table.
 */

import { getDb } from './db';

export type AbandonStage =
  | 'reservation_only'   // pending reservation, no payment attempt
  | 'payment_created'    // Razorpay order minted, customer dismissed checkout
  | 'payment_failed';    // explicit card decline / network failure

export interface AbandonedBooking {
  /** Stable client-side id — payment.id OR reservation.id (prefix tells which). */
  id: string;
  source: 'payment' | 'reservation';
  stage: AbandonStage;
  /** When the abandonment happened (last mutation on the source row). */
  abandonedAt: number;
  /** Best-effort customer identity from whichever row we have. */
  name: string | null;
  phone: string | null;
  email: string | null;
  /** Event the customer was trying to book — may be null. */
  eventId: string | null;
  eventName: string | null;
  eventDate: string | null;
  /** What it would have been worth (₹). 0 if unknown. */
  amount: number;
  /** Razorpay order/payment ids when present — useful for cross-referencing. */
  razorpayOrderId: string | null;
  razorpayPaymentId: string | null;
  /** Server-side reason if Razorpay told us why (e.g. 'BAD_REQUEST_ERROR'). */
  errorCode: string | null;
  errorDescription: string | null;
  /** Free-text staff notes (sets via /api/abandoned-bookings/[id]/note). */
  recoveryNotes: string | null;
}

export interface ListInput {
  /** Filter by stage. Default: all. */
  stage?: AbandonStage | 'all';
  /** Only entries older than this many minutes. Default 60 (1 hour). Avoids
   *  showing checkouts that are still in-flight. */
  minAgeMinutes?: number;
  /** Max rows. Default 200. */
  limit?: number;
}

/**
 * List abandoned bookings, sorted newest abandonment first.
 *
 * Both queries use indexed columns (payments.status, reservations.status).
 * The union + sort is small enough we do it in JS instead of SQL UNION;
 * keeps the query SQLite-portable and easier to maintain.
 */
export function listAbandonedBookings(input: ListInput = {}): AbandonedBooking[] {
  const db = getDb();
  const minAge = input.minAgeMinutes ?? 60;
  const limit = Math.min(input.limit ?? 200, 500);
  const cutoff = Date.now() - minAge * 60 * 1000;
  const stage = input.stage ?? 'all';

  const out: AbandonedBooking[] = [];

  if (stage === 'all' || stage === 'payment_created' || stage === 'payment_failed') {
    // Payments: created (modal dismissed / timed out) OR failed (decline).
    // We explicitly EXCLUDE rows tagged in notes with kind=wallet_topup — those
    // are wallet top-ups, not bookings. Recovery flow there is different.
    const rows = db.prepare(`
      SELECT
        p.id, p.razorpay_order_id, p.razorpay_payment_id, p.amount, p.status,
        p.payer_name, p.payer_phone, p.payer_email, p.created_at, p.updated_at,
        p.error_code, p.error_description, p.notes,
        p.event_id, p.reservation_id,
        e.name AS event_name, e.event_date
      FROM payments p
      LEFT JOIN events e ON e.id = p.event_id
      WHERE p.status IN ('created', 'failed')
        AND p.created_at < ?
        AND (p.notes IS NULL OR p.notes NOT LIKE '%"kind":"wallet_topup"%')
      ORDER BY p.updated_at DESC, p.created_at DESC
      LIMIT ?
    `).all(cutoff, limit) as Array<{
      id: string;
      razorpay_order_id: string | null;
      razorpay_payment_id: string | null;
      amount: number;
      status: string;
      payer_name: string | null;
      payer_phone: string | null;
      payer_email: string | null;
      created_at: number;
      updated_at: number | null;
      error_code: string | null;
      error_description: string | null;
      notes: string | null;
      event_id: string | null;
      reservation_id: string | null;
      event_name: string | null;
      event_date: string | null;
    }>;

    for (const r of rows) {
      if (stage !== 'all') {
        const want = stage === 'payment_created' ? 'created' : 'failed';
        if (r.status !== want) continue;
      }
      const recoveryNotes = extractRecoveryNote(r.notes);
      out.push({
        id: `payment:${r.id}`,
        source: 'payment',
        stage: r.status === 'failed' ? 'payment_failed' : 'payment_created',
        abandonedAt: r.updated_at ?? r.created_at,
        name: r.payer_name,
        phone: r.payer_phone,
        email: r.payer_email,
        eventId: r.event_id,
        eventName: r.event_name,
        eventDate: r.event_date,
        amount: Number(r.amount) || 0,
        razorpayOrderId: r.razorpay_order_id,
        razorpayPaymentId: r.razorpay_payment_id,
        errorCode: r.error_code,
        errorDescription: r.error_description,
        recoveryNotes,
      });
    }
  }

  if (stage === 'all' || stage === 'reservation_only') {
    // Reservations that never got a successful payment AND never converted.
    // We anti-join payments to exclude reservations that DID move forward
    // (the payment row exists, customer made it past the form).
    const rows = db.prepare(`
      SELECT
        r.id, r.name, r.phone, r.email, r.pax, r.status, r.notes AS res_notes,
        r.event_id, r.event_date, r.synced_at, r.raw,
        e.name AS event_name
      FROM reservations r
      LEFT JOIN events e ON e.id = r.event_id
      WHERE r.status = 'pending'
        AND r.synced_at < ?
        AND NOT EXISTS (
          SELECT 1 FROM payments p
          WHERE p.reservation_id = r.id
            AND p.status = 'captured'
        )
        AND NOT EXISTS (
          SELECT 1 FROM payments p2
          WHERE p2.reservation_id = r.id
            AND p2.status IN ('created', 'failed')
        )
      ORDER BY r.synced_at DESC
      LIMIT ?
    `).all(cutoff, limit) as Array<{
      id: string;
      name: string;
      phone: string;
      email: string | null;
      pax: number | null;
      status: string;
      res_notes: string | null;
      event_id: string | null;
      event_date: string | null;
      synced_at: number;
      raw: string | null;
      event_name: string | null;
    }>;

    for (const r of rows) {
      const recoveryNotes = extractRecoveryNote(r.res_notes);
      out.push({
        id: `reservation:${r.id}`,
        source: 'reservation',
        stage: 'reservation_only',
        abandonedAt: r.synced_at,
        name: r.name,
        phone: r.phone,
        email: r.email,
        eventId: r.event_id,
        eventName: r.event_name,
        eventDate: r.event_date,
        amount: 0,
        razorpayOrderId: null,
        razorpayPaymentId: null,
        errorCode: null,
        errorDescription: null,
        recoveryNotes,
      });
    }
  }

  // Newest-first merged view.
  out.sort((a, b) => b.abandonedAt - a.abandonedAt);
  return out.slice(0, limit);
}

export interface AbandonedCounts {
  total: number;
  paymentCreated: number;
  paymentFailed: number;
  reservationOnly: number;
  potentialRevenue: number;
}

/** Lightweight counts for the dashboard header — single pass, no JOINs needed. */
export function getAbandonedCounts(minAgeMinutes = 60): AbandonedCounts {
  const list = listAbandonedBookings({ minAgeMinutes, limit: 500 });
  return {
    total: list.length,
    paymentCreated: list.filter((b) => b.stage === 'payment_created').length,
    paymentFailed: list.filter((b) => b.stage === 'payment_failed').length,
    reservationOnly: list.filter((b) => b.stage === 'reservation_only').length,
    potentialRevenue: list.reduce((sum, b) => sum + b.amount, 0),
  };
}

/**
 * Mark an abandoned booking as recovered (customer paid offline, was contacted
 * successfully, etc.) — stamps a structured note on the source row so the
 * filter excludes it from future lists.
 */
export function markRecovered(
  id: string,
  actor: string,
  note?: string,
): { ok: boolean; reason?: string } {
  const [source, sourceId] = id.split(':');
  if (!sourceId) return { ok: false, reason: 'invalid_id' };

  const db = getDb();
  const noteEntry = `[recovered by ${actor} @ ${new Date().toISOString()}] ${note || 'manual recovery'}`;

  if (source === 'payment') {
    // status='recovered' is a custom non-Razorpay state that flags the row as
    // settled outside the gateway. Excluded from the abandoned list by the
    // SELECT (which only matches 'created' / 'failed').
    const r = db.prepare(`
      UPDATE payments
      SET status = 'recovered',
          notes = COALESCE(notes, '') || char(10) || ?,
          updated_at = ?
      WHERE id = ? AND status IN ('created', 'failed')
    `).run(noteEntry, Date.now(), sourceId);
    return r.changes > 0 ? { ok: true } : { ok: false, reason: 'not_found_or_already_settled' };
  }

  if (source === 'reservation') {
    // Reservations use the 'no_show' status for "customer didn't materialize"
    // OR we can introduce a 'recovered' status. Going with 'cancelled' here
    // since the customer never converted — keeps the existing status enum.
    const r = db.prepare(`
      UPDATE reservations
      SET status = 'cancelled',
          notes = COALESCE(notes, '') || char(10) || ?
      WHERE id = ? AND status = 'pending'
    `).run(noteEntry, sourceId);
    return r.changes > 0 ? { ok: true } : { ok: false, reason: 'not_found_or_already_settled' };
  }

  return { ok: false, reason: 'unknown_source' };
}

/**
 * Pull the most recent `[recovered…]` or `[note…]` line out of the source
 * row's free-text notes column so the UI can show staff history without
 * a separate audit table.
 */
function extractRecoveryNote(raw: string | null): string | null {
  if (!raw) return null;
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().startsWith('['));
  return lines.length > 0 ? lines[lines.length - 1] : null;
}
