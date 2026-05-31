import { NextRequest, NextResponse } from 'next/server';
import { computeAnalytics, getKpis } from '@/lib/analytics';
import { requireRole } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Lightweight KPI endpoint — used by:
 *   • the events hub "Last 7 days at a glance" widget (consumes `range`/`lifetime`)
 *   • the /admin/analytics Dashboard tab (consumes top-level `totalRevenue`,
 *     `activeWallets`, `reservationsCount`, `conversionRate`)
 *
 * Both shapes are returned from a single round-trip; older callers keep
 * working unchanged, new callers can ignore `range`/`lifetime`.
 *
 * Open to host / manager / cashier — same as /api/analytics.
 *
 * Query params:
 *   from   — either UTC ms, an ISO date, or one of the named ranges:
 *              'today', 'last7d', 'last30d'
 *   to     — UTC ms (optional). Defaults to "now" when from is named.
 *
 * Defaults to the last 30 days when neither bound is provided (matches the
 * Dashboard tab's expected default range).
 */
export async function GET(req: NextRequest) {
  const session = await requireRole(['host', 'manager', 'cashier']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }

  const sp = req.nextUrl.searchParams;
  const fromRaw = sp.get('from');
  const toRaw = sp.get('to');

  const { from, to } = resolveRange(fromRaw, toRaw);

  // Validate from < to when both are supplied — guards against the UI
  // accidentally swapping the bounds (would otherwise return empty data).
  if (from !== undefined && to !== undefined && from >= to) {
    return NextResponse.json(
      { ok: false, message: '`from` must be earlier than `to`' },
      { status: 400 },
    );
  }

  // Pass limit=50 because the events hub widget only needs the KPI numbers —
  // not the transaction feed. Keeping the limit low keeps the query cheap.
  const result = computeAnalytics({ from, to, limit: 50 });

  // Dashboard-style headline metrics. When the caller doesn't pass a range
  // these fall back to the dashboard default (last 30 days) rather than
  // computeAnalytics's last-24h shift default — both shapes are tagged with
  // their own ranges so the UI can label them correctly.
  const dashboard = getKpis({ from, to });

  return NextResponse.json(
    {
      ok: true,
      // Dashboard headline KPIs (new — flat shape).
      totalRevenue: dashboard.totalRevenue,
      activeWallets: dashboard.activeWallets,
      reservationsCount: dashboard.reservationsCount,
      conversionRate: dashboard.conversionRate,
      // Existing shape — preserved verbatim for back-compat with the events
      // hub widget and any other consumers.
      range: result.range,
      lifetime: result.lifetime,
      rangeFrom: result.rangeFrom,
      rangeTo: result.rangeTo,
    },
    { headers: { 'Cache-Control': 'private, max-age=60' } },
  );
}

function resolveRange(fromRaw: string | null, toRaw: string | null): { from?: number; to?: number } {
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;

  let from: number | undefined;
  let to: number | undefined = toRaw ? Number(toRaw) : undefined;

  if (fromRaw === 'today') {
    from = now - DAY;
    if (to == null) to = now;
  } else if (fromRaw === 'last7d') {
    from = now - 7 * DAY;
    if (to == null) to = now;
  } else if (fromRaw === 'last30d') {
    from = now - 30 * DAY;
    if (to == null) to = now;
  } else if (fromRaw) {
    const n = Number(fromRaw);
    from = Number.isFinite(n) && n > 0 ? n : undefined;
  }

  return { from, to };
}
