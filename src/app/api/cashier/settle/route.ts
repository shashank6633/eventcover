import { NextRequest, NextResponse } from 'next/server';
import { settleRedemption } from '@/lib/cashier';
import { requireRole } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const session = await requireRole(['host', 'manager', 'cashier']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  const body = await req.json().catch(() => ({}));
  const id = String(body?.id || '').trim();
  if (!id) return NextResponse.json({ ok: false, message: 'id is required.' }, { status: 400 });

  const row = settleRedemption(id, session.name);
  if (!row) return NextResponse.json({ ok: false, message: 'Transaction not found.' }, { status: 404 });
  return NextResponse.json({ ok: true, transaction: row });
}
