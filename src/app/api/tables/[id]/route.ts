import { NextRequest, NextResponse } from 'next/server';
import { updateTable, deleteTable, TABLE_STATUSES, type TableStatus } from '@/lib/tables';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json();
  const patch: Record<string, string | number | null> = {};
  if (typeof body.label === 'string') patch.label = body.label.trim();
  if (typeof body.capacity === 'number' || !isNaN(Number(body.capacity))) patch.capacity = Number(body.capacity);
  if ('zone' in body) patch.zone = body.zone ? String(body.zone).trim() : null;
  if ('notes' in body) patch.notes = body.notes ? String(body.notes).trim() : null;
  if (typeof body.status === 'string') {
    if (!TABLE_STATUSES.includes(body.status as TableStatus)) {
      return NextResponse.json({ ok: false, message: `Invalid status. One of: ${TABLE_STATUSES.join(', ')}` }, { status: 400 });
    }
    patch.status = body.status;
  }
  if ('active_wallet_txn' in body) {
    patch.active_wallet_txn = body.active_wallet_txn ? String(body.active_wallet_txn).trim() : null;
  }
  const table = updateTable(id, patch);
  if (!table) return NextResponse.json({ ok: false, message: 'Table not found.' }, { status: 404 });
  return NextResponse.json({ ok: true, table });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const ok = deleteTable(id);
  if (!ok) return NextResponse.json({ ok: false, message: 'Table not found.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
