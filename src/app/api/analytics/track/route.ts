/**
 * POST /api/analytics/track — public, rate-limited event ingestion.
 *
 * Body: { eventId, sessionId, kind, metadata? }
 *
 * Always returns 204 No Content (even on validation failure) so the
 * endpoint can't be probed for valid event ids by guessing.
 * trackEvent() handles per-session rate limiting + event_id validation
 * internally; we just normalize the request envelope here.
 */
import { NextRequest, NextResponse } from 'next/server';
import { trackEvent, isAnalyticsKind } from '@/lib/event-analytics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  // No-204 sentinel. Defined once so all error / success branches are
  // indistinguishable from outside.
  const NO_CONTENT = new NextResponse(null, { status: 204 });

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NO_CONTENT;
  }

  const eventId = typeof body.eventId === 'string' ? body.eventId.trim() : '';
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
  const kindRaw = body.kind;
  if (!eventId || !sessionId || !isAnalyticsKind(kindRaw)) return NO_CONTENT;

  // Extract first IP from x-forwarded-for. Defensive against multiple
  // commas-separated values from proxy chains.
  const xff = req.headers.get('x-forwarded-for') || '';
  const ip = xff.split(',')[0].trim() || req.headers.get('x-real-ip') || '';
  const ua = req.headers.get('user-agent') || '';

  const metadata = (body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata))
    ? (body.metadata as Record<string, unknown>)
    : undefined;

  // Silent — never surface validation errors to the public.
  trackEvent({
    eventId,
    sessionId,
    kind: kindRaw,
    metadata,
    ip: ip || undefined,
    ua: ua || undefined,
  });

  return NO_CONTENT;
}
