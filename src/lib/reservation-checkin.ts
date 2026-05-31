/**
 * Reservation check-in ledger.
 *
 * Part of the multi-stage check-in + cover redemption feature where a single
 * HMAC-signed QR per reservation is scanned at two stations: entry staff for
 * check-in (here) and captains for cover redemption (cover-redemption.ts).
 *
 * Everything that mutates state runs inside db.transaction() and re-reads
 * the reservation row from disk *inside* the transaction body. better-sqlite3
 * uses a single-writer model on WAL so the second of two concurrent scans
 * sees the updated counter and its validation fails with a 409 — no overshoot.
 *
 * Critical invariant: NEVER trust client-sent balances or counters. Every
 * decision (validate, compute new value) reads fresh from DB inside the tx.
 *
 * Server-side module — never import from a client component.
 */

import { nanoid } from 'nanoid';
import { getDb } from './db';
import { logAudit } from './audit';

export type ReservationLedgerStatus =
  | 'pending'
  | 'partially_checked_in'
  | 'fully_checked_in'
  | 'closed';

export interface CheckinRow {
  id: string;
  reservation_id: string;
  /** Positive on a normal check-in; negative on an auto-reversal entry. */
  checked_in_pax: number;
  checked_in_by: string;
  notes: string | null;
  status: 'success' | 'reversed';
  reversed_at: number | null;
  reversed_by: string | null;
  timestamp: number;
}

export interface CheckinState {
  total_pax: number;
  checked_in_pax: number;
  remaining_pax: number;
  reservation_status: ReservationLedgerStatus;
}

/**
 * Compute the ledger reservation_status from counters. Pure function — the
 * caller is responsible for persisting the returned value. Never auto-flips
 * a row out of 'closed'; closed is terminal until a manager explicitly
 * reopens (out of scope for v1).
 */
export function computeReservationStatus(args: {
  totalPax: number;
  checkedInPax: number;
  currentStatus: ReservationLedgerStatus;
}): ReservationLedgerStatus {
  if (args.currentStatus === 'closed') return 'closed';
  if (args.checkedInPax <= 0) return 'pending';
  if (args.checkedInPax >= args.totalPax) return 'fully_checked_in';
  return 'partially_checked_in';
}

/**
 * Snapshot of the check-in counters for a reservation. Used by the QR scan
 * landing card and as a building block for the full ledger summary.
 *
 * Returns null when the reservation_id does not exist.
 */
