import { NextRequest, NextResponse } from 'next/server';
import { unsettleRedemption } from '@/lib/cashier';
import { requireRole } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Unsettle a previously settled redemption.
 *
 * Strictly host-only: reversing a settlement undoes financial reconciliation,
 * so it sits with the admin alone. Manager, cashier, captain and entry roles
 * are blocked at the API regardless of what the UI offers them.
 */
export async function POST(req: NextRequest) {
  const session = await requireRole(['host']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  const body = await req.json().catch(() => ({}));
  const id = String(body?.id || '').trim();
  if (!id) return NextResponse.json({ ok: false, message: 'id is required.' }, { status: 400 });

  const row = unsettleRedemption(id, session.name);
  if (!row) return NextResponse.json({ ok: false, message: 'Transaction not found.' }, { status: 404 });
  return NextResponse.json({ ok: true, transaction: row });
}
