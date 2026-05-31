/**
 * /api/events/[id]/ticket-phases/sweep
 *
 *   POST — run time-based transitions for the event right now. Returns the
 *          phases that were ended + the ones that were activated. Idempotent
 *          on repeat calls within the same second.
 *
 * Intended callers:
 *   • Host / manager admin "Refresh" button.
 *   • A future cron sweep against every live event.
 *
 * Auth: host / manager.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getEvent } from '@/lib/events';
import { requireRole } from '@/lib/auth';
import { sweepTimeBasedTransitions, listPhases } from '@/lib/ticket-phases';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  const { id } = await ctx.params;
  const event = getEvent(id);
  if (!event) return NextResponse.json({ ok: false, message: 'event not found' }, { status: 404 });

  const result = sweepTimeBasedTransitions(id, session.name);
  return NextResponse.json({ ok: true, ...result, phases: listPhases(id) });
}
