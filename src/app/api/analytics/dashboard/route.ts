/**
 * GET /api/analytics/dashboard
 *
 * Powers the "Dashboard" tab on /admin/analytics. Read-only. Mirrors the
 * role gate on GET /api/analytics so the dashboard and ledger views are
 * always reachable by the same staff.
 *
 * Query params:
 *   from     UTC ms inclusive (default: now - 30d)
 *   to       UTC ms exclusive (default: now + 1s)
 *   eventId  optional — scope every aggregate to a single event
 */
import { NextRequest, NextResponse } from 'next/server';
import { computeDashboard } from '@/lib/analytics-dashboard';
import { requireRole } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await requireRole(['host', 'manager', 'cashier']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }

  const sp = req.nextUrl.searchParams;
  const fromRaw = sp.get('from');
  const toRaw = sp.get('to');
  const eventId = sp.get('eventId') || undefined;

  const result = computeDashboard({
    from: fromRaw ? Number(fromRaw) : undefined,
    to: toRaw ? Number(toRaw) : undefined,
    eventId,
  });

  return NextResponse.json({ ok: true, ...result });
}
