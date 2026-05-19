import { NextRequest, NextResponse } from 'next/server';
import { getAffiliate, updateAffiliate } from '@/lib/affiliates';
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
  return NextResponse.json({ ok: true, affiliate: aff });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  try {
    const updated = updateAffiliate(id, {
      name: body.name,
      phone: body.phone,
      email: body.email,
      status: body.status,
      commissionType: body.commissionType,
      commissionValue: body.commissionValue,
      notes: body.notes,
    }, session.name);
    if (!updated) return NextResponse.json({ ok: false, message: 'Not found.' }, { status: 404 });
    return NextResponse.json({ ok: true, affiliate: updated });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to update affiliate.';
    return NextResponse.json({ ok: false, message: msg }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Soft-delete: suspend the affiliate (preserves history). Hard delete would
  // cascade clicks but orphan commissions + payouts — not what we want.
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  const { id } = await params;
  const updated = updateAffiliate(id, { status: 'suspended' }, session.name);
  if (!updated) return NextResponse.json({ ok: false, message: 'Not found.' }, { status: 404 });
  return NextResponse.json({ ok: true, affiliate: updated });
}
