import { NextRequest, NextResponse } from 'next/server';
import { verifyWalletPassToken } from '@/lib/signed-url';
import { lookupWallet } from '@/lib/wallet';
import { generatePassImage } from '@/lib/pdf/pass-image';
import { getConfig } from '@/lib/db';
import { getEvent } from '@/lib/events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/public/wallet-pass/[token]
 *
 * PUBLIC, no auth — gated by HMAC-signed token instead. Returns the wallet
 * pass PNG.
 *
 * Designed for Interakt's URL-fetch flow: when we send a WhatsApp template
 * with an IMAGE header, Interakt's server fetches the URL we provide and
 * forwards the image to the customer. Their fetcher has no session cookie,
 * so we authorise via a per-message token rather than role-gating.
 *
 * Cache: public, 1 day. The token itself is short-lived (30 days default),
 * so Interakt + WhatsApp's CDN can safely cache. Customers who re-open the
 * chat a week later still see the image.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const payload = verifyWalletPassToken(token);
  if (!payload) {
    return NextResponse.json({ ok: false, message: 'Invalid or expired link.' }, { status: 404 });
  }

  const wallet = lookupWallet(payload.txnId);
  if (!wallet) {
    return NextResponse.json({ ok: false, message: 'Wallet not found.' }, { status: 404 });
  }
  // Don't serve passes for voided / exhausted wallets — the QR is dead and
  // showing it to the customer creates a confusing door-side rejection.
  if (wallet.status === 'exhausted') {
    return NextResponse.json({ ok: false, message: 'Pass no longer valid.' }, { status: 410 });
  }

  // Resolve event name + date the same way the admin endpoint does. Also
  // pull ticket_design so the WhatsApp PNG matches the live wizard preview
  // (Phase 4) — when wallet has no event link we fall through to defaults.
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
    txnId: payload.txnId,
    qrCodeId: payload.qrCodeId,
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

  return new NextResponse(png as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Content-Length': String(png.length),
      // Long-lived public cache — token already gates access + auto-expires
      'Cache-Control': 'public, max-age=86400, immutable',
      'Content-Disposition': `inline; filename="cover-pass-${payload.txnId}.png"`,
    },
  });
}
