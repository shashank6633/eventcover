import { NextRequest, NextResponse } from 'next/server';
import { getConfig, setConfig } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/settings/meta — host-only summary.
 *
 * Returns the pixel ID + test code in plain text (they're not secrets) and
 * a boolean indicating whether the CAPI access token is set. Never returns
 * the raw token — that would defeat the SENSITIVE_KEYS masking on the
 * generic /api/config endpoint. Matches the Reservego pattern (separate
 * "reveal secret" endpoint with audit log).
 */
export async function GET() {
  const session = await requireRole(['host']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  return NextResponse.json({
    ok: true,
    pixelId: getConfig('META_PIXEL_ID', ''),
    hasAccessToken: !!getConfig('META_CAPI_ACCESS_TOKEN', ''),
    testEventCode: getConfig('META_TEST_EVENT_CODE', ''),
  });
}

/**
 * POST /api/settings/meta — host-only update.
 *
 * Body: { pixelId, accessToken?, testEventCode? }
 *   - pixelId: required, must be a 13-17 digit numeric string (Meta IDs
 *     are 15-16 but we allow a small range for future-proofing). Pass empty
 *     string to clear.
 *   - accessToken: optional. When omitted (undefined), the existing token
 *     is left alone — the UI doesn't have to re-send the masked value.
 *     Pass empty string to explicitly clear.
 *   - testEventCode: optional. Empty string clears.
 */
export async function POST(req: NextRequest) {
  const session = await requireRole(['host']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }

  const body = await req.json().catch(() => ({})) as {
    pixelId?: unknown;
    accessToken?: unknown;
    testEventCode?: unknown;
  };

  const pixelIdRaw = body.pixelId == null ? '' : String(body.pixelId).trim();
  // Meta Pixel IDs are numeric — 13-17 digits leaves room for both legacy
  // and future formats while still rejecting obvious typos.
  if (pixelIdRaw && !/^\d{13,17}$/.test(pixelIdRaw)) {
    return NextResponse.json(
      { ok: false, message: 'Pixel ID must be a 13-17 digit number.' },
      { status: 400 },
    );
  }

  setConfig('META_PIXEL_ID', pixelIdRaw);

  // accessToken: only write when caller explicitly sent the field. This
  // mirrors the masked-input UX from the generic /api/config endpoint:
  // sending undefined keeps the old token, sending '' clears it.
  let tokenChanged = false;
  if (body.accessToken !== undefined) {
    setConfig('META_CAPI_ACCESS_TOKEN', String(body.accessToken));
    tokenChanged = true;
  }

  let testCodeChanged = false;
  if (body.testEventCode !== undefined) {
    setConfig('META_TEST_EVENT_CODE', String(body.testEventCode).trim());
    testCodeChanged = true;
  }

  logAudit({
    actor: session.name,
    action: 'meta_config_update',
    entityType: 'config',
    details: {
      pixel_id_set: !!pixelIdRaw,
      access_token_changed: tokenChanged,
      test_code_changed: testCodeChanged,
    },
  });

  return NextResponse.json({
    ok: true,
    pixelId: getConfig('META_PIXEL_ID', ''),
    hasAccessToken: !!getConfig('META_CAPI_ACCESS_TOKEN', ''),
    testEventCode: getConfig('META_TEST_EVENT_CODE', ''),
  });
}
