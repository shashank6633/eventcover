/**
 * Reservation ledger summary — combines the check-in counters, redemption
 * counters, and recent history into a single payload used by:
 *   • the QR scan landing card on /admin/scan and /admin/checkin
 *   • the manager/host detail page at /admin/reservations/[id]
 *   • the /api/reservations/[id]/history and /api/scan API responses
 *
 * Pure read-only. All mutation paths live in reservation-checkin.ts and
 * cover-redemption.ts.
 *
 * IMPORTANT — wire contract: this module defines the SHIPPED shape that
 * crosses the server/client boundary. All keys are snake_case and match the
 * client-side `ReservationLedger` interface in ReservationSummaryCard.tsx.
 * Adding a new field here MUST also be reflected in that client interface
 * (and probably wired through ReservationSummaryCard).
 */

import { getDb } from './db';
import {
  computeReservationStatus,
  getCheckinState,
  listCheckins,
  type CheckinRow,
  type ReservationLedgerStatus,
} from './reservation-checkin';
import {
  computeCoverStatus,
  getRedemptionState,
  listRedemptions,
  type CoverStatus,
  type RedemptionRow,
} from './cover-redemption';

/**
 * Lightweight summary used by the scan endpoint to drive the post-scan
 * card without paying for the full ledger history join. Skips the
 * checkins / redemptions arrays.
 *
 * All fields are snake_case so this object can be JSON-serialised straight
 * onto the wire — no client-side renaming.
 */
export interface ReservationSummary {
  reservation_id: string;
  /** Short display code, e.g. "RES-CN3T". Derived from reservation_id tail. */
  display_code: string;
  guest_name: string;
  guest_phone: string | null;
  event_id: string | null;
  event_name: string | null;
  event_date: string | null;
  total_pax: number;
  checked_in_pax: number;
  remaining_pax: number;
  entry_amount: number;
  cover_amount: number;
  cover_redeemed: number;
  cover_balance: number;
  reservation_status: ReservationLedgerStatus;
  cover_status: CoverStatus;
}

/**
 * Full ledger = summary fields + the per-row audit timelines.
 * Same outer shape as ReservationSummary so the same client component
 * (ReservationSummaryCard) can consume either without branching.
 */
export interface ReservationLedger extends ReservationSummary {
  checkins: CheckinRow[];
  redemptions: RedemptionRow[];
}

function buildDisplayCode(id: string): string {
  const tail = (id || '').replace(/[^a-zA-Z0-9]/g, '').slice(-4).toUpperCase();
  return tail ? `RES-${tail}` : 'RES-—';
}

export function getReservationSummary(reservationId: string): ReservationSummary | null {
  const db = getDb();
  // LEFT JOIN events so reservations without an event_id (or with a stale
  // event_id) still resolve — the join column just comes back null.
  const row = db
    .prepare(
      `SELECT r.id, r.name, r.phone, r.event_id, r.event_date,
              r.pax, r.total_pax, r.checked_in_pax,
              r.entry_amount, r.cover_amount, r.cover_redeemed,
              r.reservation_status,
              e.name AS event_name
         FROM reservations r
         LEFT JOIN events e ON e.id = r.event_id
        WHERE r.id = ?`,
    )
    .get(reservationId) as
    | {
        id: string;
        name: string;
        phone: string;
        event_id: string | null;
        event_date: string | null;
        pax: number;
        total_pax: number | null;
        checked_in_pax: number | null;
        entry_amount: number | null;
        cover_amount: number | null;
        cover_redeemed: number | null;
        reservation_status: string | null;
        event_name: string | null;
      }
    | undefined;
  if (!row) return null;
  const totalPax = row.total_pax && row.total_pax > 0 ? row.total_pax : row.pax;
  const checkedInPax = row.checked_in_pax ?? 0;
  const coverAmount = Number(row.cover_amount ?? 0);
  const coverRedeemed = Number(row.cover_redeemed ?? 0);
  const currentStatus = (row.reservation_status as ReservationLedgerStatus | null) ?? 'pending';
  const reservationStatus = computeReservationStatus({
    totalPax,
    checkedInPax,
    currentStatus,
  });

  return {
    reservation_id: row.id,
    display_code: buildDisplayCode(row.id),
    guest_name: row.name,
    guest_phone: row.phone ?? null,
    event_id: row.event_id,
    event_name: row.event_name ?? null,
    event_date: row.event_date,
    total_pax: totalPax,
    checked_in_pax: checkedInPax,
    remaining_pax: Math.max(0, totalPax - checkedInPax),
    entry_amount: Number(row.entry_amount ?? 0),
    cover_amount: coverAmount,
    cover_redeemed: coverRedeemed,
    cover_balance: Math.max(0, coverAmount - coverRedeemed),
    reservation_status: reservationStatus,
    cover_status: computeCoverStatus({ coverAmount, coverRedeemed }),
  };
}

/**
 * Full ledger snapshot for a reservation — summary fields plus check-in
 * and redemption arrays. Returns null when the reservation doesn't exist.
 *
 * Implementation note: we delegate to getReservationSummary so the join +
 * status derivation logic lives in exactly one place. The minor cost is one
 * extra SELECT compared to inlining; that's fine — this is a manager audit
 * path, not the hot scan loop.
 */
export function getReservationLedger(reservationId: string): ReservationLedger | null {
  const summary = getReservationSummary(reservationId);
  if (!summary) return null;
  // Touch the state helpers so any future invariants they enforce (e.g. cache
  // invalidation, side-effect logging) keep firing on the ledger read path.
  getCheckinState(reservationId);
  getRedemptionState(reservationId);
  return {
    ...summary,
    checkins: listCheckins(reservationId),
    redemptions: listRedemptions(reservationId),
  };
}
