import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { verifyWebhookSignature } from '@/lib/razorpay';
import { trackEvent } from '@/lib/event-analytics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/payments/webhook — Razorpay-signed, async backup confirmation.
 *
 * The verify endpoint is the primary capture path (browser-driven). This
 * webhook is the safety net: if the customer closes their tab right after
 * paying, or their network drops before verify lands, Razorpay still hits
 * us here from their end so we can mark the payment captured.
 *
 * IMPORTANT: signature failures return 401, NOT 200. Razorpay won't retry
 * on auth failures (which is what we want — a forged payload should fail
 * fast). For *recognized* event types we always return 200, even when the
 * payment row is unknown (the order may have been created by a different
 * tenant or our DB was wiped); that way Razorpay doesn't endlessly retry
 * a payload we'll never process.
 *
 * Handled events:
 *   payment.captured → mark local payment captured if not already
 *   payment.failed   → mark failed + store error_code/error_description
 *
 * Other events are acknowledged with `{ ok: true, ignored: true }`.
 */
export async function POST(req: NextRequest) {
  // Must read the raw body — re-serializing would break the HMAC.
  const rawBody = await req.text();
  const signature = req.headers.get('x-razorpay-signature') || '';

  if (!verifyWebhookSignature(rawBody, signature)) {
    logAudit({
      actor: 'webhook:razorpay',
      action: 'payment_webhook_signature_fail',
      details: { has_signature: !!signature, body_len: rawBody.length },
    });
    // 401 = Razorpay stops retrying. This is the correct behavior for a
    // signature mismatch (forged or misconfigured-secret).
    return NextResponse.json({ ok: false, message: 'Invalid signature.' }, { status: 401 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false, message: 'Invalid JSON.' }, { status: 400 });
  }

  const eventType = String(payload?.event || '').trim();
  const entity = payload?.payload?.payment?.entity;
  const orderId = entity?.order_id ? String(entity.order_id) : '';
  const paymentId = entity?.id ? String(entity.id) : '';

  const db = getDb();
  const now = Date.now();

  // Always stamp received-at when we have an order id, even on ignored
  // events — useful for "did Razorpay reach us?" debugging.
  if (orderId) {
    db.prepare(`
      UPDATE payments
      SET webhook_received_at = ?, updated_at = ?
      WHERE razorpay_order_id = ?
    `).run(now, now, orderId);
  }

  if (eventType === 'payment.captured') {
    if (!orderId) {
      return NextResponse.json({ ok: true, ignored: true, reason: 'no_order_id' });
    }
    const existing = db.prepare(
      `SELECT id, status FROM payments WHERE razorpay_order_id = ? LIMIT 1`,
    ).get(orderId) as { id: string; status: string } | undefined;

    if (!existing) {
      // Unknown order — acknowledge so Razorpay stops retrying. Operator
      // will see the audit row.
      logAudit({
        actor: 'webhook:razorpay',
        action: 'payment_webhook_unknown_order',
        details: { event: eventType, razorpay_order_id: orderId, razorpay_payment_id: paymentId },
      });
      return NextResponse.json({ ok: true, ignored: true, reason: 'unknown_order' });
    }

    if (existing.status !== 'captured') {
      db.prepare(`
        UPDATE payments
        SET status = 'captured',
            razorpay_payment_id = COALESCE(razorpay_payment_id, ?),
            updated_at = ?
        WHERE id = ?
      `).run(paymentId || null, now, existing.id);

      logAudit({
        actor: 'webhook:razorpay',
        action: 'payment_webhook_captured',
        entityType: 'payment',
        entityId: existing.id,
        details: { razorpay_order_id: orderId, razorpay_payment_id: paymentId },
      });
    }
    // If already captured (verify route beat us), no-op but still 200.
    return NextResponse.json({ ok: true });
  }

  if (eventType === 'payment.failed') {
    if (!orderId) {
      return NextResponse.json({ ok: true, ignored: true, reason: 'no_order_id' });
    }
    // Pull event_id + notes alongside the row so we can fire a
    // checkout_failed analytics event with the originating session id.
    const existing = db.prepare(
      `SELECT id, status, event_id, notes FROM payments WHERE razorpay_order_id = ? LIMIT 1`,
    ).get(orderId) as { id: string; status: string; event_id: string; notes: string | null } | undefined;

    if (!existing) {
      return NextResponse.json({ ok: true, ignored: true, reason: 'unknown_order' });
    }

    const errorCode = entity?.error_code ? String(entity.error_code).slice(0, 100) : null;
    const errorDesc = entity?.error_description ? String(entity.error_description).slice(0, 500) : null;

    // Don't downgrade an already-captured payment to failed — that would be
    // a Razorpay-side race condition we'd rather investigate manually.
    if (existing.status !== 'captured') {
      db.prepare(`
        UPDATE payments
        SET status = 'failed',
            razorpay_payment_id = COALESCE(razorpay_payment_id, ?),
            error_code = ?,
            error_description = ?,
            updated_at = ?
        WHERE id = ?
      `).run(paymentId || null, errorCode, errorDesc, now, existing.id);
    }

    logAudit({
      actor: 'webhook:razorpay',
      action: 'payment_webhook_failed',
      entityType: 'payment',
      entityId: existing.id,
      details: {
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentId,
        error_code: errorCode,
        error_description: errorDesc,
      },
    });

    // Analytics: emit a checkout_failed funnel row so the Event Insights
    // dashboard captures Razorpay-side failures (decline, bank timeout, etc.)
    // — the verify route only sees signature-mismatch failures. Best-effort:
    // a bad event_id or rate-limit hit is silently dropped via trackEvent's
    // return-style API. Session id is parsed from payments.notes (planted by
    // /api/payments/order). When the order was created before the sessionId
    // round-trip shipped, we fall back to a synthetic 'server__webhook'
    // marker so the row still lands in the analytics table.
    if (existing.event_id) {
      let sid: string | undefined;
      try {
        sid = existing.notes
          ? (JSON.parse(existing.notes).sessionId as string | undefined)
          : undefined;
      } catch { /* malformed notes — fall back to server-side marker */ }
      trackEvent({
        eventId: existing.event_id,
        sessionId: sid || 'server__webhook',
        kind: 'checkout_failed',
        metadata: {
          source: 'webhook',
          errorCode,
          errorDescription: errorDesc,
        },
      });
    }

    return NextResponse.json({ ok: true });
  }

  // Unknown / unhandled event type — log lightly + 200 so Razorpay doesn't
  // retry forever.
  logAudit({
    actor: 'webhook:razorpay',
    action: 'payment_webhook_ignored',
    details: { event: eventType, razorpay_order_id: orderId },
  });
  return NextResponse.json({ ok: true, ignored: true });
}
