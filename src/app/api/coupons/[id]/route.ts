import { NextRequest, NextResponse } from 'next/server';
import { getCoupon, updateCoupon, deleteCoupon, type CouponDiscountType } from '@/lib/coupons';
import { requireRole } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  const { id } = await ctx.params;
  const coupon = getCoupon(id);
  if (!coupon) return NextResponse.json({ ok: false, message: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true, coupon });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({})) as {
    active?: unknown;
    discountType?: unknown;
    discountValue?: unknown;
    maxUses?: unknown;
    expiresAt?: unknown;
    notes?: unknown;
    affiliateId?: unknown;
  };

  const patch: Parameters<typeof updateCoupon>[1] = {};
  if ('active' in body) patch.active = !!body.active;
  if (body.discountType === 'fixed' || body.discountType === 'percent') {
    patch.discountType = body.discountType as CouponDiscountType;
  }
  if ('discountValue' in body && body.discountValue !== null && body.discountValue !== '') {
    patch.discountValue = Number(body.discountValue);
  }
  if ('maxUses' in body) {
    patch.maxUses =
      body.maxUses === null || body.maxUses === undefined || body.maxUses === ''
        ? null
        : Number(body.maxUses);
  }
  if ('expiresAt' in body) {
    patch.expiresAt =
      body.expiresAt === null || body.expiresAt === undefined || body.expiresAt === ''
        ? null
        : Number(body.expiresAt);
  }
  if ('notes' in body) patch.notes = typeof body.notes === 'string' ? body.notes : null;
  if ('affiliateId' in body) {
    patch.affiliateId =
      body.affiliateId === null || body.affiliateId === undefined || body.affiliateId === ''
        ? null
        : String(body.affiliateId);
  }

  try {
    const coupon = updateCoupon(id, patch, session.name);
    if (!coupon) return NextResponse.json({ ok: false, message: 'not found' }, { status: 404 });
    return NextResponse.json({ ok: true, coupon });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to update coupon.';
    return NextResponse.json({ ok: false, message: msg }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  const { id } = await ctx.params;
  const ok = deleteCoupon(id, session.name);
  if (!ok) return NextResponse.json({ ok: false, message: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
