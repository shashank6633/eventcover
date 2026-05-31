import { NextRequest, NextResponse } from 'next/server';
import { getEvent } from '@/lib/events';
import { listSlotsWithCapacity, addSlot, reorderSlots } from '@/lib/event-slots';
import { requireRole } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/events/[id]/slots — admin list, includes used_capacity.
 * Returns active=0 rows too (sorted active-first) so the editor can show
 * deactivated slots and let the host re-enable them.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  const { id } = await ctx.params;
  const event = getEvent(id);
  if (!event) return NextResponse.json({ ok: false, message: 'event not found' }, { status: 404 });
  return NextResponse.json({ ok: true, slots: listSlotsWithCapacity(id, { activeOnly: false }) });
}

/**
 * POST /api/events/[id]/slots — add a new slot.
 * Body: { slot_date, start_time, end_time?, label?, max_capacity? }
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  const { id } = await ctx.params;
  const event = getEvent(id);
  if (!event) return NextResponse.json({ ok: false, message: 'event not found' }, { status: 404 });

  const body = await req.json().catch(() => ({})) as {
    slot_date?: unknown;
    start_time?: unknown;
    end_time?: unknown;
    label?: unknown;
    max_capacity?: unknown;
  };

  try {
    const slot = addSlot({
      eventId: id,
      slot_date: String(body.slot_date ?? ''),
      start_time: String(body.start_time ?? ''),
      end_time: typeof body.end_time === 'string' && body.end_time ? body.end_time : null,
      label: typeof body.label === 'string' ? body.label : null,
      max_capacity: body.max_capacity == null || body.max_capacity === '' ? null : Number(body.max_capacity),
    });
    return NextResponse.json({ ok: true, slot });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to add slot.';
    return NextResponse.json({ ok: false, message: msg }, { status: 400 });
  }
}

/**
 * PATCH /api/events/[id]/slots — bulk reorder.
 * Body: { orderedIds: string[] }
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  const { id } = await ctx.params;
  const event = getEvent(id);
  if (!event) return NextResponse.json({ ok: false, message: 'event not found' }, { status: 404 });

  const body = await req.json().catch(() => ({})) as { orderedIds?: unknown };
  if (!Array.isArray(body.orderedIds)) {
    return NextResponse.json({ ok: false, message: 'orderedIds must be an array of slot ids.' }, { status: 400 });
  }
  const ids = (body.orderedIds as unknown[]).filter((v): v is string => typeof v === 'string' && v.length > 0);
  try {
    const slots = reorderSlots(id, ids, session.name);
    return NextResponse.json({ ok: true, slots });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to reorder slots.';
    return NextResponse.json({ ok: false, message: msg }, { status: 400 });
  }
}
