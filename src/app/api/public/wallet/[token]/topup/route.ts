import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { verifyWalletViewToken } from '@/lib/signed-url';
import { lookupWallet } from '@/lib/wallet';
import { getDb, getConfig } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { getRazorpayConfig, createRazorpayOrder } from '@/lib/razorpay';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Hard caps on a single top-up. ₹100 floor avoids Razorpay's < ₹1 reject; the
// ₹10k ceiling is a sanity bound — a customer adding more cover than that in
// one go is almost always a typo (or a card-test attack).
const MIN_TOPUP_INR = 100;
const MAX_TOPUP_INR = 10000;

// ─── In-memory rate limit ──────────────────────────────────────────────────
// Cloned from /api/payments/order — 5 req/IP/10min. Top-up is a Razorpay
// order-create call: each one logs a row + hits Razorpay's API. We don't
// want a leaked view-token (90d TTL) turned into a card-test attack surface.
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

/**
 * POST /api/public/wallet/[token]/topup
 *
 * PUBLIC, signed-token gated. Body: { amount: number } (INR rupees).
 *
 * Creates a Razorpay order + persists a `payments` row in 'created' state
 * keyed to the wallet's txn_id (notes.kind = 'wallet_topup'). Returns the
 * bits the browser-side Razorpay Checkout SDK needs to open the modal.
 *
 * Status guards:
 *   - bad token              → 404
 *   - wallet missing         → 404
 *   - wallet not active      → 410 (exhausted / expired / voided)
 *   - razorpay not configured → 503
 *   - amount out of bounds   → 400
 *
 * Idempotency lives in /topup/verify, not here — we tolerate a stranded
 * 'created' payments row if the customer abandons checkout.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const ip = getClientIp(req);
  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { ok: false, message: 'Too many top-up attempts. Please wait a few minutes and try again.' },
      { status: 429 },
    );
  }

  const { token } = await ctx.params;
  const payload = verifyWalletViewToken(token);
  if (!payload) {
    return NextResponse.json({ ok: false, message: 'Invalid or expired link.' }, { status: 404 });
  }

  const body = await req.json().catch(() => ({})) as { amount?: unknown };
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount < MIN_TOPUP_INR || amount > MAX_TOPUP_INR) {
    return NextResponse.json(
      { ok: false, message: `Amount must be between ₹${MIN_TOPUP_INR} and ₹${MAX_TOPUP_INR}.` },
      { status: 400 },
    );
  }

  const cfg = getRazorpayConfig();
  if (!cfg.isConfigured) {
    return NextResponse.json(
      { ok: false, message: 'Top-up is not available right now.' },
      { status: 503 },
    );
  }

  const wallet = lookupWallet(payload.txnId);
  if (!wallet) {
    return NextResponse.json({ ok: false, message: 'Wallet not found.' }, { status: 404 });
  }
  if (wallet.status !== 'active') {
    // Exhausted / expired / voided / flagged — no top-up allowed. 410 (Gone)
    // tells the UI to swap the top-up button for a status banner.
    return NextResponse.json(
      { ok: false, message: `This wallet is ${wallet.status}; top-up is not available.`, status: wallet.status },
      { status: 410 },
    );
  }

  const walletEventId = (wallet as unknown as { event_id?: string | null }).event_id || '';

  const db = getDb();
  const paymentId = nanoid();
  const now = Date.now();
  const amountInr = amount;
  const amountPaise = Math.round(amountInr * 100);

  // Razorpay caps `receipt` at 40 chars; keep it readable for reconciliation.
  // Last 12 of the txn id + a base36 timestamp comfortably fit and stay
  // unique per call.
  const receipt = `wt_${wallet.txn_id.slice(-12)}_${now.toString(36)}`.slice(0, 40);

  // Insert the local row FIRST so a Razorpay failure still leaves an audit
  // trail. Use the same column shape as /api/payments/order — reservation_id
  // is null (top-ups have no reservation), payment_mode is null (we use the
  // notes JSON to distinguish top-up from booking payments), and the txn_id
  // is wired up front so the verify step can sanity-check token↔payment.
  const notesJson = JSON.stringify({ kind: 'wallet_topup', txn_id: wallet.txn_id });
  db.prepare(`
    INSERT INTO payments (
      id, reservation_id, event_id,
      razorpay_order_id, razorpay_payment_id, razorpay_signature,
      amount, amount_paise, currency, status,
      payer_name, payer_phone, payer_email, payment_mode,
      txn_id, notes, error_code, error_description,
      webhook_received_at, verified_at,
      created_at, updated_at
    ) VALUES (?, NULL, ?, '', NULL, NULL, ?, ?, 'INR', 'created',
              ?, ?, ?, NULL,
              ?, ?, NULL, NULL, NULL, NULL,
              ?, ?)
  `).run(
    paymentId,
    walletEventId || '',
    amountInr,
    amountPaise,
    wallet.name || null,
    wallet.phone || null,
    wallet.email || null,
    wallet.txn_id,
    notesJson,
    now,
    now,
  );

  const result = await createRazorpayOrder({
    amount: amountInr,
    currency: 'INR',
    receipt,
    notes: {
      kind: 'wallet_topup',
      txn_id: wallet.txn_id,
      event_id: walletEventId || '',
    },
  });

  if (!result.ok || !result.order) {
    db.prepare(`
      UPDATE payments SET status = 'failed', error_description = ?, updated_at = ?
      WHERE id = ?
    `).run(result.error || 'order_create_failed', Date.now(), paymentId);

    logAudit({
      actor: 'public',
      action: 'wallet_topup_order_failed',
      entityType: 'payment',
      entityId: paymentId,
      details: { txn_id: wallet.txn_id, error: result.error, status: result.status },
    });

    return NextResponse.json(
      { ok: false, message: 'Could not start top-up. Please try again.' },
      { status: 502 },
    );
  }

  db.prepare(`
    UPDATE payments SET razorpay_order_id = ?, updated_at = ? WHERE id = ?
  `).run(result.order.id, Date.now(), paymentId);

  logAudit({
    actor: 'public',
    action: 'wallet_topup_order_create',
    entityType: 'payment',
    entityId: paymentId,
    details: {
      txn_id: wallet.txn_id,
      amount_inr: amountInr,
      razorpay_order_id: result.order.id,
    },
  });

  const venueName = getConfig('VENUE_NAME', 'Venue');

  return NextResponse.json({
    ok: true,
    paymentId,
    // `orderId` is what the client component reads; `razorpayOrderId` is
    // kept as a redundant alias so any earlier consumer keeps working.
    orderId: result.order.id,
    razorpayOrderId: result.order.id,
    amount: amountPaise,
    currency: result.order.currency || 'INR',
    keyId: cfg.keyId,
    name: venueName,
    customer: {
      name: wallet.name || 'Guest',
      phone: wallet.phone || '',
      email: wallet.email || undefined,
    },
  });
}
