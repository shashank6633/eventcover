import { getDb, getConfig } from './db';
import { generatePin, hashPin, generateTxnId } from './crypto';
import { nanoid } from 'nanoid';
import { logAudit } from './audit';
import { computeExpiresAt } from './expiry';
import { attachWalletToTable } from './tables';
import { getEvent } from './events';
import { markReservationConverted } from './reservations';
import type { WalletWithGuest, PaymentMethod } from './types';

export interface IssueWalletInput {
  name: string;
  phone: string;
  email?: string;
  pax?: number;
  entryFee: number;
  coverIssued?: number;
  paymentMethod: PaymentMethod;
  issuedBy: string;
  tableId?: string;
  eventId?: string;
  reservationId?: string;
}

export interface IssueWalletResult {
  txnId: string;
  pin: string;
  guestId: string;
  balance: number;
  expiresAt: number;
}

export async function issueWallet(input: IssueWalletInput): Promise<IssueWalletResult> {
  const db = getDb();
  const venueName = getConfig('VENUE_NAME', 'Venue');
  const pinLength = Number(getConfig('PIN_LENGTH', '6')) || 6;

  // Prefer event-specific date + cutoff; fall back to global config for backward compat.
  let eventDate = getConfig('EVENT_DATE');
  let cutoffHour = Number(getConfig('EVENT_CUTOFF_HOUR', '2')) || 2;
  if (input.eventId) {
    const ev = getEvent(input.eventId);
    if (!ev) throw new Error(`Event ${input.eventId} not found`);
    eventDate = ev.event_date;
    cutoffHour = ev.cutoff_hour || cutoffHour;
  }
  if (!eventDate) {
    throw new Error('EVENT_DATE is not set in config.');
  }
  const expiresAt = computeExpiresAt(eventDate, cutoffHour);
  const coverIssued = input.coverIssued != null ? input.coverIssued : input.entryFee;

  const guestId = nanoid();
  const txnId = generateTxnId(venueName);
  const pin = generatePin(pinLength);
  const pinHash = await hashPin(pin);
  const now = Date.now();

  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO guests (id, name, phone, email, pax, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(guestId, input.name, input.phone, input.email || null, input.pax || 1, 'walk_in', now);

    db.prepare(`
      INSERT INTO wallets (
        txn_id, guest_id, entry_fee, cover_issued, balance,
        payment_method, pin_hash, status, issued_by, issued_at, expires_at,
        table_id, event_id, reservation_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)
    `).run(
      txnId, guestId, input.entryFee, coverIssued, coverIssued,
      input.paymentMethod, pinHash, input.issuedBy, now, expiresAt,
      input.tableId || null,
      input.eventId || null,
      input.reservationId || null,
    );
  });
  tx();

  if (input.tableId) {
    try { attachWalletToTable(input.tableId, txnId); } catch { /* table missing — ignore */ }
  }
  if (input.reservationId) {
    try { markReservationConverted(input.reservationId, txnId); } catch { /* ignore */ }
  }

  logAudit({
    actor: input.issuedBy,
    action: 'issue_wallet',
    entityType: 'wallet',
    entityId: txnId,
    details: {
      entry: input.entryFee, cover: coverIssued, pax: input.pax || 1,
      method: input.paymentMethod, guest: input.name,
      event_date: eventDate, expires_at: expiresAt,
      event_id: input.eventId || null, reservation_id: input.reservationId || null,
    },
  });

  return { txnId, pin, guestId, balance: coverIssued, expiresAt };
}

/**
 * Sweep stale active wallets whose expires_at has passed, marking them 'expired'.
 * Runs once per list/lookup call. Keeps DB state in sync with the clock.
 *
 * Auditing: each wallet that transitions active→expired writes a `wallet_expired`
 * audit row. The status change is silent to the customer but must be traceable so
 * the admin can answer "my cover was still alive when I tried to redeem" disputes.
 * Actor is logged as 'system' since no human triggered it.
 */
export function sweepExpired(): number {
  const db = getDb();
  const now = Date.now();
  const toExpire = db.prepare(`
    SELECT txn_id, balance, expires_at
    FROM wallets
    WHERE status = 'active'
      AND expires_at IS NOT NULL
      AND expires_at <= ?
  `).all(now) as { txn_id: string; balance: number; expires_at: number }[];

  if (toExpire.length === 0) return 0;

  const tx = db.transaction(() => {
    for (const w of toExpire) {
      db.prepare("UPDATE wallets SET status = 'expired' WHERE txn_id = ?").run(w.txn_id);
      logAudit({
        actor: 'system',
        action: 'wallet_expired',
        entityType: 'wallet',
        entityId: w.txn_id,
        details: { expires_at: w.expires_at, balance_at_expiry: w.balance },
      });
    }
  });
  tx();

  return toExpire.length;
}

/**
 * Void an active wallet — used by admin to refund / write off a cover.
 *
 * Forces balance to 0 and marks the wallet 'exhausted' (semantically "no longer
 * spendable"). Emits a critical `wallet_void` audit row so the action is
 * unmistakable on the History page. If a refund amount is recorded it's logged
 * in the details payload.
 *
 * Returns true if a state change happened, false if the wallet was already
 * inactive (no-op, no audit).
 */
export function voidWallet(
  txnId: string,
  actor: string,
  opts: { reason?: string; refundAmount?: number } = {},
): boolean {
  const db = getDb();
  const wallet = db.prepare(`
    SELECT balance, status, cover_issued, guest_id
    FROM wallets WHERE txn_id = ?
  `).get(txnId) as { balance: number; status: string; cover_issued: number; guest_id: string } | undefined;

  if (!wallet) return false;
  if (wallet.status !== 'active') return false;

  const balanceBefore = wallet.balance;

  db.prepare(`
    UPDATE wallets
    SET balance = 0, status = 'exhausted', pin_fail_count = 0, pin_locked_until = NULL
    WHERE txn_id = ?
  `).run(txnId);

  logAudit({
    actor,
    action: 'wallet_void',
    entityType: 'wallet',
    entityId: txnId,
    details: {
      balance_before: balanceBefore,
      balance_after: 0,
      cover_issued: wallet.cover_issued,
      refund_amount: opts.refundAmount ?? balanceBefore,
      reason: opts.reason ?? null,
    },
  });

  return true;
}

export function lookupWallet(txnId: string): WalletWithGuest | null {
  sweepExpired();
  const db = getDb();
  const row = db.prepare(`
    SELECT w.*, g.name, g.phone, g.email
    FROM wallets w
    JOIN guests g ON g.id = w.guest_id
    WHERE w.txn_id = ?
  `).get(txnId) as WalletWithGuest | undefined;
  return row ?? null;
}

export function listWallets(limit = 200): WalletWithGuest[] {
  sweepExpired();
  const db = getDb();
  return db.prepare(`
    SELECT w.*, g.name, g.phone, g.email
    FROM wallets w
    JOIN guests g ON g.id = w.guest_id
    ORDER BY w.issued_at DESC
    LIMIT ?
  `).all(limit) as WalletWithGuest[];
}
