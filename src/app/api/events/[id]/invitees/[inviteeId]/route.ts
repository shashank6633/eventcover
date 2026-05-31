import { NextRequest, NextResponse } from 'next/server';
import { getInvitee, updateInvitee, deleteInvitee } from '@/lib/invitees';
import { requireRole } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PATCH /api/events/[id]/invitees/[inviteeId]
 * Body: { name?, plus_ones_allowed?, notes?, reset? }
 *
 * `reset: true` clears the used/used_at/used_reservation_id columns so
 * the invitation can be re-redeemed. Use this when a payment fails after
 * we've already marked the invitee used (e.g. Razorpay webhook never
 * landed but the reservation row stayed pending).
 */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; inviteeId: string }> },
) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  const { id, inviteeId } = await ctx.params;
  const existing = getInvitee(inviteeId);
  if (!existing || existing.event_id !== id) {
    return NextResponse.json({ ok: false, message: 'invitee not found' }, { status: 404 });
  }
  const body = await req.json().catch(() => ({})) as {
    name?: unknown;
    plus_ones_allowed?: unknown;
    notes?: unknown;
    reset?: unknown;
  };

  try {
    const invitee = updateInvitee(
      inviteeId,
      {
        name: 'name' in body ? (typeof body.name === 'string' ? body.name : null) : undefined,
        plus_ones_allowed: body.plus_ones_allowed == null ? undefined : Number(body.plus_ones_allowed),
        notes: 'notes' in body ? (typeof body.notes === 'string' ? body.notes : null) : undefined,
        reset: body.reset === true,
      },
      session.name,
    );
    return NextResponse.json({ ok: true, invitee });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to update invitee.';
    return NextResponse.json({ ok: false, message: msg }, { status: 400 });
  }
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; inviteeId: string }> },
) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  const { id, inviteeId } = await ctx.params;
  const existing = getInvitee(inviteeId);
  if (!existing || existing.event_id !== id) {
    return NextResponse.json({ ok: false, message: 'invitee not found' }, { status: 404 });
  }
  deleteInvitee(inviteeId, session.name);
  return NextResponse.json({ ok: true });
}
