import { NextRequest, NextResponse } from 'next/server';
import { listVenues, createVenue } from '@/lib/venues';
import { requireRole } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  return NextResponse.json({ ok: true, venues: listVenues() });
}

export async function POST(req: NextRequest) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }

  const body = await req.json().catch(() => ({}));
  if (!body?.name || !body?.city) {
    return NextResponse.json({ ok: false, message: 'Name and city are required.' }, { status: 400 });
  }

  try {
    const venue = createVenue({
      name: String(body.name),
      city: String(body.city),
      address: body.address ? String(body.address) : null,
      google_maps_url: body.google_maps_url ? String(body.google_maps_url) : null,
      notes: body.notes ? String(body.notes) : null,
      createdBy: session.name,
    });
    return NextResponse.json({ ok: true, venue });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to create venue';
    return NextResponse.json({ ok: false, message: msg }, { status: 400 });
  }
}
