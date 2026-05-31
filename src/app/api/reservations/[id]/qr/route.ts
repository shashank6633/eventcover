/**
 * GET /api/reservations/[id]/qr
 *
 * Returns a fresh HMAC-signed QR token for the reservation, plus a public
 * URL that renders the QR as a PNG (see qr-png/[token]/route.ts). Door
 * staff get the QR baked into the reservation pass already; this endpoint
 * exists so the manager/host detail page can show a regenerate-and-print
 * action without needing to re-render the whole pass.
 *
 * Roles: entry, captain, manager, host. We allow scan-station roles to
 * mint too because the WhatsApp template-fill on confirmation runs through
 * the host's session — keeping the gate broad means the same helper works
 * from background jobs that boot as the issuing host.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { signReservationQrToken } from '@/lib/signed-url';
import { getReservationSummary } from '@/lib/reservation-ledger';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['host', 'manager', 'captain', 'entry']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  const { id } = await ctx.params;
  const summary = getReservationSummary(id);
  if (!summary) {
    return NextResponse.json({ ok: false, message: 'Reservation not found.' }, { status: 404 });
  }

  const token = signReservationQrToken({ reservationId: id });
  // Use the inbound request origin so the QR URL matches whatever host the
  // operator is on (works for localhost dev, prod domain, and a future
  // wallet.akanhyd.com flip without code changes).
  const origin = req.nextUrl.origin;
  const qrUrl = `${origin}/api/reservations/qr-png/${encodeURIComponent(token)}`;

  logAudit({
    actor: session.name,
    action: 'reservation_qr_mint',
    entityType: 'reservation',
    entityId: id,
    details: { ttl_days: 365 },
  });

  return NextResponse.json({ ok: true, reservation: summary, token, qrUrl });
}
