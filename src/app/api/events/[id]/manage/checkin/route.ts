/**
 * GET /api/events/[id]/manage/checkin?q=
 *
 * Powers the Manage > Check-In tab.
 *   • KPIs: registered / checkedIn / progressPercent
 *   • recent: latest 50 reservation_checkins joined with reservation info
 *   • search: when q is provided, matches reservations by name/phone/email
 *             and returns their current check-in state
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { getEvent } from '@/lib/events';
import { getDb } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RecentCheckinRow {
  id: string;
  reservation_id: string;
  checked_in_pax: number;
  checked_in_by: string;
  timestamp: number;
  res_name: string;
  res_phone: string;
  res_pax: number;
}

interface SearchHitRow {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  pax: number;
  total_pax: number | null;
  checked_in_pax: number | null;
  reservation_status: string | null;
  status: string;
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
  const limit = Math.max(1, Math.min(200, Number(sp.get('limit')) || 50));

  const db = getDb();

  const kpiRow = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN status != 'cancelled' THEN pax ELSE 0 END), 0) AS registered,
         COALESCE(SUM(IFNULL(checked_in_pax, 0)), 0) AS checked_in
       FROM reservations
       WHERE event_id = ?`,
    )
    .get(id) as { registered: number; checked_in: number };

  const registered = kpiRow.registered || 0;
  const checkedIn = kpiRow.checked_in || 0;
  const progressPercent = registered > 0 ? Math.round((checkedIn / registered) * 100) : 0;

  // Recent check-ins for this event — join via reservations.event_id.
  const recent = db
    .prepare(
      `SELECT
         c.id, c.reservation_id, c.checked_in_pax, c.checked_in_by, c.timestamp,
         r.name AS res_name, r.phone AS res_phone, r.pax AS res_pax
       FROM reservation_checkins c
       JOIN reservations r ON r.id = c.reservation_id
       WHERE r.event_id = ?
         AND c.status = 'success'
       ORDER BY c.timestamp DESC
       LIMIT ?`,
    )
    .all(id, limit) as RecentCheckinRow[];

  let searchHits: SearchHitRow[] = [];
  if (qRaw) {
    const like = `%${qRaw}%`;
    const digits = qRaw.replace(/\D/g, '');
    const params: (string | number)[] = [id];
    let predicate: string;
    if (digits.length >= 4) {
      predicate = `(
        LOWER(name) LIKE LOWER(?) OR
        phone LIKE ? OR
        LOWER(IFNULL(email,'')) LIKE LOWER(?)
      )`;
      params.push(like, `%${digits}%`, like);
    } else {
      predicate = `(
        LOWER(name) LIKE LOWER(?) OR
        LOWER(IFNULL(email,'')) LIKE LOWER(?)
      )`;
      params.push(like, like);
    }
    searchHits = db
      .prepare(
        `SELECT id, name, phone, email, pax, total_pax, checked_in_pax,
                reservation_status, status
           FROM reservations
          WHERE event_id = ?
            AND ${predicate}
            AND status != 'cancelled'
          ORDER BY name ASC
          LIMIT 50`,
      )
      .all(...params) as SearchHitRow[];
  }

  return NextResponse.json({
    ok: true,
    event: {
      id: ev.id,
      name: ev.name,
      event_date: ev.event_date,
      status: ev.status,
    },
    kpis: {
      registered,
      checkedIn,
      progressPercent,
    },
    recent,
    searchHits,
    query: qRaw,
  });
}
