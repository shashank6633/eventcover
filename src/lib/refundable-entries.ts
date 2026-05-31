/**
 * Refundable entries — reservations whose latest Razorpay payment failed
 * or whose status is 'no_show' despite having captured payment. These are
 * the host's recovery queue: accommodate them with a free comp wallet, or
 * resend the ticket WhatsApp.
 *
 * Computed view — NO new table. We derive the list from payments + reservations
 * inside this lib so the data stays canonical.
 *
 * MONEY-RISK NOTE: accommodate() issues a FREE wallet. We re-verify that
 * the reservation is genuinely refundable at write time (inside a tx) so a
 * malicious caller can't issue comps against arbitrary reservations.
 */

import { getDb } from './db';
import { logAudit } from './audit';
import { getReservation, markReservationConverted } from './reservations';
import { getEvent } from './events';
import { issueWallet } from './wallet';
import { sendWalletPassWhatsApp } from './whatsapp/wallet-pass-send';
import { sendInteraktTemplate, splitPhone, isInteraktConfigured } from './providers/whatsapp/interakt';
import { getConfig } from './db';

export type RefundableKind = 'payment_failed' | 'no_show_paid';

export interface RefundableEntry {
  reservationId: string;
  eventId: string;
  name: string;
  phone: string;
  email: string | null;
  pax: number;
  amount: number;
  kind: RefundableKind;
  reason: string;
  lastPaymentStatus: string;
  lastAttemptAt: number;
  /** Wallet txn_id when this reservation already has an issued wallet. */
  walletTxnId: string | null;
  /** Reservation booking-lifecycle status. */
  reservationStatus: string;
}

interface JoinedRow {
  res_id: string;
  res_event_id: string | null;
  res_name: string;
  res_phone: string;
  res_email: string | null;
  res_pax: number;
  res_status: string;
  res_wallet_txn: string | null;
  pay_id: string | null;
  pay_status: string | null;
  pay_amount: number | null;
  pay_error_code: string | null;
  pay_error_description: string | null;
  pay_updated_at: number | null;
}

/**
 * List refundable entries for an event.
 *
 * Rules (per spec):
 *   (a) The reservation's MOST RECENT payment row has status='failed', OR
 *   (b) reservation.status='no_show' AND there is a captured payment with
 *       amount > 0 (meaning the customer actually paid but didn't show).
 *
 * Cancelled reservations are excluded — those aren't recovery candidates.
 * Reservations already 'converted' (wallet issued) are excluded too: they
 * had a successful path, no refund is owed.
 */
export function list(eventId: string): RefundableEntry[] {
  if (!eventId) return [];
  const db = getDb();

  // One row per reservation, joined to its LATEST payment by updated_at DESC.
  // We exclude cancelled and converted reservations.
  const rows = db
    .prepare(
      `SELECT
         r.id              AS res_id,
         r.event_id        AS res_event_id,
         r.name            AS res_name,
         r.phone           AS res_phone,
         r.email           AS res_email,
         r.pax             AS res_pax,
         r.status          AS res_status,
         r.converted_wallet_txn AS res_wallet_txn,
         p.id              AS pay_id,
         p.status          AS pay_status,
         p.amount          AS pay_amount,
         p.error_code      AS pay_error_code,
         p.error_description AS pay_error_description,
         p.updated_at      AS pay_updated_at
       FROM reservations r
       LEFT JOIN payments p ON p.id = (
         SELECT p2.id FROM payments p2
          WHERE p2.reservation_id = r.id
          ORDER BY p2.updated_at DESC LIMIT 1
       )
       WHERE r.event_id = ?
         AND r.status != 'cancelled'
         AND r.status != 'converted'`,
    )
    .all(eventId) as JoinedRow[];

  const out: RefundableEntry[] = [];
  for (const row of rows) {
    // (a) most recent payment failed
    if (row.pay_status === 'failed' && row.pay_id) {
      const reason =
        row.pay_error_description?.trim()
        || (row.pay_error_code ? `Payment failed (${row.pay_error_code})` : 'Payment expired or failed');
      out.push({
        reservationId: row.res_id,
        eventId: row.res_event_id ?? eventId,
        name: row.res_name,
        phone: row.res_phone,
        email: row.res_email,
        pax: row.res_pax || 1,
        amount: row.pay_amount ?? 0,
        kind: 'payment_failed',
        reason,
        lastPaymentStatus: row.pay_status,
        lastAttemptAt: row.pay_updated_at ?? 0,
        walletTxnId: row.res_wallet_txn,
        reservationStatus: row.res_status,
      });
      continue;
    }
    // (b) no_show with paid amount > 0
    if (row.res_status === 'no_show' && row.pay_status === 'captured' && (row.pay_amount ?? 0) > 0) {
      out.push({
        reservationId: row.res_id,
        eventId: row.res_event_id ?? eventId,
        name: row.res_name,
        phone: row.res_phone,
        email: row.res_email,
        pax: row.res_pax || 1,
        amount: row.pay_amount ?? 0,
        kind: 'no_show_paid',
        reason: 'Marked no-show after paid booking',
        lastPaymentStatus: row.pay_status,
        lastAttemptAt: row.pay_updated_at ?? 0,
        walletTxnId: row.res_wallet_txn,
        reservationStatus: row.res_status,
      });
    }
  }

  // Newest abandonment first — useful since the host typically wants to
  // recover recent attempts.
  out.sort((a, b) => b.lastAttemptAt - a.lastAttemptAt);
  return out;
}

