/**
 * POST /api/reservations/[id]/send-payment-link
 *
 * Mints a signed prepay token, persists it on the reservation row, and
 * returns the shareable URL the host can drop into WhatsApp / SMS / a
 * QR code at the front desk.
 *
 * Phase 1 of the Reservego-prepay flow:
 *   - Token is signed by signReservationPrepayToken() with TTL 7 days
 *   - Reservation row gets payment_link_token + payment_link_sent_at set
 *   - Returns { ok, url, token, expiresAt }
 *
 * Phase 3 (future task #70) will add an `autoSend: true` branch that also
 * fires the Interakt template here. Today the host copies the URL to the
 * clipboard from the admin UI and pastes it into WhatsApp manually — same
 * result, just one tap instead of zero.
 *
 * Idempotency: calling this twice on the same reservation REPLACES the
 * token with a fresh one. That's intentional — host might want to extend
 * the TTL or invalidate the previous link if the guest never paid.
 *
 * Roles: host, manager.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { getReservation } from '@/lib/reservations';
import { signReservationPrepayToken } from '@/lib/signed-url';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }

  const { id } = await ctx.params;
  const reservation = getReservation(id);
  if (!reservation) {
    return NextResponse.json({ ok: false, message: 'Reservation not found.' }, { status: 404 });
  }
  if (reservation.status === 'cancelled') {
    return NextResponse.json(
      { ok: false, message: 'Cannot send a payment link for a cancelled reservation.' },
      { status: 400 },
    );
  }
  if (reservation.status === 'converted') {
    return NextResponse.json(
      { ok: false, message: 'Reservation already paid — no need to send another link.' },
      { status: 400 },
    );
  }

  // Mint token with the default 7-day TTL. We don't expose ttlSeconds in
  // the request body for Phase 1 — keeping the surface area small. Future
  // iterations can add a "extend link" UX with custom TTLs.
  const token = signReservationPrepayToken({ reservationId: reservation.id });
  const now = Date.now();
  const expiresAt = now + 7 * 24 * 60 * 60 * 1000;

  // Persist on the row so the admin UI can render the "Link sent X minutes
  // ago" status pill without re-minting. We deliberately overwrite the
  // previous token (rather than appending) — only the latest link is the
  // one the guest should use.
  const db = getDb();
  db.prepare(`
    UPDATE reservations
    SET payment_link_token = ?, payment_link_sent_at = ?
    WHERE id = ?
  `).run(token, now, reservation.id);

  // Derive the public URL from the inbound request's origin so the same
  // server can serve dev (localhost:3100) and prod (wallet.akanhyd.com)
  // without an env var. We trust x-forwarded-host when proxied (Hostinger
  // sets it correctly); fall back to req.nextUrl.origin otherwise.
  const proto = req.headers.get('x-forwarded-proto') || req.nextUrl.protocol.replace(':', '');
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || req.nextUrl.host;
  const origin = `${proto}://${host}`;
  const url = `${origin}/p/${encodeURIComponent(token)}`;

  logAudit({
    actor: session.name,
    action: 'reservation_payment_link_sent',
    entityType: 'reservation',
    entityId: reservation.id,
    details: {
      provider: reservation.provider,
      event_id: reservation.event_id,
      phone: reservation.phone,
      // Don't log the full URL/token in audit — payload bytes here are
      // searchable, and you don't want the signed token grep-able in logs.
      // Logging the ms timestamp is enough to correlate with later events.
      sent_at: now,
    },
  });

  return NextResponse.json({
    ok: true,
    url,
    token,
    expiresAt,
    /** Pre-baked wa.me deep link so the admin UI can render a one-tap
     *  "WhatsApp this guest" button without re-deriving on the client. */
    whatsappUrl: buildWhatsappShare(reservation.phone, reservation.name, url),
  });
}

/**
 * Build a wa.me deep link that opens WhatsApp with a pre-typed message
 * containing the payment URL. Customer can edit before sending; we don't
 * try to send programmatically here (that would need an Interakt template
 * approval — Phase 3 will wire that up).
 */
function buildWhatsappShare(phone: string, name: string, url: string): string | null {
  // wa.me requires a country-coded phone with no + or spaces. Phones are
  // already stored in normalized E.164 form (+919876500001) — strip the +.
  const digits = phone.replace(/^\+/, '').replace(/[^\d]/g, '');
  if (digits.length < 10) return null;

  const message =
    `Hi ${name.split(' ')[0]},\n\n` +
    `Your table is confirmed. To skip the door queue, please pay your cover charge in advance using this link:\n\n` +
    `${url}\n\n` +
    `Link expires in 7 days. See you soon!`;

  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}
