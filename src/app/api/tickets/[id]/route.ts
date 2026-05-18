import { NextRequest, NextResponse } from 'next/server';
import { cancelTicket } from '@/lib/tickets';
import { requireRole } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Cancel an offline ticket. Strictly host-only — cancellation reverses a real
 * sale and is the kind of action an admin needs to own end-to-end.
 */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['host']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  const { id } = await ctx.params;
  const t = cancelTicket(id, session.name);
  if (!t) return NextResponse.json({ ok: false, message: 'Not found.' }, { status: 404 });
  return NextResponse.json({ ok: true, ticket: t });
}
