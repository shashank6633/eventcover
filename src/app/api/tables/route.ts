import { NextRequest, NextResponse } from 'next/server';
import { listTables, createTable } from '@/lib/tables';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ ok: true, tables: listTables() });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const label = String(body?.label || '').trim();
  if (!label) {
    return NextResponse.json({ ok: false, message: 'Label is required.' }, { status: 400 });
  }
  const table = createTable({
    label,
    capacity: Number(body?.capacity) || 4,
    zone: body?.zone ? String(body.zone).trim() : undefined,
    notes: body?.notes ? String(body.notes).trim() : undefined,
  });
  return NextResponse.json({ ok: true, table });
}
