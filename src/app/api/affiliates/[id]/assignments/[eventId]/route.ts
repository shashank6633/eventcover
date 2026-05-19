import { NextRequest, NextResponse } from 'next/server';
import { unassignEvent } from '@/lib/affiliates';
import { requireRole } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; eventId: string }> },
) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  const { id, eventId } = await params;
  const removed = unassignEvent(id, eventId, session.name);
  if (!removed) {
    return NextResponse.json({ ok: false, message: 'Assignment not found.' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
