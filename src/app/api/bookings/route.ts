import { NextRequest, NextResponse } from 'next/server';
import { listBookings, createBooking, type BookingLineInput } from '@/lib/bookings';
import { requireRole } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await requireRole(['host', 'manager', 'entry']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  const sp = req.nextUrl.searchParams;
  const bookings = listBookings({
    eventId: sp.get('eventId') || undefined,
    status: (sp.get('status') as 'pending' | 'confirmed' | 'cancelled') || undefined,
    phone: sp.get('phone') || undefined,
    limit: sp.get('limit') ? Number(sp.get('limit')) : undefined,
  });
  return NextResponse.json({ ok: true, bookings });
}

export async function POST(req: NextRequest) {
  const session = await requireRole(['host', 'manager', 'entry']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }

  const body = await req.json().catch(() => ({}));
  try {
    const booking = createBooking({
      eventId: String(body.eventId || ''),
      customerName: String(body.customerName || ''),
      customerPhone: String(body.customerPhone || ''),
      customerEmail: body.customerEmail ?? null,
      lines: (Array.isArray(body.lines) ? body.lines : []) as BookingLineInput[],
      status: body.status,
      paymentMethod: body.paymentMethod,
      notes: body.notes,
      enforceValidation: body.enforceValidation !== false,
    }, session.name);
    return NextResponse.json({ ok: true, booking });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to create booking.';
    return NextResponse.json({ ok: false, message: msg }, { status: 400 });
  }
}
