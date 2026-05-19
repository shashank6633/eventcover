import { NextRequest, NextResponse } from 'next/server';
import {
  listAssignments,
  assignEvent,
  getAffiliate,
  type CommissionType,
} from '@/lib/affiliates';
import { requireRole } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  const { id } = await params;
  const aff = getAffiliate(id);
  if (!aff) return NextResponse.json({ ok: false, message: 'Not found.' }, { status: 404 });
  return NextResponse.json({ ok: true, assignments: listAssignments(id) });
}

/**
 * POST adds or updates an event assignment.
 *   body: { eventId, commissionType?, commissionValue? }
 * Returns the upserted assignment. Acts as a PUT semantically.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  const { id } = await params;
  const aff = getAffiliate(id);
  if (!aff) return NextResponse.json({ ok: false, message: 'Not found.' }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  try {
    const cType: CommissionType | null =
      body.commissionType === 'percent' || body.commissionType === 'flat'
        ? body.commissionType
        : null;
    const cValue =
      body.commissionValue === null || body.commissionValue === undefined || body.commissionValue === ''
        ? null
        : Number(body.commissionValue);

    const assignment = assignEvent(id, String(body.eventId || ''), cType, cValue, session.name);
    return NextResponse.json({ ok: true, assignment });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to assign event.';
    return NextResponse.json({ ok: false, message: msg }, { status: 400 });
  }
}