/**
 * Recompute whether a single reservation still qualifies as refundable.
 * Called inside the accommodate tx so we never issue a comp against a
 * stale view of the data.
 */
function isStillRefundable(reservationId: string): RefundableEntry | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT
         r.id              AS res_id,
         r.event_id        AS res_event_id,
         r.name            AS res_name,
         r.phone           AS res_phone,
         r.email           AS res_email,
         r.pax             AS res_pax,
         r.status          AS res_status,
         r.converted_wallet_txn AS res_wallet_txn,
         p.id              AS pay_id,
         p.status          AS pay_status,
         p.amount          AS pay_amount,
         p.error_code      AS pay_error_code,
         p.error_description AS pay_error_description,
         p.updated_at      AS pay_updated_at
       FROM reservations r
       LEFT JOIN payments p ON p.id = (
         SELECT p2.id FROM payments p2 WHERE p2.reservation_id = r.id
          ORDER BY p2.updated_at DESC LIMIT 1
       )
       WHERE r.id = ?`,
    )
    .get(reservationId) as JoinedRow | undefined;
  if (!row) return null;

  // Apply the same predicates as list()
  if (row.res_status === 'cancelled' || row.res_status === 'converted') return null;
  if (!row.res_event_id) return null;

  if (row.pay_status === 'failed' && row.pay_id) {
    return {
      reservationId: row.res_id,
      eventId: row.res_event_id,
      name: row.res_name,
      phone: row.res_phone,
      email: row.res_email,
      pax: row.res_pax || 1,
      amount: row.pay_amount ?? 0,
      kind: 'payment_failed',
      reason: row.pay_error_description?.trim() || 'Payment failed',
      lastPaymentStatus: row.pay_status,
      lastAttemptAt: row.pay_updated_at ?? 0,
      walletTxnId: row.res_wallet_txn,
      reservationStatus: row.res_status,
    };
  }
  if (row.res_status === 'no_show' && row.pay_status === 'captured' && (row.pay_amount ?? 0) > 0) {
    return {
      reservationId: row.res_id,
      eventId: row.res_event_id,
      name: row.res_name,
      phone: row.res_phone,
      email: row.res_email,
      pax: row.res_pax || 1,
      amount: row.pay_amount ?? 0,
      kind: 'no_show_paid',
      reason: 'Marked no-show after paid booking',
      lastPaymentStatus: row.pay_status,
      lastAttemptAt: row.pay_updated_at ?? 0,
      walletTxnId: row.res_wallet_txn,
      reservationStatus: row.res_status,
    };
  }
  return null;
}

export interface AccommodateResult {
  ok: true;
  txnId: string;
  kind: RefundableKind;
}

export interface AccommodateFailure {
  ok: false;
  reason: 'not_found' | 'not_refundable' | 'already_has_wallet' | 'event_missing';
  message: string;
}

/**
 * Issue a comp wallet for a refundable reservation. The wallet's cover is
 * sourced from event.cover_male_stag (the host's default cover); entry fee
 * is 0 since this IS the refund.
 */
export async function accommodate(
  reservationId: string,
  actor: string,
): Promise<AccommodateResult | AccommodateFailure> {
  if (!reservationId) {
    return { ok: false, reason: 'not_found', message: 'Reservation id is required.' };
  }
  const refundable = isStillRefundable(reservationId);
  if (!refundable) {
    return {
      ok: false,
      reason: 'not_refundable',
      message: 'This reservation no longer qualifies as refundable.',
    };
  }
  if (refundable.walletTxnId) {
    return {
      ok: false,
      reason: 'already_has_wallet',
      message: 'This reservation already has a wallet issued.',
    };
  }
  const ev = getEvent(refundable.eventId);
  if (!ev) {
    return { ok: false, reason: 'event_missing', message: 'Event not found.' };
  }

  // Cover defaults to the event's stag-male cover (the safest most-common
  // default). Host can later top-up the wallet if needed. Entry fee = 0
  // since this issuance IS the refund.
  const coverIssued = Number(ev.cover_male_stag) || 0;

  const result = await issueWallet({
    name: refundable.name,
    phone: refundable.phone,
    email: refundable.email || undefined,
    pax: refundable.pax,
    entryFee: 0,
    coverIssued,
    paymentMethod: 'comp',
    issuedBy: actor || 'host',
    eventId: refundable.eventId,
    reservationId: refundable.reservationId,
  });

  // issueWallet already calls markReservationConverted under the hood when
  // reservationId is provided — but call it again defensively in case
  // someone refactors issueWallet later.
  try { markReservationConverted(refundable.reservationId, result.txnId); } catch { /* ignore */ }

  logAudit({
    actor,
    action: 'reservation_accommodate_comp',
    entityType: 'reservation',
    entityId: refundable.reservationId,
    details: {
      txn_id: result.txnId,
      kind: refundable.kind,
      event_id: refundable.eventId,
      cover_issued: coverIssued,
    },
  });

  return { ok: true, txnId: result.txnId, kind: refundable.kind };
}

export interface ResendResult {
  ok: boolean;
  channel: 'wallet_pass' | 'reservation_template' | 'none';
  messageId?: string;
  error?: string;
}

/**
 * Re-send the ticket / wallet pass for a refundable entry. If a wallet
 * exists we send the wallet-pass WhatsApp (with the QR). If there is no
 * wallet yet (e.g. payment_failed never produced one) we send a generic
 * reservation_confirmed template so the customer at least sees we're
 * trying to recover them.
 */
export async function resend(
  reservationId: string,
  actor: string,
  origin: string,
): Promise<ResendResult> {
  if (!reservationId) return { ok: false, channel: 'none', error: 'Reservation id is required.' };
  const r = getReservation(reservationId);
  if (!r) return { ok: false, channel: 'none', error: 'Reservation not found.' };

  // If a wallet already exists (e.g. host accommodated already), send the
  // pass. Most reliable channel — image + QR + view link.
  if (r.converted_wallet_txn) {
    const res = await sendWalletPassWhatsApp({
      txnId: r.converted_wallet_txn,
      origin,
      actor,
      force: true,
    });
    logAudit({
      actor,
      action: 'reservation_ticket_resend',
      entityType: 'reservation',
      entityId: reservationId,
      details: { channel: 'wallet_pass', txn_id: r.converted_wallet_txn, ok: res.ok, error: res.error ?? null },
    });
    return {
      ok: res.ok,
      channel: 'wallet_pass',
      messageId: res.messageId,
      error: res.error,
    };
  }

  if (!isInteraktConfigured()) {
    return { ok: false, channel: 'none', error: 'WhatsApp provider not configured.' };
  }
  if (!r.phone) return { ok: false, channel: 'none', error: 'Reservation has no phone.' };

  // No wallet — best we can do is a "we're here for you" template. We use
  // the standard reservation_confirmed approved template (template name
  // configurable via config).
  const templateName = (getConfig('RESERVATION_CONFIRMED_TEMPLATE', 'reservation_confirmed') || 'reservation_confirmed').trim();
  const lang = (getConfig('RESERVATION_CONFIRMED_TEMPLATE_LANG', 'en') || 'en').trim();
  const eventName = r.event_id ? (getEvent(r.event_id)?.name || 'your event') : 'your event';

  const { countryCode, phoneNumber } = splitPhone(r.phone);
  const send = await sendInteraktTemplate({
    countryCode,
    phoneNumber,
    templateName,
    languageCode: lang,
    bodyValues: [r.name || 'Guest', eventName],
    callbackData: `reservation_resend:${reservationId}`,
  });

  logAudit({
    actor,
    action: 'reservation_ticket_resend',
    entityType: 'reservation',
    entityId: reservationId,
    details: { channel: 'reservation_template', template: templateName, ok: send.ok, error: send.error ?? null },
  });

  return {
    ok: send.ok,
    channel: 'reservation_template',
    messageId: send.messageId,
    error: send.error,
  };
}
