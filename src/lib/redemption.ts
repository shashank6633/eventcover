import { getDb } from './db';
import { verifyPin, generateRedemptionId } from './crypto';
import { logAudit } from './audit';
import { isExpired, formatExpiry } from './expiry';
import type { RedemptionWithGuest } from './types';

const PIN_MAX_ATTEMPTS = 3;
const PIN_LOCKOUT_MS = 5 * 60 * 1000;

export interface RedeemInput {
  txnId: string;
  pin: string;
  amount: number;
  captain: string;
  /** Free-text reference — invoice no, table no, KOT no, whatever the bar uses. */
  orderRef?: string;
  /** Free-text note captured at redemption time (e.g. "Cash and carry", "Comp bottle"). */
  notes?: string;
}

export interface RedeemResult {
  ok: boolean;
  message: string;
  balanceAfter?: number;
  amountRedeemed?: number;
  guestName?: string;
  attemptsLeft?: number;
  lockedForMinutes?: number;
}

export async function redeemWallet(input: RedeemInput): Promise<RedeemResult> {
  const db = getDb();

  const wallet = db.prepare(`
    SELECT w.*, g.name AS guest_name
    FROM wallets w
    JOIN guests g ON g.id = w.guest_id
    WHERE w.txn_id = ?
  `).get(input.txnId) as
    | { txn_id: string; balance: number; status: string; pin_hash: string;
        pin_fail_count: number; pin_locked_until: number | null;
        expires_at: number | null; guest_name: string }
    | undefined;

  if (!wallet) return { ok: false, message: 'Transaction not found.' };

  if (wallet.status === 'active' && isExpired(wallet.expires_at)) {
    db.prepare("UPDATE wallets SET status = 'expired' WHERE txn_id = ?").run(input.txnId);
    logAudit({
      actor: input.captain, action: 'redeem_blocked_expired',
      entityType: 'wallet', entityId: input.txnId,
      details: { expires_at: wallet.expires_at },
    });
    return {
      ok: false,
      message: `Wallet expired at ${formatExpiry(wallet.expires_at)}. Cannot redeem.`,
    };
  }

  if (wallet.status !== 'active') {
    return { ok: false, message: `Wallet is ${wallet.status}. Cannot redeem.` };
  }

  const now = Date.now();
  if (wallet.pin_locked_until && wallet.pin_locked_until > now) {
    const mins = Math.ceil((wallet.pin_locked_until - now) / 60000);
    return { ok: false, message: `PIN locked. Try again in ${mins} min.`, lockedForMinutes: mins };
  }

  const pinOk = await verifyPin(input.pin, wallet.pin_hash);
  if (!pinOk) {
    const fails = (wallet.pin_fail_count || 0) + 1;
    const lockUntil = fails >= PIN_MAX_ATTEMPTS ? now + PIN_LOCKOUT_MS : null;
    db.prepare(`UPDATE wallets SET pin_fail_count = ?, pin_locked_until = ? WHERE txn_id = ?`)
      .run(fails, lockUntil, input.txnId);
    logAudit({
      actor: input.captain, action: 'pin_fail',
      entityType: 'wallet', entityId: input.txnId, details: { attempt: fails },
    });
    if (lockUntil) {
      logAudit({
        actor: input.captain, action: 'pin_lockout',
        entityType: 'wallet', entityId: input.txnId, details: { fails },
      });
      return { ok: false, message: 'Too many wrong attempts. Locked for 5 min.', lockedForMinutes: 5 };
    }
    return {
      ok: false,
      message: `Incorrect QR Code ID. ${PIN_MAX_ATTEMPTS - fails} attempt(s) left.`,
      attemptsLeft: PIN_MAX_ATTEMPTS - fails,
    };
  }

  let balanceAfterOut: number | undefined;
  let balanceBeforeOut: number | undefined;
  let insufficientBalance: number | null = null;

  const tx = db.transaction(() => {
    const fresh = db.prepare('SELECT balance, status, expires_at FROM wallets WHERE txn_id = ?')
      .get(input.txnId) as { balance: number; status: string; expires_at: number | null };

    if (isExpired(fresh.expires_at)) {
      db.prepare("UPDATE wallets SET status = 'expired' WHERE txn_id = ?").run(input.txnId);
      throw new Error('expired');
    }
    if (fresh.status !== 'active') {
      throw new Error('status_changed');
    }
    if (input.amount > fresh.balance) {
      insufficientBalance = fresh.balance;
      throw new Error('insufficient');
    }

    const balanceBefore = fresh.balance;
    const balanceAfter = Math.round((balanceBefore - input.amount) * 100) / 100;
    const newStatus = balanceAfter <= 0 ? 'exhausted' : 'active';

    db.prepare(`
      UPDATE wallets
      SET balance = ?, status = ?, pin_fail_count = 0, pin_locked_until = NULL
      WHERE txn_id = ?
    `).run(balanceAfter, newStatus, input.txnId);

    db.prepare(`
      INSERT INTO redemptions
        (id, txn_id, amount, balance_before, balance_after, captain, order_ref, notes, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'success', ?)
    `).run(
      generateRedemptionId(), input.txnId, input.amount,
      balanceBefore, balanceAfter, input.captain,
      input.orderRef || null, input.notes || null, now
    );

    balanceBeforeOut = balanceBefore;
    balanceAfterOut = balanceAfter;
  });

  try {
    tx();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'insufficient' && insufficientBalance !== null) {
      return { ok: false, message: `Insufficient balance. Remaining ₹${insufficientBalance}.` };
    }
    if (msg === 'expired') {
      return { ok: false, message: 'Wallet expired between lookup and redeem. Cannot redeem.' };
    }
    if (msg === 'status_changed') {
      return { ok: false, message: 'Wallet status changed. Refresh and retry.' };
    }
    return { ok: false, message: 'Transaction failed. Retry.' };
  }

  logAudit({
    actor: input.captain, action: 'redeem',
    entityType: 'wallet', entityId: input.txnId,
    details: {
      amount: input.amount,
      balance_before: balanceBeforeOut,
      balance_after: balanceAfterOut,
      order_ref: input.orderRef,
      notes: input.notes,
    },
  });

  return {
    ok: true,
    message: `Redeemed ₹${input.amount}. Remaining ₹${balanceAfterOut}.`,
    amountRedeemed: input.amount,
    balanceAfter: balanceAfterOut,
    guestName: wallet.guest_name,
  };
}

export function listRedemptions(limit = 200): RedemptionWithGuest[] {
  const db = getDb();
  return db.prepare(`
    SELECT r.*, g.name AS guest_name
    FROM redemptions r
    JOIN wallets w ON w.txn_id = r.txn_id
    JOIN guests g ON g.id = w.guest_id
    ORDER BY r.created_at DESC
    LIMIT ?
  `).all(limit) as RedemptionWithGuest[];
}
