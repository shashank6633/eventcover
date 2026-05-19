import { NextResponse } from 'next/server';
import { regenerateWebhookSecret } from '@/lib/reservations';
import { requireRole } from '@/lib/auth';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Regenerates the Reservego webhook shared secret. Host-only.
 * Returns the new secret in the response one time — the operator must
 * paste it into Reservego's dashboard immediately. Future GETs of /api/config
 * will return it masked.
 */
export async function POST() {
  const session = await requireRole(['host']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  const secret = regenerateWebhookSecret();
  logAudit({
    actor: session.name,
    action: 'reservego_secret_regenerate',
    entityType: 'config',
    entityId: 'RESERVEGO_WEBHOOK_SECRET',
  });
  return NextResponse.json({ ok: true, secret });
}
