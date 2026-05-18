import { NextRequest, NextResponse } from 'next/server';
import { syncReservationsForEvent } from '@/lib/reservations';
import { listImplementedProviders, type ProviderId } from '@/lib/providers';
import { getConfig } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const eventId = String(body?.eventId || '').trim();
  if (!eventId) return NextResponse.json({ ok: false, message: 'eventId required' }, { status: 400 });

  const providerFromBody = body?.provider ? String(body.provider) : '';
  const providerFromConfig = getConfig('RESERVATION_PROVIDER', 'reservego-mock');
  const providerId = (providerFromBody || providerFromConfig) as ProviderId;

  const implemented = listImplementedProviders();
  if (!implemented.includes(providerId)) {
    return NextResponse.json(
      { ok: false, message: `Provider "${providerId}" is not implemented. Available: ${implemented.join(', ')}` },
      { status: 400 },
    );
  }

  try {
    const result = await syncReservationsForEvent(eventId, providerId);
    return NextResponse.json({ ok: true, provider: providerId, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'sync failed';
    return NextResponse.json({ ok: false, message: msg }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    implemented: listImplementedProviders(),
    active: getConfig('RESERVATION_PROVIDER', 'reservego-mock'),
  });
}
