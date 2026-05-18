import { NextRequest, NextResponse } from 'next/server';
import { getReservation, markReservationNoShow } from '@/lib/reservations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const r = getReservation(id);
  if (!r) return NextResponse.json({ ok: false, message: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true, reservation: r });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  if (body?.status === 'no_show') {
    markReservationNoShow(id);
    const r = getReservation(id);
    return NextResponse.json({ ok: true, reservation: r });
  }
  return NextResponse.json({ ok: false, message: "only status='no_show' supported for now" }, { status: 400 });
}
