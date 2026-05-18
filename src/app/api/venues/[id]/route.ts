import { NextRequest, NextResponse } from 'next/server';
import { getVenue, updateVenue, deleteVenue, type UpdateVenueInput } from '@/lib/venues';
import { requireRole } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  const { id } = await ctx.params;
  const v = getVenue(id);
  if (!v) return NextResponse.json({ ok: false, message: 'Not found.' }, { status: 404 });
  return NextResponse.json({ ok: true, venue: v });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));

  const patch: UpdateVenueInput = {};
  if (typeof body.name === 'string') patch.name = body.name;
  if (typeof body.city === 'string') patch.city = body.city;
  if ('address' in body) patch.address = body.address ?? null;
  if ('google_maps_url' in body) patch.google_maps_url = body.google_maps_url ?? null;
  if ('notes' in body) patch.notes = body.notes ?? null;
  if (typeof body.active === 'boolean') patch.active = body.active;

  try {
    const v = updateVenue(id, patch, session.name);
    if (!v) return NextResponse.json({ ok: false, message: 'Not found.' }, { status: 404 });
    return NextResponse.json({ ok: true, venue: v });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Update failed';
    return NextResponse.json({ ok: false, message: msg }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  // Destructive — host only.
  const session = await requireRole(['host']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  const { id } = await ctx.params;
  const ok = deleteVenue(id, session.name);
  if (!ok) return NextResponse.json({ ok: false, message: 'Not found.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
