import { NextRequest, NextResponse } from 'next/server';
import { listMedia, addMedia, reorderMedia } from '@/lib/event-media';
import { getEvent } from '@/lib/events';
import { requireRole } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/events/[id]/media — admin list ordered by sort_order.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  const { id } = await ctx.params;
  const event = getEvent(id);
  if (!event) return NextResponse.json({ ok: false, message: 'event not found' }, { status: 404 });
  return NextResponse.json({ ok: true, media: listMedia(id) });
}

/**
 * POST /api/events/[id]/media — append a new media item.
 * Body: { image_data, caption? }
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
    image_data?: unknown;
    caption?: unknown;
  };

  try {
    const media = addMedia({
      eventId: id,
      image_data: String(body.image_data ?? ''),
      caption: typeof body.caption === 'string' ? body.caption : null,
      createdBy: session.name,
    });
    return NextResponse.json({ ok: true, media });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to add media.';
    return NextResponse.json({ ok: false, message: msg }, { status: 400 });
  }
}

/**
 * PATCH /api/events/[id]/media — bulk reorder.
 * Body: { orderedIds: string[] }
 *
 * Note: per-item caption updates live on /api/events/[id]/media/[mediaId].
 * This endpoint is the batched reorder path the drag-handle UI fires on drop.
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
    return NextResponse.json({ ok: false, message: 'orderedIds must be an array of media ids.' }, { status: 400 });
  }
  const ids = (body.orderedIds as unknown[]).filter((v): v is string => typeof v === 'string' && v.length > 0);
  try {
    const media = reorderMedia(id, ids, session.name);
    return NextResponse.json({ ok: true, media });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to reorder media.';
    return NextResponse.json({ ok: false, message: msg }, { status: 400 });
  }
}
