import { NextRequest, NextResponse } from 'next/server';
import {
  listPendingPayouts,
  listAllPayouts,
  createPayout,
  type PayoutMethod,
} from '@/lib/affiliates';
import { requireRole } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  return NextResponse.json({
    ok: true,
    pending: listPendingPayouts(),
    history: listAllPayouts(200),
  });
}

export async function POST(req: NextRequest) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  const body = await req.json().catch(() => ({}));
  try {
    const payout = createPayout({
      affiliateId: String(body.affiliateId || ''),
      method: (body.method || 'cash') as PayoutMethod,
      reference: body.reference ?? null,
      notes: body.notes ?? null,
      paidBy: session.name,
    });
    if (!payout) {
      return NextResponse.json({ ok: false, message: 'No pending commissions for this affiliate.' }, { status: 400 });
    }
    return NextResponse.json({ ok: true, payout });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to create payout.';
    return NextResponse.json({ ok: false, message: msg }, { status: 400 });
  }
}
