import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { markRecovered } from '@/lib/abandoned-bookings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/abandoned-bookings/[id]/recover
 *
 * Body: { note?: string }
 * Marks the abandoned booking as recovered (customer settled offline / was
 * contacted / etc.). The `id` is the prefixed form returned by listing
 * ("payment:xxx" or "reservation:xxx").
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }

  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({})) as { note?: string };
  const note = body.note ? String(body.note).trim().slice(0, 280) : undefined;

  const result = markRecovered(id, session.name, note);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, message: result.reason || 'Could not mark recovered.' },
      { status: result.reason === 'not_found_or_already_settled' ? 409 : 400 },
    );
  }

  logAudit({
    actor: session.name,
    action: 'abandoned_booking_recovered',
    entityType: id.startsWith('payment:') ? 'payment' : 'reservation',
    entityId: id.split(':')[1],
    details: { note: note || null },
  });

  return NextResponse.json({ ok: true });
}
