/**
 * GET /api/bookings/list
 *
 * Global cross-event list of every payment-bearing booking row + KPI counts
 * for the /admin/bookings dashboard. Distinct from /api/bookings (which is
 * the legacy offline-ticketing CRUD endpoint).
 *
 * Query params:
 *   ?status=all|captured|pending|abandoned|refunded   (default: all)
 *   ?eventId=<id>                                     (optional event filter)
 *   ?fromDate=YYYY-MM-DD&toDate=YYYY-MM-DD            (event_date range)
 *   ?q=<text>                                          (name/phone/email/order id)
 *   ?limit=<n>                                        (capped at 500)
 *
 * Roles: host, manager.
 *
 * Returns:
 *   { ok: true, items: BookingListRow[], counts: BookingCounts }
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { listAllBookings, getBookingCounts, type ListAllBookingsInput } from '@/lib/all-bookings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_BUCKETS: Array<NonNullable<ListAllBookingsInput['statusBucket']>> = [
  'all', 'captured', 'pending', 'abandoned', 'refunded',
];

export async function GET(req: NextRequest) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }

  const sp = req.nextUrl.searchParams;
  const rawStatus = sp.get('status') ?? 'all';
  const statusBucket: NonNullable<ListAllBookingsInput['statusBucket']> =
    VALID_BUCKETS.includes(rawStatus as never)
      ? (rawStatus as NonNullable<ListAllBookingsInput['statusBucket']>)
      : 'all';

  const eventId = sp.get('eventId') || null;
  const fromDate = sp.get('fromDate') || null;
  const toDate = sp.get('toDate') || null;
  const q = sp.get('q') || '';
  const limitRaw = Number(sp.get('limit') ?? '200');
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.floor(limitRaw)) : 200;

  // Run list + counts sequentially — single-process SQLite means parallelism
  // doesn't help us, and counts is cheap relative to list. Keeping them
  // sequential keeps the SQL simple to read.
  const items = listAllBookings({ eventId, statusBucket, q, fromDate, toDate, limit });
  const counts = getBookingCounts({ eventId, q, fromDate, toDate });

  return NextResponse.json({ ok: true, items, counts });
}
