/**
 * Global Bookings list — every payment-bearing row across every event.
 *
 * Powers /admin/bookings — the cross-event view that captured/pending/
 * abandoned bookings all roll up into. Existing per-event Bookings tab
 * (under /admin/events/[id]/manage/bookings) joins on the same `payments`
 * table; this just lifts the event filter so the operator sees one big list.
 *
 * Why a separate lib (not extending listAbandonedBookings)?
 *   • Abandoned-bookings is intentionally laser-focused: it filters rows by
 *     status ∈ (created, failed) + minAge guard + 'recovered' exclusion.
 *     Adding 'captured' there would change its semantics for the existing
 *     dashboard (header counts, recovery actions).
 *   • Bookings here treats every payments row as first-class — captured is
 *     the *primary* case, the others are tail states.
 *
 * Schema source-of-truth:
 *   payments(id, reservation_id, event_id, amount, status, created_at,
 *            razorpay_order_id, razorpay_payment_id, payer_name, payer_phone,
 *            payer_email, error_description, notes, coupon_code, discount_amount,
 *            zone_id)
 *   reservations(id, name, phone, email, pax, male_count, female_count,
 *                couple_count, zone_id, slot_id, arrival_time, status)
 *   events(id, name, event_date, slug)
 *
 * `notes` is JSON ({ sessionId?, ticketType?, zoneName?, fee_breakdown?, gender_mix? }).
 * We parse it lazily — only when a caller looks at the .ticketType etc.
 * keys — to keep this read fast on the list page.
 */

import { getDb } from './db';

// Match the statuses the payments table actually uses (see /api/payments/order
// + /verify) plus the synthetic 'recovered' tag the abandoned-bookings flow
// writes. UI maps these into three buckets: captured, pending, abandoned.
export type BookingPaymentStatus =
  | 'captured'        // money in the bank
  | 'created'         // Razorpay order minted, customer hasn't paid
  | 'failed'          // explicit decline / Razorpay-reported failure
  | 'refunded'        // captured then reversed
  | 'recovered';      // manually marked as won-back from abandoned-bookings

export interface BookingListRow {
  /** payments.id — stable pk. */
  id: string;
  /** Customer identity, from payments (NULL columns fall back to the joined reservation). */
  name: string | null;
  phone: string | null;
  email: string | null;
  /** Event the customer was paying for. NULL when the payment never linked to one. */
  eventId: string | null;
  eventName: string | null;
  eventDate: string | null;
  eventSlug: string | null;
  /** Reservation that owns the seat. */
  reservationId: string | null;
  /** Pax from reservation row — preferred over payer count. */
  pax: number | null;
  /** M/F/C breakdown when captured (NULL when never set). */
  maleCount: number | null;
  femaleCount: number | null;
  coupleCount: number | null;
  /** Zone or table label the customer picked at booking time. */
  zoneName: string | null;
  /** Slot start time when the event runs multi-slot scheduling. */
  slotLabel: string | null;
  /** Amount the customer was billed (INR). */
  amount: number;
  /** Discount applied (coupon or event-level). */
  discount: number;
  /** Razorpay ids when known — helpful for cross-referencing in Razorpay dashboard. */
  razorpayOrderId: string | null;
  razorpayPaymentId: string | null;
  /** Coupon code applied at order time (NULL if none). */
  couponCode: string | null;
  /** Server status of the payment row. */
  status: BookingPaymentStatus;
  /** When the payment row was created (= when the customer started checkout). */
  createdAt: number;
  /** When the payment was captured (or last updated for non-captured rows). */
  capturedAt: number | null;
  /** Error_description on failed payments. NULL when status !== 'failed'. */
  errorDescription: string | null;
  /** Cosmetic — derived from payments.notes JSON ticketType key (e.g. "Early Bird Table of 4"). */
  ticketTypeLabel: string | null;
}

export interface ListAllBookingsInput {
  /** Filter to one event. Empty/undefined = every event. */
  eventId?: string | null;
  /** Filter by status bucket. Default = all. */
  statusBucket?: 'all' | 'captured' | 'pending' | 'abandoned' | 'refunded';
  /** Free-text search on name / phone / email / order id. Case-insensitive. */
  q?: string;
  /** YYYY-MM-DD inclusive lower bound on event_date. */
  fromDate?: string | null;
  /** YYYY-MM-DD inclusive upper bound on event_date. */
  toDate?: string | null;
  /** Max rows returned. Caller-controlled but capped at 500 here. */
  limit?: number;
}

