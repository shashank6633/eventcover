/**
 * /api/events/[id]/cart-recovery
 *
 *   GET  — returns { config, recentAttempts, recoveryRate }
 *   POST — body { enabled?, delayMinutes?, templateName?, templateLang? }
 *          upserts the per-event cart-recovery config.
 *
 * Host/manager only. Audited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { getDb } from '@/lib/db';
import {
  getCartRecoveryConfig,
  upsertCartRecoveryConfig,
  listRecoveryAttempts,
  getRecoveryRate,
  getRecoveryKpis,
  getRecoveryActivity,
} from '@/lib/cart-recovery';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function eventExists(id: string): boolean {
  const db = getDb();
  return !!db.prepare('SELECT 1 FROM events WHERE id = ?').get(id);
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ ok: false, message: 'Event id is required.' }, { status: 400 });
  if (!eventExists(id)) return NextResponse.json({ ok: false, message: 'Event not found.' }, { status: 404 });

  const config = getCartRecoveryConfig(id);
  const rawAttempts = listRecoveryAttempts(id, 20);
  const recoveryRate = getRecoveryRate(id, 48);

  // ── UI augmentation ──
  // The recovery panel renders the attempt log with a status pill (sent /
  // recovered / failed) and a per-row event name (in case a future shared
  // log surfaces multi-event attempts). The lib returns the raw rows so
  // callers can pick their own presentation; we derive status here so the
  // mapping stays a single source-of-truth between API and UI.
  //
  // Status derivation:
  //   error !== null              → 'failed'   (send failed OR skipped_status_changed)
  //   recovered_at !== null       → 'recovered'
  //   else                        → 'sent'
  //
  // 'failed' takes precedence over 'recovered' because an attempt with both
  // an error AND a later recovered_at (extremely unlikely — recovery
  // marking gates on `error IS NULL` in getRecoveryRate but not in
  // markRecovered) should be reported as the failure-state for operator
  // attention.
  const db = getDb();
  const eventRow = db
    .prepare('SELECT name FROM events WHERE id = ?')
    .get(id) as { name: string } | undefined;
  const eventName = eventRow?.name || '';

  const recentAttempts = rawAttempts.map((a) => {
    const status: 'sent' | 'recovered' | 'failed' =
      a.error
        ? 'failed'
        : a.recoveredAt
          ? 'recovered'
          : 'sent';
    return { ...a, status, eventName };
  });

  // Mirror the failed count onto the rate object so the dashboard can show
  // a "sent / recovered / failed" triplet without re-querying.
  const failedRow = db.prepare(`
    SELECT COUNT(*) AS failed
    FROM event_cart_recovery_attempts
    WHERE event_id = ? AND error IS NOT NULL AND error != ''
  `).get(id) as { failed: number };
  const recoveryRateWithFailed = {
    ...recoveryRate,
    failed: Number(failedRow.failed) || 0,
  };

  // Insights v2: dashboard KPIs + activity rows. Supplements (does not
  // replace) recentAttempts so any older client that hasn't been rebuilt
  // continues to render — the v2 UI reads `activity` and `kpis` directly.
  const kpis = getRecoveryKpis(id);
  const activity = getRecoveryActivity(id, 50);

  return NextResponse.json({
    ok: true,
    config,
    recentAttempts,
    recoveryRate: recoveryRateWithFailed,
    kpis,
    activity,
  });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ ok: false, message: 'Event id is required.' }, { status: 400 });
  if (!eventExists(id)) return NextResponse.json({ ok: false, message: 'Event not found.' }, { status: 404 });

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, message: 'Invalid JSON body.' }, { status: 400 });
  }

  const patch: { enabled?: boolean; delayMinutes?: number; templateName?: string; templateLang?: string } = {};
  if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;
  if (typeof body.delayMinutes === 'number') patch.delayMinutes = body.delayMinutes;
  if (typeof body.templateName === 'string') patch.templateName = body.templateName;
  if (typeof body.templateLang === 'string') patch.templateLang = body.templateLang;

  const config = upsertCartRecoveryConfig(id, patch);

  logAudit({
    actor: session.sub,
    action: 'cart_recovery_config_updated',
    entityType: 'event',
    entityId: id,
    details: { patch },
  });

  return NextResponse.json({ ok: true, config });
}
