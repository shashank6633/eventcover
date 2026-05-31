/**
 * /api/events/[id]/seating-layout
 *
 * Companion to /seating-svg — handles toggle-only updates without forcing
 * a re-upload of the SVG. Useful when the host just wants to turn the
 * feature off without losing the uploaded layout.
 *
 *   PATCH — body { enabled?: boolean, phases_enabled?: boolean }
 *           Persists the boolean flags. Does NOT touch seating_layout_svg.
 *
 * Auth: host / manager (matches the event admin surface).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getEvent, updateEvent } from '@/lib/events';
import { requireRole } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  const { id } = await ctx.params;
  const event = getEvent(id);
  if (!event) return NextResponse.json({ ok: false, message: 'event not found' }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as {
    enabled?: unknown;
    phases_enabled?: unknown;
  };

  const patch: { seating_layout_enabled?: boolean; seating_layout_phases_enabled?: boolean } = {};
  if ('enabled' in body) patch.seating_layout_enabled = !!body.enabled;
  if ('phases_enabled' in body) patch.seating_layout_phases_enabled = !!body.phases_enabled;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { ok: false, message: 'No supported fields to update.' },
      { status: 400 },
    );
  }

  const updated = updateEvent(id, patch);
  return NextResponse.json({
    ok: true,
    enabled: !!updated?.seating_layout_enabled,
    phases_enabled: !!updated?.seating_layout_phases_enabled,
  });
}
