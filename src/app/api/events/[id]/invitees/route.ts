import { NextRequest, NextResponse } from 'next/server';
import { getEvent } from '@/lib/events';
import { listInvitees, addInvitee } from '@/lib/invitees';
import { requireRole } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/events/[id]/invitees — admin list (host/manager only).
 *
 * Note: never expose this endpoint publicly. The invite list is a private
 * allowlist — only the host should see the phone numbers.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  const { id } = await ctx.params;
  const event = getEvent(id);
  if (!event) return NextResponse.json({ ok: false, message: 'event not found' }, { status: 404 });
  return NextResponse.json({ ok: true, invitees: listInvitees(id) });
}

/**
 * POST /api/events/[id]/invitees — add a single invitee.
 * Body: { phone, name?, plus_ones_allowed?, notes? }
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
    phone?: unknown;
    name?: unknown;
    plus_ones_allowed?: unknown;
    notes?: unknown;
  };

  try {
    const invitee = addInvitee({
      eventId: id,
      phone: String(body.phone ?? ''),
      name: typeof body.name === 'string' ? body.name : null,
      plus_ones_allowed: body.plus_ones_allowed == null ? 0 : Number(body.plus_ones_allowed),
      notes: typeof body.notes === 'string' ? body.notes : null,
      createdBy: session.name,
    });
    return NextResponse.json({ ok: true, invitee });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to add invitee.';
    return NextResponse.json({ ok: false, message: msg }, { status: 400 });
  }
}
