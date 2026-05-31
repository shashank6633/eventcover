/**
 * GET /api/reservations/qr-png/[token]
 *
 * PUBLIC endpoint — no session auth. Access is gated by the HMAC-signed
 * reservation QR token. Returns a PNG QR image encoding a deep link that
 * opens the captain scan screen pre-loaded with the same token.
 *
 * Purpose: WhatsApp delivery on reservation confirmation. Interakt's media
 * fetcher hits this URL with no cookie, so we authorise via the token
 * itself. The token has a 1-year TTL — practical replay protection comes
 * from the reservation_status='closed' guard and the cover/remaining-pax
 * limits the scan endpoints check inside their mutation tx.
 *
 * QR payload: '<origin>/admin/scan?token=<token>' — when a captain scans
 * a printed pass, their phone camera opens the EventCover scan screen
 * directly with the token already filled in.
 */
import { NextRequest, NextResponse } from 'next/server';
import QRCode from 'qrcode';
import sharp from 'sharp';
import { verifyReservationQrToken } from '@/lib/signed-url';
import { getReservationSummary } from '@/lib/reservation-ledger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Output dimensions. 800px keeps the PNG sharp on phone displays at door
// distance while staying small enough that WhatsApp doesn't recompress it.
const PNG_SIZE = 800;

export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const decoded = decodeURIComponent(token);
  const payload = verifyReservationQrToken(decoded);
  if (!payload) {
    return NextResponse.json(
      { ok: false, message: 'Invalid or expired link.' },
      { status: 404 },
    );
  }
  // We don't strictly need the reservation row to render the QR (the token
  // already encodes the id), but a 404 here surfaces deletions cleanly
  // instead of handing out a QR that goes nowhere on scan.
  const summary = getReservationSummary(payload.reservationId);
  if (!summary) {
    return NextResponse.json(
      { ok: false, message: 'Reservation not found.' },
      { status: 404 },
    );
  }

  // Embed the scan-screen deep link, NOT the bare token. When a phone
  // camera resolves the QR it opens the URL directly — saves the captain
  // a "tap to copy / paste into app" round-trip.
  const origin = req.nextUrl.origin;
  const scanUrl = `${origin}/admin/scan?token=${encodeURIComponent(decoded)}`;

  // SVG output → sharp → PNG. Same pipeline as the wallet pass image so
  // we don't bring in canvas/Chromium. Margin 1 module = tight crop but
  // still scannable; error correction M (15%) gives some forgiveness for
  // photo-of-a-screen captures at the door.
  const qrSvg = await QRCode.toString(scanUrl, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 1,
    width: PNG_SIZE,
    color: { dark: '#000000', light: '#FFFFFF' },
  });

  const png = await sharp(Buffer.from(qrSvg))
    .resize(PNG_SIZE, PNG_SIZE, { fit: 'contain', background: '#FFFFFF' })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();

  return new NextResponse(png as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Content-Length': String(png.length),
      // 1-day public cache: the token-bound URL is stable for the token's
      // lifetime (365d), so re-serving the same PNG is safe. WhatsApp CDN
      // caches via Cache-Control; we want the customer to be able to
      // re-open the chat a week later and still see the QR.
      'Cache-Control': 'public, max-age=86400',
      'Content-Disposition': `inline; filename="reservation-${summary.reservation_id}.png"`,
    },
  });
}
