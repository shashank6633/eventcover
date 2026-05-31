/**
 * /api/events/[id]/ticket-phases/[phaseId]/end
 *
 *   POST — end this phase right now (active=0, ended_at=now) and activate
 *          the next phase by sort_order. Convenience helper for the admin
 *          "End now" button; same logic the auto-transition path runs.
 *
 * Auth: host / manager.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getEvent } from '@/lib/events';
import { requireRole } from '@/lib/auth';
import { getPhase, endPhaseNow } from '@/lib/ticket-phases';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; phaseId: string }> },
) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  const { id, phaseId } = await ctx.params;
  const event = getEvent(id);
  if (!event) return NextResponse.json({ ok: false, message: 'event not found' }, { status: 404 });
  const existing = getPhase(phaseId);
  if (!existing || existing.event_id !== id) {
    return NextResponse.json({ ok: false, message: 'phase not found' }, { status: 404 });
  }

  const ended = endPhaseNow(phaseId, session.name);
  return NextResponse.json({ ok: true, phase: ended });
}
