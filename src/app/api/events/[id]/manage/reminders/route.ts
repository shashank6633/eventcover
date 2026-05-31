/**
 * GET / POST / PATCH /api/events/[id]/manage/reminders
 *
 * GET   — list schedules + master enabled flag.
 * POST  — create a new schedule. Body: { minutesBefore: number, enabled?: boolean }
 *         Returns 400 on cap-exceeded or duplicate-offset.
 * PATCH — bulk toggle master. Body: { enabled: boolean }
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { getEvent } from '@/lib/events';
import {
  listSchedules,
  upsertSchedule,
  getMasterEnabled,
  setMasterEnabled,
} from '@/lib/event-reminders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  const { id } = await ctx.params;
  const ev = getEvent(id);
  if (!ev) return NextResponse.json({ ok: false, message: 'Event not found.' }, { status: 404 });

  return NextResponse.json({
    ok: true,
    schedules: listSchedules(id),
    masterEnabled: getMasterEnabled(id),
  });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  const { id } = await ctx.params;
  const ev = getEvent(id);
  if (!ev) return NextResponse.json({ ok: false, message: 'Event not found.' }, { status: 404 });

  const body = await req.json().catch(() => ({})) as {
    minutesBefore?: unknown;
    enabled?: unknown;
  };

  const minutes = Number(body.minutesBefore);
  if (!Number.isFinite(minutes)) {
    return NextResponse.json({ ok: false, message: 'minutesBefore must be a number.' }, { status: 400 });
  }

  try {
    const schedule = upsertSchedule({
      eventId: id,
      minutesBefore: minutes,
      enabled: body.enabled === false ? false : true,
      actor: session.name,
    });
    return NextResponse.json({
      ok: true,
      schedule,
      schedules: listSchedules(id),
      masterEnabled: getMasterEnabled(id),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to add schedule.';
    return NextResponse.json({ ok: false, message: msg }, { status: 400 });
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  const { id } = await ctx.params;
  const ev = getEvent(id);
  if (!ev) return NextResponse.json({ ok: false, message: 'Event not found.' }, { status: 404 });

  const body = await req.json().catch(() => ({})) as { enabled?: unknown };
  if (typeof body.enabled !== 'boolean') {
    return NextResponse.json({ ok: false, message: 'enabled must be boolean.' }, { status: 400 });
  }
  setMasterEnabled(id, body.enabled, session.name);
  return NextResponse.json({
    ok: true,
    schedules: listSchedules(id),
    masterEnabled: getMasterEnabled(id),
  });
}