interface RawJoinRow {
  id: string;
  payer_name: string | null;
  payer_phone: string | null;
  payer_email: string | null;
  res_name: string | null;
  res_phone: string | null;
  res_email: string | null;
  event_id: string | null;
  event_name: string | null;
  event_date: string | null;
  event_slug: string | null;
  reservation_id: string | null;
  pax: number | null;
  male_count: number | null;
  female_count: number | null;
  couple_count: number | null;
  zone_label: string | null;
  zone_id: string | null;
  slot_label: string | null;
  amount: number;
  discount_amount: number | null;
  razorpay_order_id: string | null;
  razorpay_payment_id: string | null;
  coupon_code: string | null;
  status: string;
  created_at: number;
  updated_at: number;
  verified_at: number | null;
  error_description: string | null;
  notes: string | null;
}

/**
 * Map UI status buckets onto payments.status values. Keeping the mapping
 * here (not in the route) so the CSV exporter, KPI counter and list endpoint
 * agree on what "pending" means.
 */
function statusesForBucket(b: ListAllBookingsInput['statusBucket']): string[] {
  switch (b) {
    case 'captured':
      return ['captured'];
    case 'pending':
      return ['created'];
    case 'abandoned':
      return ['failed', 'recovered'];
    case 'refunded':
      return ['refunded'];
    case 'all':
    case undefined:
    case null:
      return ['captured', 'created', 'failed', 'refunded', 'recovered'];
  }
}

/**
 * Pull the requested cohort of payments out of the DB joined with their
 * reservation + event context. Single query, single round-trip — the page
 * uses this to populate the table AND derive its KPI tiles.
 *
 * Excludes `kind: wallet_topup` rows (those are top-ups, not bookings)
 * using the same LIKE-on-JSON pattern abandoned-bookings uses. Wallet top-ups
 * land in /admin/cashier; this view stays bookings-only.
 */
export function listAllBookings(input: ListAllBookingsInput = {}): BookingListRow[] {
  const db = getDb();
  const limit = Math.min(input.limit ?? 200, 500);
  const statuses = statusesForBucket(input.statusBucket);
  const placeholders = statuses.map(() => '?').join(',');

  const where: string[] = [`p.status IN (${placeholders})`];
  const params: unknown[] = [...statuses];

  if (input.eventId) {
    where.push('p.event_id = ?');
    params.push(input.eventId);
  }
  if (input.fromDate) {
    where.push('e.event_date >= ?');
    params.push(input.fromDate);
  }
  if (input.toDate) {
    where.push('e.event_date <= ?');
    params.push(input.toDate);
  }
  if (input.q && input.q.trim()) {
    // LIKE %q% on the columns we expect operators to search — case-folded
    // by the user's input being lower-cased before binding.
    const q = `%${input.q.trim()}%`;
    where.push(
      '(LOWER(p.payer_name) LIKE LOWER(?) OR p.payer_phone LIKE ? OR LOWER(p.payer_email) LIKE LOWER(?) OR p.razorpay_order_id LIKE ?)',
    );
    params.push(q, q, q, q);
  }
  // Exclude wallet top-ups — they live under Cashier, not Bookings.
  where.push(`(p.notes IS NULL OR p.notes NOT LIKE '%"kind":"wallet_topup"%')`);

  const sql = `
    SELECT
      p.id,
      p.payer_name,
      p.payer_phone,
      p.payer_email,
      r.name           AS res_name,
      r.phone          AS res_phone,
      r.email          AS res_email,
      p.event_id,
      e.name           AS event_name,
      e.event_date,
      e.slug           AS event_slug,
      p.reservation_id,
      r.pax,
      r.male_count,
      r.female_count,
      r.couple_count,
      ez.zone_label,
      p.zone_id,
      es.start_time    AS slot_label,
      p.amount,
      p.discount_amount,
      p.razorpay_order_id,
      p.razorpay_payment_id,
      p.coupon_code,
      p.status,
      p.created_at,
      p.updated_at,
      p.verified_at,
      p.error_description,
      p.notes
    FROM payments p
    LEFT JOIN reservations r  ON r.id = p.reservation_id
    LEFT JOIN events e        ON e.id = p.event_id
    LEFT JOIN event_zones ez  ON ez.id = p.zone_id
    LEFT JOIN event_slots es  ON es.id = r.slot_id
    WHERE ${where.join(' AND ')}
    ORDER BY p.created_at DESC
    LIMIT ?
  `;
  params.push(limit);
  const rows = db.prepare(sql).all(...params) as RawJoinRow[];

  return rows.map(rowToBookingListRow);
}

