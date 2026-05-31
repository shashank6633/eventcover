/**
 * POST /api/events/[id]/cart-recovery/sweep
 *
 * Manually trigger a cart-recovery sweep for this event. Synchronous —
 * the response includes {attempts, sent, skipped, errors}. Rate-limited:
 * rejects with 429 when last_swept_at < now - 60s, unless ?force=1.
 *
 * Host/manager only. Audited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { getCartRecoveryConfig, sweepCartRecovery } from '@/lib/cart-recovery';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MANUAL_THROTTLE_MS = 60_000;

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }

  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ ok: false, message: 'Event id is required.' }, { status: 400 });
  }

  const db = getDb();
  const ev = db.prepare('SELECT id FROM events WHERE id = ?').get(id) as { id: string } | undefined;
  if (!ev) return NextResponse.json({ ok: false, message: 'Event not found.' }, { status: 404 });

  const force = req.nextUrl.searchParams.get('force') === '1';

  // Manual throttle: reject if we ran a sweep in the last 60 seconds, unless
  // the caller explicitly forces. Protects Interakt's quota when a host
  // hammers the button.
  const cfg = getCartRecoveryConfig(id);
  if (!force && cfg.lastSweptAt > 0 && (Date.now() - cfg.lastSweptAt) < MANUAL_THROTTLE_MS) {
    return NextResponse.json(
      {
        ok: false,
        message: 'Sweep rate-limited. Try again in a minute.',
        nextEligibleAt: cfg.lastSweptAt + MANUAL_THROTTLE_MS,
      },
      { status: 429 },
    );
  }

  // Force flag also overrides the enabled=0 gate so admins can dry-run.
  const result = await sweepCartRecovery(id, { force });

  logAudit({
    actor: session.sub,
    action: 'cart_recovery_sweep_manual',
    entityType: 'event',
    entityId: id,
    details: { force, result },
  });

  return NextResponse.json({ ...result, ok: result.ok });
}
