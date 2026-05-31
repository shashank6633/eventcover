/**
 * GET /api/events/[id]/insights?from=…&to=…&range=7d|14d|30d|90d
 *
 * Admin-only (host/manager). Returns the aggregated KPI + funnel + daily
 * series for the per-event Insights page.
 *
 * SIDE EFFECT: when the event's cart-recovery config is enabled and the
 * last sweep was longer ago than CART_RECOVERY_SWEEP_INTERVAL_SECONDS,
 * we kick off sweepCartRecovery() in the background (NOT awaited) so the
 * GET response is not delayed by Interakt latency.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import {
  getEventKpis,
  getEventFunnel,
  getEventDailySeries,
  getEventTrafficSources,
  getEventTicketPopularity,
  getEventScrollDepth,
} from '@/lib/event-analytics';
import { shouldAutoSweep, sweepCartRecovery } from '@/lib/cart-recovery';
import { getDb } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_RANGES: Record<string, number> = {
  '7d': 7,
  '14d': 14,
  '30d': 30,
  '90d': 90,
};

function resolveWindow(searchParams: URLSearchParams): { fromMs: number; toMs: number; rangeDays: number } {
  const now = Date.now();
  const fromParam = searchParams.get('from');
  const toParam = searchParams.get('to');
  const rangeParam = searchParams.get('range') || '30d';

  if (fromParam && toParam) {
    const fromMs = Number(fromParam);
    const toMs = Number(toParam);
    if (Number.isFinite(fromMs) && Number.isFinite(toMs) && toMs > fromMs) {
      const days = Math.ceil((toMs - fromMs) / (24 * 60 * 60 * 1000));
      return { fromMs, toMs, rangeDays: days };
    }
  }

  const days = ALLOWED_RANGES[rangeParam] ?? 30;
  return {
    fromMs: now - days * 24 * 60 * 60 * 1000,
    toMs: now,
    rangeDays: days,
  };
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }

  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ ok: false, message: 'Event id is required.' }, { status: 400 });
  }

  // Validate the event exists so the dashboard can render a 404 cleanly.
  const db = getDb();
  const ev = db.prepare('SELECT id, name, status FROM events WHERE id = ?').get(id) as
    | { id: string; name: string; status: string }
    | undefined;
  if (!ev) {
    return NextResponse.json({ ok: false, message: 'Event not found.' }, { status: 404 });
  }

  const { fromMs, toMs, rangeDays } = resolveWindow(req.nextUrl.searchParams);

  const kpis = getEventKpis(id, fromMs, toMs);
  const funnel = getEventFunnel(id, fromMs, toMs);
  const dailySeries = getEventDailySeries(id, fromMs, toMs);
  // Insights v2 widgets — all bucketed in JS over the metadata blob, so we
  // pay one extra read per widget but keep the API single-roundtrip for the
  // dashboard.
  const trafficSources = getEventTrafficSources(id, fromMs, toMs);
  const ticketPopularity = getEventTicketPopularity(id, fromMs, toMs);
  const scrollDepth = getEventScrollDepth(id, fromMs, toMs);

  // Best-effort cart-recovery sweep — fire-and-forget so we don't block
  // the dashboard GET on Interakt's 1500ms inter-call sleep.
  if (shouldAutoSweep(id)) {
    Promise.resolve().then(() => sweepCartRecovery(id).catch(() => undefined));
  }

  return NextResponse.json({
    ok: true,
    eventId: id,
    rangeDays,
    fromMs,
    toMs,
    kpis,
    funnel,
    dailySeries,
    trafficSources,
    ticketPopularity,
    scrollDepth,
  });
}
