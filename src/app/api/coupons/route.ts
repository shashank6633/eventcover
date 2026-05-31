import { NextRequest, NextResponse } from 'next/server';
import { listCoupons, createCoupon, type CouponDiscountType } from '@/lib/coupons';
import { requireRole } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/coupons?eventId=…
 *   - eventId omitted → all coupons (global admin view)
 *   - eventId=…       → event-specific PLUS venue-wide rows
 *   - eventId=none    → venue-wide only (event_id IS NULL)
 */
export async function GET(req: NextRequest) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }

  const raw = req.nextUrl.searchParams.get('eventId');
  let eventId: string | null | undefined;
  if (raw === null) eventId = undefined;
  else if (raw === '' || raw === 'none' || raw === 'null') eventId = null;
  else eventId = raw;

  const coupons = listCoupons({ eventId });
  return NextResponse.json({ ok: true, coupons });
}

export async function POST(req: NextRequest) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }

  const body = await req.json().catch(() => ({})) as {
    eventId?: unknown;
    code?: unknown;
    discountType?: unknown;
    discountValue?: unknown;
    maxUses?: unknown;
    expiresAt?: unknown;
    notes?: unknown;
    active?: unknown;
    affiliateId?: unknown;
  };

  try {
    const discountType = body.discountType === 'fixed' || body.discountType === 'percent'
      ? (body.discountType as CouponDiscountType)
      : null;
    if (!discountType) {
      return NextResponse.json(
        { ok: false, message: 'discountType must be "fixed" or "percent".' },
        { status: 400 },
      );
    }

    const coupon = createCoupon({
      eventId: typeof body.eventId === 'string' && body.eventId ? body.eventId : null,
      code: String(body.code ?? ''),
      discountType,
      discountValue: Number(body.discountValue ?? 0),
      maxUses:
        body.maxUses === null || body.maxUses === undefined || body.maxUses === ''
          ? null
          : Number(body.maxUses),
      expiresAt:
        body.expiresAt === null || body.expiresAt === undefined || body.expiresAt === ''
          ? null
          : Number(body.expiresAt),
      notes: typeof body.notes === 'string' ? body.notes : null,
      active: body.active === undefined ? true : !!body.active,
      affiliateId:
        body.affiliateId === undefined || body.affiliateId === null || body.affiliateId === ''
          ? null
          : String(body.affiliateId),
      createdBy: session.name,
    });
    return NextResponse.json({ ok: true, coupon });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to create coupon.';
    return NextResponse.json({ ok: false, message: msg }, { status: 400 });
  }
}
