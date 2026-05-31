import { NextRequest, NextResponse } from 'next/server';
import { verifyWalletViewToken } from '@/lib/signed-url';
import { lookupWallet } from '@/lib/wallet';
import { getDb } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { verifyCheckoutSignature } from '@/lib/razorpay';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PaymentRow {
  id: string;
  event_id: string;
  razorpay_order_id: string;
  razorpay_payment_id: string | null;
  amount: number;
  amount_paise: number;
  status: string;
  txn_id: string | null;
  verified_at: number | null;
  notes: string | null;
}

/**
 * POST /api/public/wallet/[token]/topup/verify
 *
 * PUBLIC, double-gated:
 *   1. HMAC wallet-view token must verify (prevents a stranger with a stolen
 *      Razorpay payload from crediting somebody else's wallet),
 *   2. Razorpay checkout signature must verify (prevents a token-holder from
 *      faking a payment payload to inflate their own balance for free).
 *
 * Idempotent on razorpay_payment_id: a re-submitted browser handler (flaky
 * network, page reload mid-flow) returns the already-credited balance with
 * `alreadyCaptured: true` instead of double-crediting.
 *
 * Cross-wallet replay defense: we require the payment row's txn_id (set at
 * /topup creation time) to equal the token's txnId. A mismatch means the
 * caller is trying to apply payment A to wallet B — 400 + loud audit.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const payload = verifyWalletViewToken(token);
  if (!payload) {
    return NextResponse.json({ ok: false, message: 'Invalid or expired link.' }, { status: 404 });
  }

  const body = await req.json().catch(() => ({})) as {
    razorpayOrderId?: unknown;
    razorpayPaymentId?: unknown;
    razorpaySignature?: unknown;
  };
  const orderId = String(body.razorpayOrderId || '').trim();
  const paymentId = String(body.razorpayPaymentId || '').trim();
  const signature = String(body.razorpaySignature || '').trim();
  if (!orderId || !paymentId || !signature) {
    return NextResponse.json(
      { ok: false, message: 'razorpayOrderId, razorpayPaymentId, razorpaySignature are required.' },
      { status: 400 },
    );
  }

  if (!verifyCheckoutSignature(orderId, paymentId, signature)) {
    logAudit({
      actor: 'public',
      action: 'wallet_topup_verify_signature_fail',
      entityType: 'payment',
      details: { txn_id: payload.txnId, razorpay_order_id: orderId, razorpay_payment_id: paymentId },
    });
    return NextResponse.json(
      { ok: false, message: 'Payment signature could not be verified.' },
      { status: 400 },
    );
  }

  const db = getDb();
  const payment = db.prepare(`
    SELECT id, event_id, razorpay_order_id, razorpay_payment_id,
           amount, amount_paise, status, txn_id, verified_at, notes
    FROM payments
    WHERE razorpay_order_id = ?
    LIMIT 1
  `).get(orderId) as PaymentRow | undefined;

  if (!payment) {
    return NextResponse.json(
      { ok: false, message: 'Payment record not found for this order.' },
      { status: 404 },
    );
  }

  // Kind guard — defence-in-depth against a regular booking payment being
  // replayed against /topup/verify. A full_cover booking ALSO stamps txn_id
  // (see /api/payments/verify around line 209) so the cross-wallet replay
  // guard below isn't enough on its own: an attacker with a valid view token
  // for the wallet issued by that booking could otherwise re-capture the
  // booking amount as a top-up, double-crediting cover_issued.
  let kind: string | undefined;
  try {
    kind = payment.notes ? (JSON.parse(payment.notes).kind as string | undefined) : undefined;
  } catch {
    kind = undefined;
  }
  if (kind !== 'wallet_topup') {
    logAudit({
      actor: 'public',
      action: 'wallet_topup_verify_wrong_kind',
      entityType: 'payment',
      entityId: payment.id,
      details: { txn_id: payload.txnId, kind, razorpay_order_id: orderId },
    });
    return NextResponse.json(
      { ok: false, message: 'Payment is not a wallet top-up.' },
      { status: 400 },
    );
  }

  // Cross-wallet replay guard: the payment row's txn_id was written at order
  // creation and must equal the token's txnId. Without this check, anyone
  // with a valid view token for wallet B could submit a captured Razorpay
  // payload from wallet A and inflate their balance.
  if (!payment.txn_id || payment.txn_id !== payload.txnId) {
    logAudit({
      actor: 'public',
      action: 'wallet_topup_token_payment_mismatch',
      entityType: 'payment',
      entityId: payment.id,
      details: {
        token_txn_id: payload.txnId,
        payment_txn_id: payment.txn_id,
        razorpay_order_id: orderId,
      },
    });
    return NextResponse.json(
      { ok: false, message: 'Payment does not belong to this wallet.' },
      { status: 400 },
    );
  }

  // ── Idempotent re-submit ──
  // Razorpay's browser handler can fire twice on flaky networks; we never
  // want to double-credit. If the order is already captured AND the payment
  // id matches what we saw the first time, return the current wallet balance
  // without touching anything.
  if (
    payment.status === 'captured'
    && payment.razorpay_payment_id
    && payment.razorpay_payment_id === paymentId
  ) {
    const fresh = lookupWallet(payload.txnId);
    return NextResponse.json({
      ok: true,
      alreadyCaptured: true,
      balance: fresh?.balance ?? 0,
      coverIssued: fresh?.cover_issued ?? 0,
    });
  }

  // Re-check status inside the transaction. Between order creation and
  // verify, the wallet's expires_at may have passed and sweepExpired() may
  // have flipped status to 'expired' — we still capture (Razorpay already
  // took the money) but the UPDATE's WHERE clause will no-op on cover_issued
  // / balance and we audit so an operator can refund manually.
  const wallet = lookupWallet(payload.txnId);
  if (!wallet) {
    return NextResponse.json({ ok: false, message: 'Wallet not found.' }, { status: 404 });
  }

  const balanceBefore = wallet.balance;
  const amountInr = payment.amount;
  const now = Date.now();

  const capture = db.transaction(() => {
    db.prepare(`
      UPDATE payments
      SET status = 'captured',
          razorpay_payment_id = ?,
          razorpay_signature = ?,
          verified_at = ?,
          updated_at = ?
      WHERE id = ?
    `).run(paymentId, signature, now, now, payment.id);

    // Status guard inside the WHERE clause — if the wallet became inactive
    // between order create + verify, this UPDATE matches zero rows and we
    // detect the situation below via the changes() count.
    const upd = db.prepare(`
      UPDATE wallets
      SET cover_issued = cover_issued + ?,
          balance = balance + ?
      WHERE txn_id = ? AND status = 'active'
    `).run(amountInr, amountInr, payload.txnId);

    return upd.changes;
  });
  const changed = capture();

  if (changed === 0) {
    // Payment captured but wallet was inactive at credit time — operator
    // owes a manual refund. Loud audit so this never gets buried.
    logAudit({
      actor: 'public',
      action: 'wallet_topup_after_inactive',
      entityType: 'payment',
      entityId: payment.id,
      details: {
        txn_id: payload.txnId,
        wallet_status: wallet.status,
        amount_inr: amountInr,
        razorpay_payment_id: paymentId,
      },
    });
    return NextResponse.json(
      {
        ok: false,
        message:
          'Top-up payment captured, but the wallet is no longer active. The venue will contact you to issue a refund.',
      },
      { status: 409 },
    );
  }

  const balanceAfter = balanceBefore + amountInr;
  const coverIssuedAfter = wallet.cover_issued + amountInr;

  logAudit({
    actor: 'public',
    action: 'wallet_topup_captured',
    entityType: 'wallet',
    entityId: payload.txnId,
    details: {
      payment_id: payment.id,
      razorpay_order_id: orderId,
      razorpay_payment_id: paymentId,
      amount: amountInr,
      balance_before: balanceBefore,
      balance_after: balanceAfter,
      cover_issued_after: coverIssuedAfter,
    },
  });

  return NextResponse.json({
    ok: true,
    balance: balanceAfter,
    coverIssued: coverIssuedAfter,
    topUpAmount: amountInr,
  });
}
