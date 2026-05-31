import { NextRequest, NextResponse } from 'next/server';
import { getSlot, updateSlot, deleteSlot } from '@/lib/event-slots';
import { requireRole } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PATCH /api/events/[id]/slots/[slotId]
 * Body: { slot_date?, start_time?, end_time?, label?, max_capacity?, active? }
 *
 * Pass `active: false` to soft-deactivate (preferred over DELETE for slots
 * that have reservations attached — keeps history intact).
 */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; slotId: string }> },
) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  const { id, slotId } = await ctx.params;
  const existing = getSlot(slotId);
  if (!existing || existing.event_id !== id) {
    return NextResponse.json({ ok: false, message: 'slot not found' }, { status: 404 });
  }

  const body = await req.json().catch(() => ({})) as {
    slot_date?: unknown;
    start_time?: unknown;
    end_time?: unknown;
    label?: unknown;
    max_capacity?: unknown;
    active?: unknown;
  };

  try {
    const slot = updateSlot(
      slotId,
      {
        slot_date: typeof body.slot_date === 'string' ? body.slot_date : undefined,
        start_time: typeof body.start_time === 'string' ? body.start_time : undefined,
        end_time: 'end_time' in body
          ? (typeof body.end_time === 'string' && body.end_time ? body.end_time : null)
          : undefined,
        label: 'label' in body ? (typeof body.label === 'string' ? body.label : null) : undefined,
        max_capacity: 'max_capacity' in body
          ? (body.max_capacity == null || body.max_capacity === '' ? null : Number(body.max_capacity))
          : undefined,
        active: 'active' in body ? !!body.active : undefined,
      },
      session.name,
    );
    return NextResponse.json({ ok: true, slot });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to update slot.';
    return NextResponse.json({ ok: false, message: msg }, { status: 400 });
  }
}

/**
 * DELETE /api/events/[id]/slots/[slotId]
 *
 * Hard delete — refused with 409 if reservations are attached. The UI should
 * fall back to PATCH { active: false } when this returns 409.
 */
export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; slotId: string }> },
) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  const { id, slotId } = await ctx.params;
  const existing = getSlot(slotId);
  if (!existing || existing.event_id !== id) {
    return NextResponse.json({ ok: false, message: 'slot not found' }, { status: 404 });
  }
  const result = deleteSlot(slotId, session.name);
  if (!result.ok) {
    return NextResponse.json({ ok: false, message: result.reason, attached: result.attached }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
