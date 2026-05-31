/**
 * /api/events/[id]/ticket-phases/[phaseId]
 *
 *   PATCH  — update name / sort_order / active / ends_at / ends_on_sellout.
 *   DELETE — soft-deletes (active=0, ended_at=now) when sold>0, else hard.
 *
 * Auth: host / manager.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getEvent } from '@/lib/events';
import { requireRole } from '@/lib/auth';
import {
  getPhase,
  updatePhase,
  deletePhase,
  type UpdatePhaseInput,
} from '@/lib/ticket-phases';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(
  req: NextRequest,
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

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const patch: UpdatePhaseInput = {};
  if ('name' in body) patch.name = String(body.name ?? '');
  if ('sort_order' in body) patch.sort_order = Number(body.sort_order);
  if ('active' in body) patch.active = !!body.active;
  if ('ends_at' in body) {
    if (body.ends_at == null || body.ends_at === '') patch.ends_at = null;
    else patch.ends_at = Number(body.ends_at);
  }
  if ('ends_on_sellout' in body) patch.ends_on_sellout = !!body.ends_on_sellout;

  try {
    const updated = updatePhase(phaseId, patch, session.name);
    return NextResponse.json({ ok: true, phase: updated });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to update phase.';
    return NextResponse.json({ ok: false, message: msg }, { status: 400 });
  }
}

export async function DELETE(
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

  const result = deletePhase(phaseId, session.name);
  if (!result.ok) {
    return NextResponse.json({ ok: false, message: result.reason || 'Failed to delete phase.' }, { status: 400 });
  }
  return NextResponse.json({ ok: true, softDeleted: result.softDeleted });
}
