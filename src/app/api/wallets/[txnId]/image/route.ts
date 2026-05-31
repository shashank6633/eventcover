import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { lookupWallet } from '@/lib/wallet';
import { generatePassImage } from '@/lib/pdf/pass-image';
import { getConfig } from '@/lib/db';
import { getEvent } from '@/lib/events';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/wallets/[txnId]/image?qrCodeId=NNNN
 *
 * Returns a PNG of the cover-pass — optimised for WhatsApp inline delivery
 * and door-side QR scans. Same content as the PDF endpoint but rendered as
 * an image so the customer doesn't need to open a viewer.
 *
 * GET (not POST) because Interakt's WhatsApp media-template flow sends a
 * URL that their server fetches. URLs need to be GETtable without a body.
 * Auth: signed via a short-lived ?sig= query in a future iteration; for now
 * gated to host/manager/entry so internal previews work via the admin shell.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ txnId: string }> }) {
  const session = await requireRole(['host', 'manager', 'entry']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }

  const { txnId } = await ctx.params;
  const qrCodeId = req.nextUrl.searchParams.get('qrCodeId')?.trim() || '';

  const wallet = lookupWallet(txnId);
  if (!wallet) {
    return NextResponse.json({ ok: false, message: 'Wallet not found.' }, { status: 404 });
  }

  // Resolve event name + date (per-wallet event_id wins; falls back to config)
  // Also pluck ticket_design so the PNG honours the host's per-event design
  // overrides (Phase 4). When the wallet isn't tied to an event we leave the
  // design undefined and the renderer falls back to brand defaults.
  let eventName: string | undefined;
  let eventDate: string | undefined;
  let ticketDesign: import('@/lib/ticket-design').TicketDesign | undefined;
  const walletEventId = (wallet as unknown as { event_id?: string | null }).event_id;
  if (walletEventId) {
    try {
      const ev = getEvent(walletEventId);
      if (ev) {
        eventName = ev.name;
        eventDate = ev.event_date;
        ticketDesign = ev.ticket_design;
      }
    } catch { /* ignore */ }
  }
  if (!eventName) eventName = getConfig('EVENT_NAME', '') || undefined;
  if (!eventDate) eventDate = getConfig('EVENT_DATE', '') || undefined;

  const venueName = getConfig('VENUE_NAME', 'AKAN Hyderabad');
  const venueLogo = getConfig('VENUE_LOGO', '') || undefined;

  const png = await generatePassImage({
    txnId,
    qrCodeId: qrCodeId || undefined,
    guestName: wallet.name || 'Guest',
    coverAmount: wallet.cover_issued,
    eventName,
    eventDate,
    pax: (wallet as unknown as { pax?: number }).pax,
    venueName,
    venueLogo,
    expiresAt: wallet.expires_at,
    ticket_design: ticketDesign,
  });

  logAudit({
    actor: session.name,
    action: 'pass_png_generated',
    entityType: 'wallet',
    entityId: txnId,
    details: { guest: wallet.name, cover: wallet.cover_issued, channel: 'image' },
  });

  return new NextResponse(png as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Content-Length': String(png.length),
      // Cache for 5 min — gives Interakt's fetcher time to grab + send
      'Cache-Control': 'private, max-age=300',
      'Content-Disposition': `inline; filename="cover-pass-${txnId}.png"`,
    },
  });
}
