import { NextRequest, NextResponse } from 'next/server';
import { getAffiliate, getAffiliateStats, listPayoutsForAffiliate } from '@/lib/affiliates';
import { requireRole } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  const { id } = await params;
  const aff = getAffiliate(id);
  if (!aff) return NextResponse.json({ ok: false, message: 'Not found.' }, { status: 404 });

  return NextResponse.json({
    ok: true,
    affiliate: aff,
    stats: getAffiliateStats(id),
    payouts: listPayoutsForAffiliate(id),
  });
}
