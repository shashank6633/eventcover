/**
 * GET /api/events/[id]/manage/bookings?q=&limit=200
 *
 * Returns the bookings list + KPI strip for the Manage > Bookings tab.
 *
 *   KPIs (computed from reservations + payments):
 *     • totalBookings  — confirmed reservations (status != cancelled/no_show)
 *     • totalRevenue   — SUM(payments.amount) of captured payments
 *     • totalTickets   — SUM(reservations.pax) for non-cancelled rows
 *
 * Bookings list mirrors the rows in src/lib/reservations.ts plus joined
 * captured-payment amount + status, so the UI can render an Export-ready
 * grid without a second round-trip.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { getEvent } from '@/lib/events';
import { getDb } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface BookingRow {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  pax: number;
  status: string;
  reservation_status: string | null;
  checked_in_pax: number | null;
  synced_at: number;
  arrival_time: string | null;
  slot_id: string | null;
  zone_id: string | null;
  rsvp_answers_json: string | null;
  payment_id: string | null;
  payment_status: string | null;
  payment_amount: number | null;
  razorpay_payment_id: string | null;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }

  const { id } = await ctx.params;
  const ev = getEvent(id);
  if (!ev) return NextResponse.json({ ok: false, message: 'Event not found.' }, { status: 404 });

  const sp = req.nextUrl.searchParams;
  const qRaw = (sp.get('q') || '').trim();
  const limit = Math.max(1, Math.min(1000, Number(sp.get('limit')) || 200));

  const db = getDb();

  const params: (string | number)[] = [id];
  const where: string[] = ['r.event_id = ?'];
  if (qRaw) {
    const like = `%${qRaw}%`;
    const digits = qRaw.replace(/\D/g, '');
    if (digits.length >= 4) {
      where.push(`(
        LOWER(r.name) LIKE LOWER(?) OR
        r.phone LIKE ? OR
        LOWER(IFNULL(r.email,'')) LIKE LOWER(?) OR
        IFNULL(p.razorpay_payment_id,'') LIKE ?
      )`);
      params.push(like, `%${digits}%`, like, like);
    } else {
      where.push(`(
        LOWER(r.name) LIKE LOWER(?) OR
        LOWER(IFNULL(r.email,'')) LIKE LOWER(?) OR
        IFNULL(p.razorpay_payment_id,'') LIKE ?
      )`);
      params.push(like, like, like);
    }
  }

  // JOIN against the LATEST payment per reservation so we always show the
  // most recent capture/failure state. Sub-select trick is the standard SQLite
  // pattern (mirrors src/lib/refundable-entries.ts).
  const sql = `
    SELECT
      r.id, r.name, r.phone, r.email, r.pax, r.status,
      r.reservation_status, r.checked_in_pax, r.synced_at,
      r.arrival_time, r.slot_id, r.zone_id, r.rsvp_answers_json,
      p.id           AS payment_id,
      p.status       AS payment_status,
      p.amount       AS payment_amount,
      p.razorpay_payment_id
    FROM reservations r
    LEFT JOIN payments p ON p.id = (
      SELECT p2.id FROM payments p2
       WHERE p2.reservation_id = r.id
       ORDER BY p2.updated_at DESC LIMIT 1
    )
    WHERE ${where.join(' AND ')}
    ORDER BY r.synced_at DESC
    LIMIT ?
  `;
  params.push(limit);
  const rows = db.prepare(sql).all(...params) as BookingRow[];

  // KPI strip — compute against the FULL event scope, not the (possibly
  // filtered) query result. Counts only non-cancelled reservations.
  const kpiRow = db
    .prepare(
      `SELECT
         COUNT(*) AS total_bookings,
         COALESCE(SUM(r.pax), 0) AS total_tickets,
         COALESCE(SUM(
           CASE WHEN p.status = 'captured' THEN p.amount ELSE 0 END
         ), 0) AS total_revenue,
         COALESCE(SUM(IFNULL(r.checked_in_pax, 0)), 0) AS total_checked_in,
         COALESCE(SUM(
           CASE WHEN r.status != 'cancelled' THEN r.pax ELSE 0 END
         ), 0) AS registered
       FROM reservations r
       LEFT JOIN payments p ON p.id = (
         SELECT p2.id FROM payments p2 WHERE p2.reservation_id = r.id
          ORDER BY p2.updated_at DESC LIMIT 1
       )
       WHERE r.event_id = ?
         AND r.status != 'cancelled'`,
    )
    .get(id) as {
      total_bookings: number;
      total_tickets: number;
      total_revenue: number;
      total_checked_in: number;
      registered: number;
    };

  return NextResponse.json({
    ok: true,
    event: {
      id: ev.id,
      name: ev.name,
      event_date: ev.event_date,
      status: ev.status,
    },
    kpis: {
      totalBookings: kpiRow.total_bookings,
      totalTickets: kpiRow.total_tickets,
      totalRevenue: kpiRow.total_revenue,
      registered: kpiRow.registered,
      checkedIn: kpiRow.total_checked_in,
    },
    bookings: rows,
  });
}
