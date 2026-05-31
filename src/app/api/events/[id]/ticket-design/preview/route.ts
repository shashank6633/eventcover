/**
 * POST /api/events/[id]/ticket-design/preview
 *
 * Renders a wallet pass PNG on the fly using a partial TicketDesign sent in
 * the body — does NOT persist anything. Wizard's "live preview" panel hits
 * this on every (debounced) color/toggle change so the host can see exactly
 * what the customer's WhatsApp will look like before saving.
 *
 * Auth: host or manager only. Bad hex / unknown layout values pass through
 * parseTicketDesign() which snaps them back to defaults rather than 400ing,
 * so a draft state in the editor never blocks the preview.
 *
 * Performance: a tiny in-memory rate limit (mirrors /api/payments/order)
 * keeps an authenticated host from spamming sharp + svg renders if the
 * client-side debounce ever misfires.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { getEvent } from '@/lib/events';
import { generatePassImage } from '@/lib/pdf/pass-image';
import { parseTicketDesign } from '@/lib/ticket-design';
import { getConfig } from '@/lib/db';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ─── In-memory rate limit ─────────────────────────────────────────────────
// 30 previews / session / 60s — leaves ample headroom for a 350ms debounced
// slider but stops a runaway loop from melting libvips.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 30;
const sessionHits = new Map<string, number[]>();
let lastCleanupAt = 0;

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  if (now - lastCleanupAt > 60_000) {
    lastCleanupAt = now;
    for (const [k, hits] of sessionHits) {
      const filtered = hits.filter((t) => now - t < RATE_WINDOW_MS);
      if (filtered.length === 0) sessionHits.delete(k);
      else sessionHits.set(k, filtered);
    }
  }
  const hits = sessionHits.get(key) || [];
  const recent = hits.filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_MAX) return false;
  recent.push(now);
  sessionHits.set(key, recent);
  return true;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }

  if (!checkRateLimit(session.sub || session.name || 'anon')) {
    return NextResponse.json(
      { ok: false, message: 'Too many previews — slow down a bit and retry.' },
      { status: 429 },
    );
  }

  const { id } = await ctx.params;
  const event = getEvent(id);
  if (!event) {
    return NextResponse.json({ ok: false, message: 'Event not found.' }, { status: 404 });
  }

  let body: { ticket_design?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    // No body → fall through to defaults; lets the wizard call this on first
    // mount before the user touches any control.
  }

  // Merge over the event's currently-saved design so the preview reflects
  // what the host has + what they're currently editing. parseTicketDesign()
  // sanitizes the merged object — bad hex / unknown layout → defaults.
  const merged = { ...event.ticket_design, ...(body.ticket_design || {}) } as Record<string, unknown>;
  const design = parseTicketDesign(merged);

  const venueName = getConfig('VENUE_NAME', 'AKAN Hyderabad');

  const png = await generatePassImage({
    txnId: 'PREVIEW',
    qrCodeId: 'PREVIEW',
    guestName: 'Preview Guest',
    coverAmount: 2000,
    eventName: event.name,
    eventDate: event.event_date,
    pax: 1,
    venueName,
    expiresAt: null,
    ticket_design: design,
  });

  logAudit({
    actor: session.name,
    action: 'event_ticket_design_preview',
    entityType: 'event',
    entityId: id,
    details: { layout: design.layout },
  });

  return new NextResponse(png as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Content-Length': String(png.length),
      // No caching — every keystroke should re-render.
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Content-Disposition': 'inline; filename="ticket-design-preview.png"',
    },
  });
}
