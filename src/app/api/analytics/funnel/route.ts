import { NextRequest, NextResponse } from 'next/server';
import { getConversionFunnel } from '@/lib/analytics';
import { requireRole } from '@/lib/auth';
import { resolveAnalyticsRange } from '../_range';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Conversion funnel: clicks → reservations → wallets, scoped to the given
 * range. Drives the FunnelChart on the /admin/analytics Dashboard tab.
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

  const funnel = getConversionFunnel({ from: range.from, to: range.to });

  return NextResponse.json(
    { ok: true, ...funnel, rangeFrom: range.from, rangeTo: range.to },
    { headers: { 'Cache-Control': 'private, max-age=60' } },
  );
}
