import { NextResponse } from 'next/server';
import { computeDashboard } from '@/lib/dashboard';
import { getAllConfig } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const kpis = computeDashboard();
  const config = getAllConfig();
  return NextResponse.json({ ok: true, kpis, config });
}