export function getCheckinState(reservationId: string): CheckinState | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT pax, total_pax, checked_in_pax, reservation_status
         FROM reservations
        WHERE id = ?`,
    )
    .get(reservationId) as
    | { pax: number; total_pax: number | null; checked_in_pax: number | null; reservation_status: string | null }
    | undefined;
  if (!row) return null;
  // total_pax was backfilled from pax on migrate, but defend against rows
  // that slipped through (e.g. inserts that pre-date the backfill in the
  // same process boot). Fall back to pax which is always populated.
  const totalPax = row.total_pax && row.total_pax > 0 ? row.total_pax : row.pax;
  const checkedInPax = row.checked_in_pax ?? 0;
  const reservationStatus = (row.reservation_status as ReservationLedgerStatus | null) ?? 'pending';
  return {
    total_pax: totalPax,
    checked_in_pax: checkedInPax,
    remaining_pax: Math.max(0, totalPax - checkedInPax),
    reservation_status: reservationStatus,
  };
}

export interface CheckinSuccess {
  ok: true;
  checkinId: string;
  newCheckedInPax: number;
  remainingPax: number;
  reservationStatus: ReservationLedgerStatus;
}

export interface CheckinFailure {
  ok: false;
  reason:
    | 'not_found'
    | 'closed'
    | 'fully_checked_in'
    | 'cancelled'
    | 'no_show'
    | 'invalid_count'
    | 'overcount';
  message: string;
}

export type CheckinResult = CheckinSuccess | CheckinFailure;

/**
 * Check guests in against a reservation. Atomic + race-safe — concurrent
 * calls serialize via the better-sqlite3 single-writer model and the second
 * tx sees the freshly-updated counter, so two devices can't double-count
 * the last seat.
 */
export function checkInGuests(input: {
  reservationId: string;
  count: number;
  actor: string;
  notes?: string | null;
}): CheckinResult {
  const db = getDb();
  const count = Math.floor(Number(input.count));
  if (!Number.isFinite(count) || count <= 0) {
    return { ok: false, reason: 'invalid_count', message: 'Guest count must be a positive integer.' };
  }

  const sel = db.prepare(
    `SELECT id, pax, total_pax, checked_in_pax, reservation_status, status
       FROM reservations WHERE id = ?`,
  );
  const upd = db.prepare(
    `UPDATE reservations
        SET checked_in_pax = ?,
            reservation_status = ?,
            -- Self-heal pre-migration rows: any row whose total_pax was
            -- never written by the application layer (still 0/NULL) gets
            -- mirrored from pax the first time it's touched. Rows that
            -- already have a positive total_pax are left untouched.
            total_pax = COALESCE(NULLIF(total_pax, 0), pax)
      WHERE id = ?`,
  );
  const ins = db.prepare(
    `INSERT INTO reservation_checkins
       (id, reservation_id, checked_in_pax, checked_in_by, notes, status, timestamp)
     VALUES (?, ?, ?, ?, ?, 'success', ?)`,
  );

  let result: CheckinResult = {
    ok: false,
    reason: 'not_found',
    message: 'Reservation not found.',
  };

  const tx = db.transaction(() => {
    const row = sel.get(input.reservationId) as
      | {
          id: string;
          pax: number;
          total_pax: number | null;
          checked_in_pax: number | null;
          reservation_status: string | null;
          status: string;
        }
      | undefined;
    if (!row) {
      result = { ok: false, reason: 'not_found', message: 'Reservation not found.' };
      return;
    }
    // Booking-lifecycle guards. Cancelled / no-show reservations should never
    // pass through the door regardless of pax counters.
    if (row.status === 'cancelled') {
      result = { ok: false, reason: 'cancelled', message: 'Reservation is cancelled.' };
      return;
    }
    if (row.status === 'no_show') {
      result = { ok: false, reason: 'no_show', message: 'Reservation marked as no-show.' };
      return;
    }
    const currentStatus = (row.reservation_status as ReservationLedgerStatus | null) ?? 'pending';
    if (currentStatus === 'closed') {
      result = { ok: false, reason: 'closed', message: 'Reservation is closed.' };
      return;
    }
    const totalPax = row.total_pax && row.total_pax > 0 ? row.total_pax : row.pax;
    const checkedInPax = row.checked_in_pax ?? 0;
    if (checkedInPax >= totalPax) {
      result = {
        ok: false,
        reason: 'fully_checked_in',
        message: 'All guests already checked in.',
      };
      return;
    }
    const remaining = totalPax - checkedInPax;
    if (count > remaining) {
      result = {
        ok: false,
        reason: 'overcount',
        message: `Only ${remaining} guest(s) remaining for this reservation.`,
      };
      return;
    }

    const newCheckedInPax = checkedInPax + count;
    const newStatus = computeReservationStatus({
      totalPax,
      checkedInPax: newCheckedInPax,
      currentStatus,
    });

    upd.run(newCheckedInPax, newStatus, input.reservationId);
    const checkinId = nanoid();
    ins.run(checkinId, input.reservationId, count, input.actor, input.notes?.trim() || null, Date.now());

    logAudit({
      actor: input.actor,
      action: 'reservation_checkin',
      entityType: 'reservation',
      entityId: input.reservationId,
      details: {
        checkin_id: checkinId,
        count,
        before: checkedInPax,
        after: newCheckedInPax,
        total_pax: totalPax,
        reservation_status: newStatus,
        notes: input.notes?.trim() || null,
      },
    });

    result = {
      ok: true,
      checkinId,
      newCheckedInPax,
      remainingPax: totalPax - newCheckedInPax,
      reservationStatus: newStatus,
    };
  });
  tx();
  return result;
}

/**
 * Returns every check-in entry for a reservation, newest first. Includes
 * reversed rows so the UI can show the full ledger history.
 */
export function listCheckins(reservationId: string): CheckinRow[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM reservation_checkins
        WHERE reservation_id = ?
        ORDER BY timestamp DESC`,
    )
    .all(reservationId) as CheckinRow[];
}

export interface ReverseCheckinSuccess {
  ok: true;
  newCheckedInPax: number;
  reservationStatus: ReservationLedgerStatus;
}

export interface ReverseCheckinFailure {
  ok: false;
  reason: 'not_found' | 'already_reversed' | 'underflow';
  message: string;
}

export type ReverseCheckinResult = ReverseCheckinSuccess | ReverseCheckinFailure;

/**
 * Reverse a previously-recorded check-in. Manager / host only — the API
 * layer is responsible for the role gate. Decrements the reservation
 * counter and recomputes reservation_status inside the same tx, then marks
 * the original ledger row as reversed.
 *
 * IDOR guard: `reservationId` MUST be passed by the caller and we re-select
 * the checkin row with `WHERE id = ? AND reservation_id = ?`. Without this
 * a manager could pass a checkinId belonging to reservation A while POSTing
 * to URL of reservation B — the lib would happily reverse against A but the
 * UI would refresh B. Same pattern in reverseRedemption.
 */
