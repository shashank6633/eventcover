import { NextRequest, NextResponse } from 'next/server';
import { lookupCustomerByPhone } from '@/lib/tickets';
import { requireRole } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Customer pre-fill endpoint — powers the "Load" button on the Offline Ticketing page.
 * Searches tickets first (richest data with gender) then guests (used by wallets + reservations).
 */
export async function GET(req: NextRequest) {
  const session = await requireRole(['host', 'manager', 'entry']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  const phone = req.nextUrl.searchParams.get('phone') || '';
  if (!phone.trim()) {
    return NextResponse.json({ ok: false, message: 'phone query is required.' }, { status: 400 });
  }
  const customer = lookupCustomerByPhone(phone);
  return NextResponse.json({ ok: true, ...customer });
}
