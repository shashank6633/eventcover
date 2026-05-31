/**
 * Razorpay payment gateway helper.
 *
 * Owns the three Razorpay-specific concerns so route handlers stay thin:
 *   1. Order creation — POST /v1/orders with Basic auth (keyId:keySecret)
 *   2. Checkout signature verify — the browser hands us back a signature
 *      from Razorpay Checkout; we HMAC-SHA256 it against keySecret
 *   3. Webhook signature verify — payloads are signed with the separate
 *      WEBHOOK_SECRET (NOT keySecret — different secret entirely)
 *
 * Amounts are passed in INR rupees externally but converted to integer paise
 * for Razorpay (the API rejects floats). All signature comparisons use
 * timingSafeEqual to avoid leaking secret bytes via timing.
 *
 * Reference: https://razorpay.com/docs/api/orders/
 */

import { createHmac, timingSafeEqual } from 'crypto';
import { getConfig } from './db';

const ORDERS_ENDPOINT = 'https://api.razorpay.com/v1/orders';
const PAYMENTS_ENDPOINT = 'https://api.razorpay.com/v1/payments';

export interface RazorpayConfig {
  mode: 'test' | 'live';
  keyId: string;
  keySecret: string;
  webhookSecret: string;
  /** true iff keyId AND keySecret are both set (webhookSecret is optional
   *  — webhooks are a fallback, not the primary flow). */
  isConfigured: boolean;
}

/**
 * Reads the four RAZORPAY_* config keys and returns a normalized snapshot.
 * `isConfigured` is the canonical "can we create orders?" check — route
 * handlers should bail out with a 503 when it's false.
 */
export function getRazorpayConfig(): RazorpayConfig {
  const modeRaw = getConfig('RAZORPAY_MODE', 'test').trim().toLowerCase();
  const mode: 'test' | 'live' = modeRaw === 'live' ? 'live' : 'test';
  const keyId = getConfig('RAZORPAY_KEY_ID', '').trim();
  const keySecret = getConfig('RAZORPAY_KEY_SECRET', '').trim();
  const webhookSecret = getConfig('RAZORPAY_WEBHOOK_SECRET', '').trim();
  return {
    mode,
    keyId,
    keySecret,
    webhookSecret,
    isConfigured: !!keyId && !!keySecret,
  };
}

// ─── Order creation ────────────────────────────────────────────────────────

export interface CreateOrderInput {
  /** INR rupees. Converted to integer paise internally (Razorpay rejects floats). */
  amount: number;
  /** Defaults to 'INR'. */
  currency?: string;
  /** Your local payment.id — surfaced as `receipt` on the Razorpay side for
   *  reconciliation. Max 40 chars per Razorpay docs. */
  receipt: string;
  /** Optional free-form key/value notes. Visible on the Razorpay Dashboard. */
  notes?: Record<string, string>;
}

export interface RazorpayOrder {
  /** 'order_XXX' identifier returned by Razorpay. */
  id: string;
  status: string;
  /** Paise (integer). */
  amount: number;
  currency: string;
  receipt: string;
}

export interface CreateOrderResult {
  ok: boolean;
  order?: RazorpayOrder;
  error?: string;
  status?: number;
}

/**
 * POST to Razorpay's Orders endpoint. Returns a normalized success/failure
 * envelope so callers never throw — same pattern as sendCapiEvent.
 *
 * payment_capture: 1 means Razorpay auto-captures the payment as soon as
 * it's authorized — we don't want a separate capture step.
 */
