import { NextRequest, NextResponse } from 'next/server';
import { getMedia, updateMedia, deleteMedia } from '@/lib/event-media';
import { requireRole } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PATCH /api/events/[id]/media/[mediaId] — update caption only.
 * Body: { caption: string | null }
 */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; mediaId: string }> },
) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  const { id, mediaId } = await ctx.params;
  const existing = getMedia(mediaId);
  if (!existing || existing.event_id !== id) {
    return NextResponse.json({ ok: false, message: 'media not found' }, { status: 404 });
  }
  const body = await req.json().catch(() => ({})) as { caption?: unknown };
  const media = updateMedia(
    mediaId,
    { caption: typeof body.caption === 'string' ? body.caption : null },
    session.name,
  );
  return NextResponse.json({ ok: true, media });
}

/**
 * DELETE /api/events/[id]/media/[mediaId] — remove a media item.
 * Sort_order gaps are fine — listMedia orders by ASC and the public
 * carousel renders in order, so a gap simply becomes one position closer.
 */
export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; mediaId: string }> },
) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  const { id, mediaId } = await ctx.params;
  const existing = getMedia(mediaId);
  if (!existing || existing.event_id !== id) {
    return NextResponse.json({ ok: false, message: 'media not found' }, { status: 404 });
  }
  deleteMedia(mediaId, session.name);
  return NextResponse.json({ ok: true });
}
