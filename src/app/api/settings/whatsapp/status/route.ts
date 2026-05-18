import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { getDb, getConfig } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * WhatsApp connection status — surfaces the result of the most recent
 * `whatsapp_test_send` audit row so the Settings → WhatsApp page can show
 * "healthy" or "needs attention" prominently. Host-only.
 *
 * States returned in `health`:
 *   not_configured  — secret or business phone missing
 *   untested        — credentials set but no send attempt yet
 *   healthy         — last send succeeded
 *   error           — last send failed (auth, rate limit, account issue, etc.)
 */
export async function GET() {
  const session = await requireRole(['host']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }

  const hasSecret = !!getConfig('INTERAKT_API_SECRET', '');
  const businessPhone = getConfig('INTERAKT_BUSINESS_PHONE', '');

  if (!hasSecret || !businessPhone) {
    return NextResponse.json({
      ok: true,
      health: 'not_configured',
      businessPhone,
    });
  }

  // Latest test-send audit entry. The details JSON has { ok, status, error, ... }
  const db = getDb();
  const row = db.prepare(`
    SELECT timestamp, actor, action, details
    FROM audit_log
    WHERE action = 'whatsapp_test_send'
    ORDER BY timestamp DESC
    LIMIT 1
  `).get() as { timestamp: number; actor: string; action: string; details: string | null } | undefined;

  if (!row) {
    return NextResponse.json({
      ok: true,
      health: 'untested',
      businessPhone,
    });
  }

  let details: { ok?: boolean; status?: number; error?: string; template?: string; to?: string } = {};
  try { details = row.details ? JSON.parse(row.details) : {}; } catch { /* ignore */ }

  const health = details.ok ? 'healthy' : 'error';

  return NextResponse.json({
    ok: true,
    health,
    businessPhone,
    lastAttempt: {
      at: row.timestamp,
      by: row.actor,
      template: details.template,
      to: details.to,
      ok: details.ok,
      status: details.status,
      error: details.error,
    },
  });
}
