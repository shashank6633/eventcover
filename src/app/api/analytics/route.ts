import { NextRequest, NextResponse } from 'next/server';
import { computeAnalytics } from '@/lib/analytics';
import { requireRole } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Analytics dashboard — drives /admin/analytics.
 *
 * Returns lifetime KPIs + range KPIs + a filtered transaction feed.
 * Open to host / manager / cashier — the same roles that see the History page.
 *
 * Query params:
 *   from, to     — UTC ms (defaults to the last 24h)
 *   q            — search across invoice / name / phone / amount
 *   employee     — exact match on employee name (issued_by / captain / created_by)
 *   limit        — capped at 5000
 */
export async function GET(req: NextRequest) {
  const session = await requireRole(['host', 'manager', 'cashier']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }

  const sp = req.nextUrl.searchParams;
  const fromRaw = sp.get('from');
  const toRaw = sp.get('to');
  const search = sp.get('q') || undefined;
  const employee = sp.get('employee') || undefined;
  const limit = Math.min(5000, Math.max(50, Number(sp.get('limit')) || 1000));

  const result = computeAnalytics({
    from: fromRaw ? Number(fromRaw) : undefined,
    to: toRaw ? Number(toRaw) : undefined,
    search,
    employee,
    limit,
  });

  return NextResponse.json({ ok: true, ...result });
}
