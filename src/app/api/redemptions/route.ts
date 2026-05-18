import { NextResponse } from 'next/server';
import { listRedemptions } from '@/lib/redemption';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const redemptions = listRedemptions();
  return NextResponse.json({ ok: true, redemptions });
}
