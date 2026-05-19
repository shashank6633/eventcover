import { NextRequest, NextResponse } from 'next/server';
import {
  listAffiliates,
  createAffiliate,
  listAssignments,
  type CommissionType,
  type AffiliateEventAssignmentInput,
} from '@/lib/affiliates';
import { requireRole } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  const affiliates = listAffiliates().map((a) => ({
    ...a,
    assignments: listAssignments(a.id),
  }));
  return NextResponse.json({ ok: true, affiliates });
}

export async function POST(req: NextRequest) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }

  const body = await req.json().catch(() => ({}));
  try {
    // Sanitize event assignments
    const rawAssignments = Array.isArray(body.eventAssignments) ? body.eventAssignments : [];
    const eventAssignments: AffiliateEventAssignmentInput[] = rawAssignments
      .filter((a: { eventId?: unknown }) => typeof a?.eventId === 'string' && a.eventId.length > 0)
      .map((a: { eventId: string; commissionType?: string; commissionValue?: number | string | null }) => ({
        eventId: a.eventId,
        commissionType: (a.commissionType === 'percent' || a.commissionType === 'flat'
          ? (a.commissionType as CommissionType)
          : null) || null,
        commissionValue:
          a.commissionValue === null || a.commissionValue === undefined || a.commissionValue === ''
            ? null
            : Number(a.commissionValue),
      }));

    const aff = createAffiliate({
      name: String(body.name || ''),
      phone: body.phone ?? null,
      email: body.email ?? null,
      code: body.code ?? null,
      commissionType: (body.commissionType || 'percent') as CommissionType,
      commissionValue: Number(body.commissionValue ?? 10),
      notes: body.notes ?? null,
      createdBy: session.name,
      eventAssignments,
    });
    return NextResponse.json({ ok: true, affiliate: aff });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to create affiliate.';
    return NextResponse.json({ ok: false, message: msg }, { status: 400 });
  }
}
