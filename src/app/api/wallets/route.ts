import { NextRequest, NextResponse } from 'next/server';
import { issueWallet, listWallets } from '@/lib/wallet';
import { formatExpiry } from '@/lib/expiry';
import { getSession } from '@/lib/auth';
import QRCode from 'qrcode';
import type { PaymentMethod } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_METHODS: PaymentMethod[] = ['cash', 'upi', 'card', 'online', 'comp'];

export async function GET() {
  try {
    const wallets = listWallets();
    return NextResponse.json({ ok: true, wallets });
  } catch (err) {
    return NextResponse.json({ ok: false, message: errMsg(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ ok: false, message: 'Not authenticated.' }, { status: 401 });
    }
    if (!['host', 'manager', 'entry'].includes(session.role)) {
      return NextResponse.json({ ok: false, message: 'Your role cannot issue wallets.' }, { status: 403 });
    }

    const body = await req.json();
    const { name, phone, email, pax, entryFee, coverIssued, paymentMethod, tableId, eventId, reservationId } = body || {};

    if (!name || typeof name !== 'string') {
      return NextResponse.json({ ok: false, message: 'Name is required.' }, { status: 400 });
    }
    if (!phone || typeof phone !== 'string') {
      return NextResponse.json({ ok: false, message: 'Phone is required.' }, { status: 400 });
    }
    const fee = Number(entryFee);
    if (!(fee >= 0)) {
      return NextResponse.json({ ok: false, message: 'Invalid entry fee.' }, { status: 400 });
    }
    if (!VALID_METHODS.includes(paymentMethod)) {
      return NextResponse.json({ ok: false, message: 'Invalid payment method.' }, { status: 400 });
    }

    const result = await issueWallet({
      name: String(name).trim(),
      phone: String(phone).trim(),
      email: email ? String(email).trim() : undefined,
      pax: Number(pax) || 1,
      entryFee: fee,
      coverIssued: coverIssued != null && !isNaN(Number(coverIssued)) ? Number(coverIssued) : undefined,
      paymentMethod,
      issuedBy: session.name,
      tableId: tableId ? String(tableId) : undefined,
      eventId: eventId ? String(eventId) : undefined,
      reservationId: reservationId ? String(reservationId) : undefined,
    });

    const origin = req.nextUrl.origin;
    const captainUrl = `${origin}/admin/redeem?t=${encodeURIComponent(result.txnId)}`;
    const qrDataUrl = await QRCode.toDataURL(captainUrl, { width: 360, margin: 2 });

    return NextResponse.json({
      ok: true,
      txnId: result.txnId,
      pin: result.pin,
      balance: result.balance,
      expiresAt: result.expiresAt,
      expiresAtLabel: formatExpiry(result.expiresAt),
      captainUrl,
      qrDataUrl,
    });
  } catch (err) {
    return NextResponse.json({ ok: false, message: errMsg(err) }, { status: 500 });
  }
}

function errMsg(e: unknown) {
  return e instanceof Error ? e.message : 'Server error';
}
