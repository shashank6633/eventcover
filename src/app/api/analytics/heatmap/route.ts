import { NextRequest, NextResponse } from 'next/server';
import { getPeakHourHeatmap } from '@/lib/analytics';
import { requireRole } from '@/lib/auth';
import { resolveAnalyticsRange } from '../_range';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Peak-hour heatmap: wallet-issuance counts bucketed by IST day-of-week ×
 * hour-of-day. Returns a flat list of (dayOfWeek, hour, count) cells so the
 * UI can render a 7×24 grid (Sun..Sat × 0..23).
 *
 * Auth: manager+ (host or manager).
 *
 * Query params:
 *   from   — UTC ms (default: now - 30d)
 *   to     — UTC ms (default: now)
 */
export async function GET(req: NextRequest) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }

  const sp = req.nextUrl.searchParams;
  const range = resolveAnalyticsRange(sp.get('from'), sp.get('to'));
  if ('error' in range) {
    return NextResponse.json({ ok: false, message: range.error }, { status: 400 });
  }

  const cells = getPeakHourHeatmap({ from: range.from, to: range.to });

  return NextResponse.json(
    { ok: true, cells, rangeFrom: range.from, rangeTo: range.to },
    { headers: { 'Cache-Control': 'private, max-age=60' } },
  );
}
