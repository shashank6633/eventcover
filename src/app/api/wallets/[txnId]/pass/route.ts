import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { lookupWallet } from '@/lib/wallet';
import { generatePassPdf } from '@/lib/pdf/pass';
import { getConfig } from '@/lib/db';
import { getEvent } from '@/lib/events';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Generate the A6 cover-pass PDF for a wallet.
 *
 * The wallet's plaintext PIN (now displayed as "QR Code ID") is only
 * available at issue time — the DB stores only the bcrypt hash. So the
 * caller must pass `qrCodeId` in the body.
 *
 * Access:
 *   • host / manager / entry — they're the ones who hand passes to guests
 *
 * Body:
 *   { qrCodeId: string }       — required, the 4-digit code shown to the guest
 *
 * Returns: application/pdf binary stream
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ txnId: string }> }) {
  const session = await requireRole(['host', 'manager', 'entry']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }

  const { txnId } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const qrCodeId = String(body?.qrCodeId || '').trim();

  if (!/^\d{4,8}$/.test(qrCodeId)) {
    return NextResponse.json({ ok: false, message: 'qrCodeId must be 4-8 digits.' }, { status: 400 });
  }

  const wallet = lookupWallet(txnId);
  if (!wallet) {
    return NextResponse.json({ ok: false, message: 'Wallet not found.' }, { status: 404 });
  }

  // Resolve event name (per-wallet event_id wins; falls back to global config).
  // event_id was added as a wallet column in a later migration; the TS type
  // hasn't caught up, so read it off the raw row.
  let eventName = getConfig('EVENT_NAME', '') || undefined;
  const walletEventId = (wallet as unknown as { event_id?: string | null }).event_id;
  if (walletEventId) {
    try {
      const ev = getEvent(walletEventId);
      if (ev?.name) eventName = ev.name;
    } catch { /* ignore */ }
  }

  const venueName = getConfig('VENUE_NAME', 'AKAN Hyderabad');
  const venueLogo = getConfig('VENUE_LOGO', '') || undefined;

  const pdfBytes = await generatePassPdf({
    txnId,
    qrCodeId,
    guestName: wallet.name || 'Guest',
    coverAmount: wallet.cover_issued,
    eventName,
    venueName,
    venueLogo,
    expiresAt: wallet.expires_at,
  });

  logAudit({
    actor: session.name,
    action: 'pass_pdf_generated',
    entityType: 'wallet',
    entityId: txnId,
    details: { guest: wallet.name, cover: wallet.cover_issued, channel: 'download' },
  });

  return new NextResponse(Buffer.from(pdfBytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="cover-pass-${txnId}.pdf"`,
      'Cache-Control': 'no-store',
    },
  });
}
