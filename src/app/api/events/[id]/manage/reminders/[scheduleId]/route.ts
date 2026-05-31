/**
 * PATCH / DELETE /api/events/[id]/manage/reminders/[scheduleId]
 *
 * PATCH  — body { minutesBefore?: number, enabled?: boolean }. Both optional;
 *          omitted fields preserve current value. Returns 400 on cap or dup.
 * DELETE — remove the schedule.
 *
 * IDOR guard: we re-fetch the schedule and verify it belongs to ctx.id
 * before any mutation.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import {
  getSchedule,
  upsertSchedule,
  deleteSchedule,
  listSchedules,
  getMasterEnabled,
} from '@/lib/event-reminders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; scheduleId: string }> },
) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  const { id, scheduleId } = await ctx.params;
  const current = getSchedule(scheduleId);
  if (!current || current.eventId !== id) {
    return NextResponse.json({ ok: false, message: 'Schedule not found.' }, { status: 404 });
  }
  const body = await req.json().catch(() => ({})) as {
    minutesBefore?: unknown;
    enabled?: unknown;
  };
  const minutes = body.minutesBefore !== undefined ? Number(body.minutesBefore) : current.minutesBefore;
  const enabled = typeof body.enabled === 'boolean' ? body.enabled : current.enabled;

  try {
    upsertSchedule({
      eventId: id,
      scheduleId,
      minutesBefore: minutes,
      enabled,
      actor: session.name,
    });
    return NextResponse.json({
      ok: true,
      schedules: listSchedules(id),
      masterEnabled: getMasterEnabled(id),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to update schedule.';
    return NextResponse.json({ ok: false, message: msg }, { status: 400 });
  }
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; scheduleId: string }> },
) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  const { id, scheduleId } = await ctx.params;
  const current = getSchedule(scheduleId);
  if (!current || current.eventId !== id) {
    return NextResponse.json({ ok: false, message: 'Schedule not found.' }, { status: 404 });
  }
  deleteSchedule(scheduleId, session.name);
  return NextResponse.json({
    ok: true,
    schedules: listSchedules(id),
    masterEnabled: getMasterEnabled(id),
  });
}