/**
 * Quick aggregate counts for the dashboard header — single grouped query.
 * Kept separate from the list so the UI can call both in parallel without
 * the count tax on long result pages.
 */
export interface BookingCounts {
  total: number;
  captured: number;
  pending: number;
  abandoned: number;
  refunded: number;
  totalRevenue: number;
  totalPax: number;
}

export function getBookingCounts(input: Omit<ListAllBookingsInput, 'limit' | 'statusBucket'> = {}): BookingCounts {
  const db = getDb();
  const where: string[] = [`(p.notes IS NULL OR p.notes NOT LIKE '%"kind":"wallet_topup"%')`];
  const params: unknown[] = [];

  if (input.eventId) {
    where.push('p.event_id = ?');
    params.push(input.eventId);
  }
  if (input.fromDate) {
    where.push('e.event_date >= ?');
    params.push(input.fromDate);
  }
  if (input.toDate) {
    where.push('e.event_date <= ?');
    params.push(input.toDate);
  }
  if (input.q && input.q.trim()) {
    const q = `%${input.q.trim()}%`;
    where.push('(LOWER(p.payer_name) LIKE LOWER(?) OR p.payer_phone LIKE ? OR LOWER(p.payer_email) LIKE LOWER(?))');
    params.push(q, q, q);
  }

  const rows = db.prepare(`
    SELECT p.status AS status, p.amount AS amount, r.pax AS pax
    FROM payments p
    LEFT JOIN events e        ON e.id = p.event_id
    LEFT JOIN reservations r  ON r.id = p.reservation_id
    WHERE ${where.join(' AND ')}
  `).all(...params) as { status: string; amount: number; pax: number | null }[];

  let captured = 0, pending = 0, abandoned = 0, refunded = 0;
  let totalRevenue = 0, totalPax = 0;
  for (const r of rows) {
    if (r.status === 'captured') {
      captured++;
      totalRevenue += Number(r.amount) || 0;
      totalPax += Number(r.pax) || 0;
    } else if (r.status === 'created') {
      pending++;
    } else if (r.status === 'failed' || r.status === 'recovered') {
      abandoned++;
    } else if (r.status === 'refunded') {
      refunded++;
    }
  }
  return {
    total: rows.length,
    captured,
    pending,
    abandoned,
    refunded,
    totalRevenue,
    totalPax,
  };
}

function rowToBookingListRow(r: RawJoinRow): BookingListRow {
  // Prefer reservation-side identity (more reliable since the reservation
  // form is what the customer filled out) and fall back to payer_* which
  // Razorpay echoes back. Either source can be null if the row predates
  // the column.
  const name = r.res_name || r.payer_name || null;
  const phone = r.res_phone || r.payer_phone || null;
  const email = r.res_email || r.payer_email || null;

  // Lazy parse notes JSON only for the one optional label we want to show
  // (ticket type / zone name as picked by the customer). Errors → null,
  // never throw the whole list.
  let ticketTypeLabel: string | null = null;
  if (r.notes) {
    try {
      const parsed = JSON.parse(r.notes) as { ticketType?: string; zoneName?: string };
      ticketTypeLabel = parsed.ticketType || parsed.zoneName || null;
    } catch {
      /* swallow */
    }
  }

  return {
    id: r.id,
    name,
    phone,
    email,
    eventId: r.event_id,
    eventName: r.event_name,
    eventDate: r.event_date,
    eventSlug: r.event_slug,
    reservationId: r.reservation_id,
    pax: r.pax,
    maleCount: r.male_count,
    femaleCount: r.female_count,
    coupleCount: r.couple_count,
    zoneName: r.zone_label,
    slotLabel: r.slot_label,
    amount: Number(r.amount) || 0,
    discount: Number(r.discount_amount) || 0,
    razorpayOrderId: r.razorpay_order_id,
    razorpayPaymentId: r.razorpay_payment_id,
    couponCode: r.coupon_code,
    status: r.status as BookingPaymentStatus,
    createdAt: r.created_at,
    capturedAt: r.verified_at || (r.status === 'captured' ? r.updated_at : null),
    errorDescription: r.error_description,
    ticketTypeLabel,
  };
}
