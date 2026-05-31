import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { sendWalletPassWhatsApp } from '@/lib/whatsapp/wallet-pass-send';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/whatsapp/wallet-pass/[txnId]
 *
 * Admin "Resend pass via WhatsApp" trigger. Used by the issue result screen
 * when the auto-send failed (Interakt down, customer typo'd phone, etc.) or
 * when staff want to push it again as a reminder.
 *
 * Force-sends regardless of AUTO_SEND_WHATSAPP_PASS toggle — the operator
 * making this call IS the decision.
 *
 * Body (optional): { qrCodeId?: string } — the 4-digit short code shown
 * under the QR. If omitted, the PNG renders without it.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ txnId: string }> }) {
  const session = await requireRole(['host', 'manager', 'entry']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }

  const { txnId } = await ctx.params;
  const body = await req.json().catch(() => ({})) as { qrCodeId?: string };

  const origin = req.nextUrl.origin;
  const result = await sendWalletPassWhatsApp({
    txnId,
    origin,
    qrCodeId: body.qrCodeId,
    actor: session.name,
    force: true,
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, message: result.error || result.skipped || 'WhatsApp send failed.' },
      { status: 400 },
    );
  }
  return NextResponse.json({
    ok: true,
    messageId: result.messageId,
    message: 'WhatsApp pass sent.',
  });
}
