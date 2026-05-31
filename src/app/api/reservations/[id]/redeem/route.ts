/**
 * POST /api/reservations/[id]/redeem
 *
 * Body: { amount: number, billId?: string, notes?: string }
 *
 * Debits the reservation's cover balance. Bill-id collision is enforced by
 * a partial unique index (reservation_id, bill_id) WHERE status='success'.
 * The same bill cannot be charged twice while active; reversing a
 * redemption drops it from the index so a corrected bill can be re-billed.
 *
 * Roles: captain (primary), manager, host.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { redeemCover } from '@/lib/cover-redemption';
import { getReservationSummary } from '@/lib/reservation-ledger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RedeemBody {
  amount?: unknown;
  billId?: unknown;
  bill_id?: unknown;     // accept snake_case too — scan UI may send either
  notes?: unknown;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['host', 'manager', 'captain']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  const { id } = await ctx.params;

  const body = (await req.json().catch(() => ({}))) as RedeemBody;
  const rawAmount = typeof body.amount === 'number' ? body.amount : Number(body.amount);
  if (!Number.isFinite(rawAmount) || rawAmount <= 0) {
    return NextResponse.json(
      { ok: false, message: 'amount must be a positive number.' },
      { status: 400 },
    );
  }
  const billIdRaw = body.billId ?? body.bill_id;
  const billId = typeof billIdRaw === 'string' ? billIdRaw : null;
  const notes = typeof body.notes === 'string' ? body.notes : null;

  const result = redeemCover({
    reservationId: id,
    amount: rawAmount,
    actor: session.name,
    billId,
    notes,
  });

  if (!result.ok) {
    // 404 for missing; 409 for over-redeem, closed, duplicate-bill, cancelled.
    const status = result.reason === 'not_found' ? 404 : 409;
    return NextResponse.json({ ok: false, message: result.message, reason: result.reason }, { status });
  }

  const reservation = getReservationSummary(id);
  // rawAmount is already validated (> 0) and the lib enforces the balance
  // ceiling inside its tx, so reporting rawAmount back here is accurate.
  // The lib may round to 2dp internally; the UI only accepts integer rupees
  // today so that's not observable.
  return NextResponse.json({
    ok: true,
    redemptionId: result.redemptionId,
    reservation,
    amount_redeemed: rawAmount,
  });
}
