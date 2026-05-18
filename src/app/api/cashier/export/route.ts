import { NextRequest, NextResponse } from 'next/server';
import { listCashierTransactions, toCsv, defaultShiftRange } from '@/lib/cashier';
import { requireRole } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * CSV download of the same filtered view shown on the page.
 * Inherits the page's filters via query params.
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

  const rows = listCashierTransactions({ from, to, settled, search, captain });
  const csv = toCsv(rows);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="cashier-${stamp}.csv"`,
    },
  });
}
