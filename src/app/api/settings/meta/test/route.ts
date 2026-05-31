import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { requireRole } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import {
  getEffectivePixelId,
  getCapiAccessToken,
  getTestEventCode,
  sendCapiEvent,
} from '@/lib/meta-pixel';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/settings/meta/test — host-only diagnostic.
 *
 * Fires a synthetic PageView via CAPI tagged with the configured
 * META_TEST_EVENT_CODE. Inside Meta Events Manager → Test Events tab,
 * the host should see this event arrive within a few seconds, confirming
 * the Pixel ID + access token + test code are all valid.
 *
 * Returns Meta's raw response (success: `{ events_received, fbtrace_id }`,
 * error: standard Graph error envelope) so the UI can show actionable
 * diagnostics rather than a generic "didn't work".
 */
export async function POST(req: NextRequest) {
  const session = await requireRole(['host']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }

  const pixelId = getEffectivePixelId();
  const accessToken = getCapiAccessToken();
  const testCode = getTestEventCode();

  if (!pixelId) {
    return NextResponse.json(
      { ok: false, message: 'META_PIXEL_ID is not configured.' },
      { status: 400 },
    );
  }
  if (!accessToken) {
    return NextResponse.json(
      { ok: false, message: 'META_CAPI_ACCESS_TOKEN is not configured.' },
      { status: 400 },
    );
  }
  if (!testCode) {
    return NextResponse.json(
      {
        ok: false,
        message:
          'META_TEST_EVENT_CODE is not configured. Open Meta Events Manager → Test Events tab, copy the test code, and save it as META_TEST_EVENT_CODE before running this test.',
      },
      { status: 400 },
    );
  }

  const userAgent = req.headers.get('user-agent') || undefined;
  // Get the originating IP from common proxy headers; falls back to
  // undefined which is fine — IP is optional in CAPI.
  const fwd = req.headers.get('x-forwarded-for') || '';
  const clientIp = fwd.split(',')[0]?.trim() || req.headers.get('x-real-ip') || undefined;

  const result = await sendCapiEvent({
    pixelId,
    accessToken,
    eventName: 'PageView',
    eventId: `test-${nanoid(10)}`,
    actionSource: 'system_generated',
    userData: {
      client_ip_address: clientIp,
      client_user_agent: userAgent,
    },
    testEventCode: testCode,
  });

  logAudit({
    actor: session.name,
    action: 'meta_capi_test',
    entityType: 'config',
    details: { ok: result.ok, status: result.status, pixel_id: pixelId },
  });

  return NextResponse.json({
    ok: result.ok,
    status: result.status,
    response: result.response,
    pixelId,
    testEventCode: testCode,
  }, { status: result.ok ? 200 : 502 });
}
