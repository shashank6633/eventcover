import { NextRequest, NextResponse } from 'next/server';
import { listCashierTransactions, getCashierTotals, listCaptainsInRange, defaultShiftRange } from '@/lib/cashier';
import { requireRole } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Cashier transactions endpoint — filtered list + summary totals + captain list (for dropdown).
 *
 * Query:
 *   from, to       — UTC ms range; defaults to today's shift window (5 AM IST → 5 AM IST next day)
 *   settled        — 'true' | 'false' | omitted (both)
 *   search         — free text against invoice / name / phone / amount / order_ref
 *   captain        — exact captain name; 'all' or omitted = no filter
 */
export async function GET(req: NextRequest) {
  const session = await requireRole(['host', 'manager', 'cashier']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }

  const sp = req.nextUrl.searchParams;
  const def = defaultShiftRange();
  const from = Number(sp.get('from')) || def.from;
  const to = Number(sp.get('to')) || def.to;
  const settledParam = sp.get('settled');
  const settled = settledParam === 'true' ? true : settledParam === 'false' ? false : undefined;
  const search = sp.get('search') || undefined;
  const captain = sp.get('captain') || undefined;

  const transactions = listCashierTransactions({ from, to, settled, search, captain });
  const totals = getCashierTotals({ from, to, captain });
  const captains = listCaptainsInRange(from, to);

  return NextResponse.json({
    ok: true,
    range: { from, to },
    transactions,
    totals,
    captains,
  });
}
