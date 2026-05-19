import { NextResponse } from 'next/server';
import { getConfig } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/settings/reservego/secret — host-only, returns the actual
 * RESERVEGO_WEBHOOK_SECRET value (not masked). Every fetch is audit-logged
 * so there's a trail of who saw the secret and when.
 *
 * Why this exists: the global /api/config masks all sensitive values to
 * protect against accidental leakage in the Settings UI. But on the
 * dedicated Reservego sub-page the host legitimately needs to copy the
 * secret to paste into Reservego's dashboard. Forcing a regenerate every
 * time would be a footgun (every regenerate breaks any active webhook
 * integration until the operator re-pastes the new value).
 */
export async function GET() {
  const session = await requireRole(['host']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }

  const secret = getConfig('RESERVEGO_WEBHOOK_SECRET', '');
  if (!secret) {
    return NextResponse.json({ ok: false, message: 'Secret not yet generated.' }, { status: 404 });
  }

  logAudit({
    actor: session.name,
    action: 'reservego_secret_reveal',
    entityType: 'config',
    entityId: 'RESERVEGO_WEBHOOK_SECRET',
  });

  return NextResponse.json({ ok: true, secret });
}
