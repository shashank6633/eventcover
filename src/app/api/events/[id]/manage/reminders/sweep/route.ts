/**
 * POST /api/events/[id]/manage/reminders/sweep
 *
 * Manual sweep trigger — useful during testing, also doubles as a
 * fall-back when no external cron is wired up yet. Calls sweepReminders()
 * (which walks every event, not just this one) and returns counters.
 *
 * Role-gated to host/manager so we don't let arbitrary visitors trip the
 * Interakt rate limit.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { getEvent } from '@/lib/events';
import { sweepReminders } from '@/lib/event-reminders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  const { id } = await ctx.params;
  const ev = getEvent(id);
  if (!ev) return NextResponse.json({ ok: false, message: 'Event not found.' }, { status: 404 });
  const result = await sweepReminders();
  return NextResponse.json({ ok: true, result });
}
