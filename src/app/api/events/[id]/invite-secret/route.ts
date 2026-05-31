import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { getDb } from '@/lib/db';
import { getEvent } from '@/lib/events';
import { requireRole } from '@/lib/auth';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/events/[id]/invite-secret — reveal current secret to admin.
 *
 * Returns { ok, invite_secret } — never expose via any public route.
 * Caller must be host/manager.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  const { id } = await ctx.params;
  const event = getEvent(id);
  if (!event) return NextResponse.json({ ok: false, message: 'event not found' }, { status: 404 });
  return NextResponse.json({ ok: true, invite_secret: event.invite_secret, access_mode: event.access_mode });
}

/**
 * POST /api/events/[id]/invite-secret — regenerate the secret.
 *
 * Audit-logged. Existing shared links stop working immediately after this
 * call — only do it when you suspect leak (or as part of a fresh rollout).
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  const { id } = await ctx.params;
  const event = getEvent(id);
  if (!event) return NextResponse.json({ ok: false, message: 'event not found' }, { status: 404 });

  const secret = nanoid(20);
  const db = getDb();
  db.prepare('UPDATE events SET invite_secret = ? WHERE id = ?').run(secret, id);

  logAudit({
    actor: session.name,
    action: 'invite_secret_regenerate',
    entityType: 'event',
    entityId: id,
  });

  return NextResponse.json({ ok: true, invite_secret: secret });
}
