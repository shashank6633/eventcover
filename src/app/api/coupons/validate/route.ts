import { NextRequest, NextResponse } from 'next/server';
import { validateCoupon } from '@/lib/coupons';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ─── Rate limit (separate quota from payments/order) ────────────────────────
// Coupon-code enumeration is a real concern — without rate limiting an
// attacker could brute-force common codes. 5 attempts per IP per 10 minutes,
// same window as the rest of the public surface. Map is process-local;
// periodic cleanup keeps it bounded.

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
 * POST /api/coupons/validate — PUBLIC, rate-limited.
 *
 * Body: { code, eventId, subtotal }
 *   - code:    customer-typed string (will be normalized server-side)
 *   - eventId: optional; matches event-scoped + venue-wide coupons
 *   - subtotal: INR rupees (number)
 *
 * Returns: { ok, discountAmount, finalAmount, code?, reason? }
 *
 * Pure preview — does NOT consume the coupon. Returns a generic error
 * message on any failure path to avoid leaking which codes exist.
 */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { ok: false, message: 'Too many attempts. Please try again in a few minutes.' },
      { status: 429 },
    );
  }

  const body = await req.json().catch(() => ({})) as {
    code?: unknown;
    eventId?: unknown;
    subtotal?: unknown;
  };

  const code = typeof body.code === 'string' ? body.code : '';
  const eventId = typeof body.eventId === 'string' && body.eventId ? body.eventId : null;
  const subtotal = Number(body.subtotal);

  if (!code.trim()) {
    return NextResponse.json(
      { ok: false, discountAmount: 0, finalAmount: subtotal || 0, reason: 'Please enter a coupon code.' },
      { status: 200 },
    );
  }
  if (!Number.isFinite(subtotal) || subtotal <= 0) {
    return NextResponse.json(
      {
        ok: false,
        discountAmount: 0,
        finalAmount: 0,
        reason: 'Coupon cannot be applied to a free booking.',
      },
      { status: 200 },
    );
  }

  const result = validateCoupon({ code, eventId, subtotal });
  // Always 200 — even invalid codes; the `ok` flag drives the UI label.
  return NextResponse.json({
    ok: result.ok,
    discountAmount: result.discountAmount,
    finalAmount: result.finalAmount,
    code: result.code,
    reason: result.reason,
  });
}
