import { NextRequest, NextResponse } from 'next/server';
import { getBooking, cancelBooking, confirmBooking } from '@/lib/bookings';
import { requireRole } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['host', 'manager', 'entry']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  const { id } = await ctx.params;
  const booking = getBooking(id);
  if (!booking) return NextResponse.json({ ok: false, message: 'Not found.' }, { status: 404 });
  return NextResponse.json({ ok: true, booking });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));

  if (body.action === 'cancel') {
    const b = cancelBooking(id, session.name);
    if (!b) return NextResponse.json({ ok: false, message: 'Not found.' }, { status: 404 });
    return NextResponse.json({ ok: true, booking: b });
  }
  if (body.action === 'confirm') {
    const b = confirmBooking(id, session.name, body.paymentMethod);
    if (!b) return NextResponse.json({ ok: false, message: 'Not found.' }, { status: 404 });
    return NextResponse.json({ ok: true, booking: b });
  }
  return NextResponse.json({ ok: false, message: "Unsupported action. Use 'cancel' or 'confirm'." }, { status: 400 });
}
