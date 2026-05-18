import { NextRequest, NextResponse } from 'next/server';
import { redeemWallet } from '@/lib/redemption';
import { getSession } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, ctx: { params: Promise<{ txnId: string }> }) {
  const { txnId } = await ctx.params;
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ ok: false, message: 'Not authenticated.' }, { status: 401 });
    }
    if (!['host', 'manager', 'captain'].includes(session.role)) {
      return NextResponse.json({ ok: false, message: 'Your role cannot redeem wallets.' }, { status: 403 });
    }

    const body = await req.json();
    const { pin, amount, orderRef, notes } = body || {};

    if (!pin || !/^\d{4,8}$/.test(String(pin))) {
      return NextResponse.json({ ok: false, message: 'QR Code ID must be 4–8 digits.' }, { status: 400 });
    }
    const amt = Number(amount);
    if (!(amt > 0)) {
      return NextResponse.json({ ok: false, message: 'Amount must be greater than zero.' }, { status: 400 });
    }

    const result = await redeemWallet({
      txnId,
      pin: String(pin).trim(),
      amount: amt,
      captain: session.name,
      orderRef: orderRef ? String(orderRef).trim() : undefined,
      notes: notes ? String(notes).trim() : undefined,
    });

    const status = result.ok ? 200 : 400;
    return NextResponse.json(result, { status });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Server error';
    return NextResponse.json({ ok: false, message: msg }, { status: 500 });
  }
}
