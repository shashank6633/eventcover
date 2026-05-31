import { NextRequest, NextResponse } from 'next/server';
import { getConfig, setConfig } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/settings/razorpay — host-only.
 *
 * Returns the mode + keyId in plain text (keyId is the publishable identifier
 * — it ships to the browser anyway via the Checkout SDK). Secrets are
 * surfaced as booleans only; the raw values are never returned. Matches the
 * /api/settings/meta pattern.
 */
export async function GET() {
  const session = await requireRole(['host']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  const mode = (getConfig('RAZORPAY_MODE', 'test').trim().toLowerCase() === 'live') ? 'live' : 'test';
  return NextResponse.json({
    ok: true,
    mode,
    keyId: getConfig('RAZORPAY_KEY_ID', ''),
    hasKeySecret: !!getConfig('RAZORPAY_KEY_SECRET', ''),
    hasWebhookSecret: !!getConfig('RAZORPAY_WEBHOOK_SECRET', ''),
  });
}

/**
 * POST /api/settings/razorpay — host-only.
 *
 * Body: { mode?, keyId?, keySecret?, webhookSecret? }
 *
 * Every field is optional — sending undefined leaves the existing value
 * alone. Sending '' explicitly clears. mode is the only one with strict
 * validation; the keys are free-form strings (Razorpay's format may change).
 */
export async function POST(req: NextRequest) {
  const session = await requireRole(['host']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }

  const body = await req.json().catch(() => ({})) as {
    mode?: unknown;
    keyId?: unknown;
    keySecret?: unknown;
    webhookSecret?: unknown;
  };

  let modeChanged = false;
  if (body.mode !== undefined) {
    const m = String(body.mode).trim().toLowerCase();
    if (m !== 'test' && m !== 'live') {
      return NextResponse.json(
        { ok: false, message: "mode must be 'test' or 'live'." },
        { status: 400 },
      );
    }
    setConfig('RAZORPAY_MODE', m);
    modeChanged = true;
  }

  let keyIdChanged = false;
  if (body.keyId !== undefined) {
    setConfig('RAZORPAY_KEY_ID', String(body.keyId).trim());
    keyIdChanged = true;
  }

  let keySecretChanged = false;
  if (body.keySecret !== undefined) {
    setConfig('RAZORPAY_KEY_SECRET', String(body.keySecret).trim());
    keySecretChanged = true;
  }

  let webhookSecretChanged = false;
  if (body.webhookSecret !== undefined) {
    setConfig('RAZORPAY_WEBHOOK_SECRET', String(body.webhookSecret).trim());
    webhookSecretChanged = true;
  }

  logAudit({
    actor: session.name,
    action: 'razorpay_config_update',
    entityType: 'config',
    details: {
      mode_changed: modeChanged,
      key_id_changed: keyIdChanged,
      key_secret_changed: keySecretChanged,
      webhook_secret_changed: webhookSecretChanged,
    },
  });

  const mode = (getConfig('RAZORPAY_MODE', 'test').trim().toLowerCase() === 'live') ? 'live' : 'test';
  return NextResponse.json({
    ok: true,
    mode,
    keyId: getConfig('RAZORPAY_KEY_ID', ''),
    hasKeySecret: !!getConfig('RAZORPAY_KEY_SECRET', ''),
    hasWebhookSecret: !!getConfig('RAZORPAY_WEBHOOK_SECRET', ''),
  });
}