export async function createRazorpayOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
  const cfg = getRazorpayConfig();
  if (!cfg.isConfigured) {
    return { ok: false, error: 'Razorpay is not configured (RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET required).' };
  }

  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return { ok: false, error: 'amount must be a positive number (INR rupees).' };
  }
  // Round-then-floor would lose half-paise precision; Math.round is the
  // standard rupee→paise conversion. Razorpay rejects non-integer amounts.
  const amountPaise = Math.round(input.amount * 100);
  if (!Number.isInteger(amountPaise) || amountPaise < 1) {
    return { ok: false, error: 'Computed paise amount is invalid.' };
  }
  const receipt = String(input.receipt || '').slice(0, 40);
  if (!receipt) {
    return { ok: false, error: 'receipt is required.' };
  }

  const body = {
    amount: amountPaise,
    currency: input.currency || 'INR',
    receipt,
    notes: input.notes || {},
    payment_capture: 1,
  };

  const auth = Buffer.from(`${cfg.keyId}:${cfg.keySecret}`).toString('base64');

  try {
    const res = await fetch(ORDERS_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: unknown = text;
    try { parsed = JSON.parse(text); } catch { /* keep as text */ }

    if (!res.ok) {
      const errMsg =
        (parsed as { error?: { description?: string } })?.error?.description
        || `Razorpay returned ${res.status}`;
      return { ok: false, error: errMsg, status: res.status };
    }

    const o = parsed as { id?: string; status?: string; amount?: number; currency?: string; receipt?: string };
    if (!o.id) {
      return { ok: false, error: 'Razorpay response missing order id.', status: res.status };
    }
    return {
      ok: true,
      status: res.status,
      order: {
        id: o.id,
        status: o.status || 'created',
        amount: Number(o.amount) || amountPaise,
        currency: o.currency || body.currency,
        receipt: o.receipt || receipt,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'network_error',
    };
  }
}

// ─── Refunds ───────────────────────────────────────────────────────────────

export interface RazorpayRefund {
  /** 'rfnd_XXX' identifier returned by Razorpay. */
  id: string;
  /** 'created' | 'processed' | 'failed' — refund lifecycle. */
  status: string;
  /** Paise (integer). */
  amount: number;
  currency: string;
  /** Originating payment_id. */
  payment_id: string;
}

export interface RefundPaymentResult {
  ok: boolean;
  refund?: RazorpayRefund;
  error?: string;
  status?: number;
}

/**
 * Issue a refund against a captured payment.
 *
 * POSTs to Razorpay's /v1/payments/<id>/refund endpoint with Basic auth
 * (keyId:keySecret — same credentials as order creation). Amount is in
 * integer paise; pass the original payment amount for a full refund.
 *
 * Used by /api/payments/verify when a zone sells out between order +
 * verify — the customer's card was already charged, so we fire a refund
 * inline (the operator no longer has to do it manually from the
 * dashboard). Caller invokes this fire-and-forget; errors are swallowed
 * by the caller's .catch() and surfaced via the audit log.
 *
 * Reference: https://razorpay.com/docs/api/refunds/#create-a-refund
 */
export async function refundPayment(
  razorpayPaymentId: string,
  amountPaise: number,
): Promise<RefundPaymentResult> {
  const cfg = getRazorpayConfig();
  if (!cfg.isConfigured) {
    return { ok: false, error: 'Razorpay is not configured.' };
  }
  if (!razorpayPaymentId || typeof razorpayPaymentId !== 'string') {
    return { ok: false, error: 'razorpayPaymentId is required.' };
  }
  if (!Number.isInteger(amountPaise) || amountPaise < 1) {
    return { ok: false, error: 'amountPaise must be a positive integer.' };
  }

  const url = `${PAYMENTS_ENDPOINT}/${encodeURIComponent(razorpayPaymentId)}/refund`;
  const auth = Buffer.from(`${cfg.keyId}:${cfg.keySecret}`).toString('base64');

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ amount: amountPaise }),
    });
    const text = await res.text();
    let parsed: unknown = text;
    try { parsed = JSON.parse(text); } catch { /* keep as text */ }

    if (!res.ok) {
      const errMsg =
        (parsed as { error?: { description?: string } })?.error?.description
        || `Razorpay returned ${res.status}`;
      return { ok: false, error: errMsg, status: res.status };
    }

    const r = parsed as {
      id?: string;
      status?: string;
      amount?: number;
      currency?: string;
      payment_id?: string;
    };
    if (!r.id) {
      return { ok: false, error: 'Razorpay response missing refund id.', status: res.status };
    }
    return {
      ok: true,
      status: res.status,
      refund: {
        id: r.id,
        status: r.status || 'created',
        amount: Number(r.amount) || amountPaise,
        currency: r.currency || 'INR',
        payment_id: r.payment_id || razorpayPaymentId,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'network_error',
    };
  }
}

// ─── Signature verification ────────────────────────────────────────────────

/**
 * Constant-time equality on two hex strings of the same length. Returns
 * false on length mismatch (timingSafeEqual would throw). Used for both
 * checkout and webhook signature comparisons so a malicious caller can't
 * brute-force the signature byte-by-byte via response timing.
 */
function safeHexEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Verify the signature Razorpay Checkout hands back to the browser on
 * success. The signed message is the literal string `${orderId}|${paymentId}`,
 * HMAC-SHA256'd with the keySecret (NOT the webhook secret).
 *
 * Returns false when Razorpay is not configured — callers should treat that
 * as a 503/misconfiguration, not a tampering attempt.
 */
export function verifyCheckoutSignature(orderId: string, paymentId: string, signature: string): boolean {
  const cfg = getRazorpayConfig();
  if (!cfg.keySecret) return false;
  if (!orderId || !paymentId || !signature) return false;

  const expected = createHmac('sha256', cfg.keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');

  return safeHexEqual(expected, signature.trim().toLowerCase());
}

/**
 * Verify the signature on a Razorpay webhook payload. The raw request body
 * must be passed verbatim — re-serializing the JSON will break the HMAC.
 *
 * Razorpay sends the signature in the `X-Razorpay-Signature` header (hex).
 * Uses the dedicated webhook secret, separate from the API key pair so
 * rotating one doesn't break the other.
 */
export function verifyWebhookSignature(rawBody: string, signature: string): boolean {
  const cfg = getRazorpayConfig();
  if (!cfg.webhookSecret) return false;
  if (!rawBody || !signature) return false;

  const expected = createHmac('sha256', cfg.webhookSecret)
    .update(rawBody)
    .digest('hex');

  return safeHexEqual(expected, signature.trim().toLowerCase());
}
