/**
 * GET  /api/events/[id]/manage/recap-media — list recap photos.
 * POST /api/events/[id]/manage/recap-media — add one.
 *
 * Body for POST: { image_data: string (data: URL or https URL), caption?: string }
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { getEvent } from '@/lib/events';
import { list, add } from '@/lib/event-recap-media';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  const { id } = await ctx.params;
  const ev = getEvent(id);
  if (!ev) return NextResponse.json({ ok: false, message: 'Event not found.' }, { status: 404 });
  return NextResponse.json({ ok: true, media: list(id) });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  const { id } = await ctx.params;
  const ev = getEvent(id);
  if (!ev) return NextResponse.json({ ok: false, message: 'Event not found.' }, { status: 404 });

  const body = await req.json().catch(() => ({})) as {
    image_data?: unknown;
    caption?: unknown;
  };

  // 5 MB hard limit per image — recap galleries can be 50+ photos so we
  // don't want to bloat the SQLite file with anyone uploading huge originals.
  const data = typeof body.image_data === 'string' ? body.image_data : '';
  if (data.startsWith('data:') && data.length > 7 * 1024 * 1024) {
    return NextResponse.json(
      { ok: false, message: 'Image must be under 5 MB.' },
      { status: 400 },
    );
  }

  try {
    const media = add({
      eventId: id,
      image_data: data,
      caption: typeof body.caption === 'string' ? body.caption : null,
      createdBy: session.name,
    });
    return NextResponse.json({ ok: true, media });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to add recap photo.';
    return NextResponse.json({ ok: false, message: msg }, { status: 400 });
  }
}
