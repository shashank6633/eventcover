import { NextRequest, NextResponse } from 'next/server';
import { requestOtp, isValidEmail, isValidPhone, type IdentifierType } from '@/lib/otp';
import { resolveOtpProvider } from '@/lib/providers/otp';
import { getConfig } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Step 1 of OTP login.
 *
 * Body: { identifier: string, type: 'email' | 'phone' }
 * Response: { ok: true, channel, expiresInSeconds, cooldownSeconds? }
 *
 * Anti-enumeration: returns a generic success even when the identifier doesn't match a user,
 * UNLESS the identifier is malformed (then we fail validation up-front — that's harmless info).
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const identifier = String(body?.identifier || '').trim();
  const type = body?.type as IdentifierType;

  if (!identifier) {
    return NextResponse.json({ ok: false, message: 'Enter an email or phone.' }, { status: 400 });
  }
  if (type !== 'email' && type !== 'phone') {
    return NextResponse.json({ ok: false, message: "type must be 'email' or 'phone'" }, { status: 400 });
  }
  if (type === 'email' && !isValidEmail(identifier)) {
    return NextResponse.json({ ok: false, message: 'Enter a valid email address.' }, { status: 400 });
  }
  if (type === 'phone' && !isValidPhone(identifier)) {
    return NextResponse.json({ ok: false, message: 'Enter a valid phone number with country code.' }, { status: 400 });
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? req.headers.get('x-real-ip') ?? null;
  const ua = req.headers.get('user-agent') ?? null;

  const result = await requestOtp({
    identifier,
    type,
    ip: ip ?? undefined,
    userAgent: ua ?? undefined,
  });

  // Cooldown is a real client signal — surface it, but capped (don't leak timing for unknown identifiers).
  if (!result.ok && result.reason === 'cooldown') {
    return NextResponse.json(
      {
        ok: false,
        message: `Please wait ${result.cooldownSecondsRemaining}s before requesting another OTP.`,
        cooldownSeconds: result.cooldownSecondsRemaining,
      },
      { status: 429 },
    );
  }

  // Inactive user or unknown identifier — still respond with success shape so attacker
  // can't enumerate accounts. Note: no delivery happens for these cases.
  if (!result.ok || !result.code) {
    return NextResponse.json({
      ok: true,
      channel: 'console',
      message: 'If this account exists, an OTP has been sent.',
    });
  }

  // Deliver via the active provider.
  const provider = resolveOtpProvider(type);
  const venueName = getConfig('VENUE_NAME', 'EventCover');
  const delivery = await provider.send({
    identifier,
    type,
    code: result.code,
    expiresAt: result.expiresAt!,
    venueName,
    recipientName: result.user?.name,
  });

  if (!delivery.ok) {
    // Delivery failure is operationally important — surface a generic message but log loudly.
    /* eslint-disable no-console */
    console.error('[otp] delivery failed:', delivery.error);
    /* eslint-enable no-console */
    return NextResponse.json(
      { ok: false, message: 'Could not send OTP right now. Try again in a moment.' },
      { status: 502 },
    );
  }

  // Dev affordance: when the console provider is the actual delivery channel and we're
  // running in NODE_ENV=development, echo the plaintext code back to the client so the
  // operator doesn't have to hunt the server terminal. Strictly gated — never enabled in
  // production builds, and only when the channel actually fell through to console.
  const devCode =
    process.env.NODE_ENV === 'development' && delivery.channel === 'console'
      ? result.code
      : undefined;

  return NextResponse.json({
    ok: true,
    channel: delivery.channel,
    expiresInSeconds: Number(getConfig('OTP_TTL_SECONDS', '300')),
    message: 'OTP sent.',
    ...(devCode ? { devCode } : {}),
  });
}
