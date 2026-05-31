import { NextRequest, NextResponse } from 'next/server';
import { getRevenueByEvent } from '@/lib/analytics';
import { requireRole } from '@/lib/auth';
import { resolveAnalyticsRange } from '../_range';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Top-N events ranked by combined revenue (wallets entry+cover, paid tickets,
 * captured payments) within the given range. Powers the BarChart on the
 * /admin/analytics Dashboard tab.
 *
 * Auth: manager+ (host or manager). Cashier-level surfaces don't need a
 * per-event revenue ranking.
 *
 * Query params:
 *   from   — UTC ms (default: now - 30d)
 *   to     — UTC ms (default: now)
 *   limit  — max rows (default 10, capped at 100)
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

  const limitRaw = Number(sp.get('limit'));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(100, limitRaw) : 10;

  const rows = getRevenueByEvent({ from: range.from, to: range.to, limit });

  return NextResponse.json(
    { ok: true, rows, rangeFrom: range.from, rangeTo: range.to },
    { headers: { 'Cache-Control': 'private, max-age=60' } },
  );
}