export function reverseCheckin(input: {
  checkinId: string;
  reservationId: string;
  actor: string;
  reason?: string | null;
}): ReverseCheckinResult {
  const db = getDb();
  const selCheckin = db.prepare(
    `SELECT id, reservation_id, checked_in_pax, status
       FROM reservation_checkins WHERE id = ? AND reservation_id = ?`,
  );
  const selRes = db.prepare(
    `SELECT id, pax, total_pax, checked_in_pax, reservation_status FROM reservations WHERE id = ?`,
  );
  const updRes = db.prepare(
    `UPDATE reservations SET checked_in_pax = ?, reservation_status = ? WHERE id = ?`,
  );
  const updCheckin = db.prepare(
    `UPDATE reservation_checkins SET status = 'reversed', reversed_at = ?, reversed_by = ? WHERE id = ?`,
  );

  let result: ReverseCheckinResult = {
    ok: false,
    reason: 'not_found',
    message: 'Check-in entry not found.',
  };

  const tx = db.transaction(() => {
    const ck = selCheckin.get(input.checkinId, input.reservationId) as
      | { id: string; reservation_id: string; checked_in_pax: number; status: string }
      | undefined;
    if (!ck) {
      result = {
        ok: false,
        reason: 'not_found',
        message: 'Check-in not found for this reservation.',
      };
      return;
    }
    if (ck.status !== 'success') {
      result = { ok: false, reason: 'already_reversed', message: 'Check-in already reversed.' };
      return;
    }
    const res = selRes.get(ck.reservation_id) as
      | {
          id: string;
          pax: number;
          total_pax: number | null;
          checked_in_pax: number | null;
          reservation_status: string | null;
        }
      | undefined;
    if (!res) {
      result = { ok: false, reason: 'not_found', message: 'Reservation not found.' };
      return;
    }
    const totalPax = res.total_pax && res.total_pax > 0 ? res.total_pax : res.pax;
    const currentCheckedIn = res.checked_in_pax ?? 0;
    const newCheckedIn = currentCheckedIn - ck.checked_in_pax;
    if (newCheckedIn < 0) {
      result = {
        ok: false,
        reason: 'underflow',
        message: 'Reversing would underflow check-in counter.',
      };
      return;
    }
    const currentStatus = (res.reservation_status as ReservationLedgerStatus | null) ?? 'pending';
    const newStatus = computeReservationStatus({
      totalPax,
      checkedInPax: newCheckedIn,
      currentStatus,
    });

    updRes.run(newCheckedIn, newStatus, ck.reservation_id);
    updCheckin.run(Date.now(), input.actor, ck.id);

    logAudit({
      actor: input.actor,
      action: 'reservation_checkin_reverse',
      entityType: 'reservation',
      entityId: ck.reservation_id,
      details: {
        checkin_id: ck.id,
        reversed_pax: ck.checked_in_pax,
        before: currentCheckedIn,
        after: newCheckedIn,
        total_pax: totalPax,
        reservation_status: newStatus,
        reason: input.reason?.trim() || null,
      },
    });

    result = {
      ok: true,
      newCheckedInPax: newCheckedIn,
      reservationStatus: newStatus,
    };
  });
  tx();
  return result;
}

/**
 * Manager / host action — flip the ledger status to 'closed', blocking any
 * further check-in or redemption. Idempotent: closing a closed reservation
 * is a no-op success.
 */
export function setReservationClosed(input: {
  reservationId: string;
  actor: string;
  reason?: string | null;
}): { ok: true; reservationStatus: 'closed' } | { ok: false; reason: 'not_found'; message: string } {
  const db = getDb();
  const sel = db.prepare(
    `SELECT id, reservation_status FROM reservations WHERE id = ?`,
  );
  const upd = db.prepare(
    `UPDATE reservations SET reservation_status = 'closed' WHERE id = ?`,
  );

  let result:
    | { ok: true; reservationStatus: 'closed' }
    | { ok: false; reason: 'not_found'; message: string } = {
    ok: false,
    reason: 'not_found',
    message: 'Reservation not found.',
  };

  const tx = db.transaction(() => {
    const row = sel.get(input.reservationId) as
      | { id: string; reservation_status: string | null }
      | undefined;
    if (!row) {
      result = { ok: false, reason: 'not_found', message: 'Reservation not found.' };
      return;
    }
    if (row.reservation_status !== 'closed') {
      upd.run(input.reservationId);
      logAudit({
        actor: input.actor,
        action: 'reservation_close',
        entityType: 'reservation',
        entityId: input.reservationId,
        details: {
          previous_status: row.reservation_status ?? 'pending',
          reason: input.reason?.trim() || null,
        },
      });
    }
    result = { ok: true, reservationStatus: 'closed' };
  });
  tx();
  return result;
}
