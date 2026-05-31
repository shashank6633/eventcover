/**
 * GET / POST /api/events/[id]/manage/post-sale-comm
 *
 * GET  — fetch the per-event post-sale config (defaults when none exists).
 * POST — upsert. Body:
 *          { messageText, attachmentKind: 'none'|'pdf', attachmentUrl, enabled }
 *
 * POST is used instead of PUT because the wizard's existing form posts use
 * POST throughout the codebase — keeping it consistent.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { getEvent } from '@/lib/events';
import { getConfig, upsertConfig, type AttachmentKind } from '@/lib/post-sale-comm';

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
  return NextResponse.json({ ok: true, config: getConfig(id) });
}

function asKind(v: unknown): AttachmentKind | undefined {
  if (v === 'none' || v === 'pdf') return v;
  return undefined;
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
    messageText?: unknown;
    attachmentKind?: unknown;
    attachmentUrl?: unknown;
    enabled?: unknown;
  };

  // 2 MB hard limit on base64 PDF attachments — the risk note in the spec.
  // Rough estimate: base64 inflates payload by 4/3 so 2.7 MB string ≈ 2 MB file.
  const url = typeof body.attachmentUrl === 'string' ? body.attachmentUrl : null;
  if (url && url.startsWith('data:') && url.length > 2.8 * 1024 * 1024) {
    return NextResponse.json(
      { ok: false, message: 'PDF attachment must be under 2 MB. Try linking to an external URL.' },
      { status: 400 },
    );
  }

  try {
    const config = upsertConfig({
      eventId: id,
      messageText: typeof body.messageText === 'string' ? body.messageText : null,
      attachmentKind: asKind(body.attachmentKind),
      attachmentUrl: url,
      enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
      actor: session.name,
    });
    return NextResponse.json({ ok: true, config });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to save config.';
    return NextResponse.json({ ok: false, message: msg }, { status: 400 });
  }
}
