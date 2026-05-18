import { NextRequest, NextResponse } from 'next/server';
import { lookupWallet, voidWallet } from '@/lib/wallet';
import { requireRole } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ txnId: string }> }) {
  const { txnId } = await ctx.params;
  const wallet = lookupWallet(txnId);
  if (!wallet) {
    return NextResponse.json({ ok: false, message: 'Transaction not found.' }, { status: 404 });
  }
  return NextResponse.json({
    ok: true,
    wallet: {
      txnId: wallet.txn_id,
      guestName: wallet.name,
      guestPhone: wallet.phone,
      balance: wallet.balance,
      status: wallet.status,
      entryFee: wallet.entry_fee,
      coverIssued: wallet.cover_issued,
      paymentMethod: wallet.payment_method,
      issuedAt: wallet.issued_at,
      expiresAt: wallet.expires_at,
    },
  });
}

/**
 * Void / refund a wallet.
 *
 * Body: { reason?: string; refundAmount?: number }
 *
 * Forces balance to 0 and marks the wallet exhausted. Always lands as a
 * critical `wallet_void` row in the audit log so an admin or cashier reviewing
 * History sees the reversal at a glance.
 *
 * Strictly host-only: reversing real money is an admin-only action. Manager,
 * cashier, captain and entry roles cannot void a wallet.
 */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ txnId: string }> }) {
  const session = await requireRole(['host']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }

  const { txnId } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : undefined;
  const refundAmount =
    typeof body?.refundAmount === 'number' && Number.isFinite(body.refundAmount) && body.refundAmount >= 0
      ? body.refundAmount
      : undefined;

  const wallet = lookupWallet(txnId);
  if (!wallet) {
    return NextResponse.json({ ok: false, message: 'Transaction not found.' }, { status: 404 });
  }
  if (wallet.status !== 'active') {
    return NextResponse.json(
      { ok: false, message: `Wallet is ${wallet.status}. Only active wallets can be voided.` },
      { status: 409 },
    );
  }

  const changed = voidWallet(txnId, session.name, { reason, refundAmount });
  if (!changed) {
    return NextResponse.json(
      { ok: false, message: 'Wallet could not be voided.' },
      { status: 409 },
    );
  }

  return NextResponse.json({ ok: true, txnId, status: 'exhausted', balance: 0 });
}
