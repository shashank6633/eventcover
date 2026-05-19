import { NextResponse } from 'next/server';
import { getWebhookStats } from '@/lib/reservations';
import { requireRole } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  return NextResponse.json({ ok: true, ...getWebhookStats('reservego') });
}
