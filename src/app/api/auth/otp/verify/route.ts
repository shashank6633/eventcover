import { NextRequest, NextResponse } from 'next/server';
import { verifyOtp, type IdentifierType } from '@/lib/otp';
import { signSession, SESSION_COOKIE, SESSION_TTL_MS } from '@/lib/session';
import { getConfig } from '@/lib/db';
import type { UserRole } from '@/lib/roles';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Step 2 of OTP login. On success: sets the session cookie and returns the user.
 *
 * Body: { identifier, type: 'email' | 'phone', code }
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const identifier = String(body?.identifier || '').trim();
  const code = String(body?.code || '').trim();
  const type = body?.type as IdentifierType;

  if (!identifier || !code) {
    return NextResponse.json({ ok: false, message: 'Identifier and code are required.' }, { status: 400 });
  }
  if (type !== 'email' && type !== 'phone') {
    return NextResponse.json({ ok: false, message: "type must be 'email' or 'phone'" }, { status: 400 });
  }
  if (!/^\d{4,8}$/.test(code)) {
    return NextResponse.json({ ok: false, message: 'OTP must be 4–8 digits.' }, { status: 400 });
  }

  const result = await verifyOtp(identifier, type, code);

  if (!result.ok) {
    const reason = result.reason;
    let status = 401;
    let message = 'Invalid or expired code.';
    if (reason === 'mismatch') {
      message = `Incorrect code. ${result.attemptsRemaining ?? 0} attempt(s) remaining.`;
    } else if (reason === 'expired') {
      message = 'This code has expired. Request a new one.';
    } else if (reason === 'attempts_exhausted') {
      message = 'Too many wrong attempts. Request a new code.';
      status = 429;
    } else if (reason === 'inactive_user') {
      message = 'This account is disabled. Contact your host.';
      status = 403;
    }
    return NextResponse.json({ ok: false, message }, { status });
  }

  const user = result.user!;
  const secret = getConfig('SESSION_SECRET');
  if (!secret) {
    return NextResponse.json({ ok: false, message: 'Server misconfigured (no SESSION_SECRET).' }, { status: 500 });
  }

  const token = await signSession(
    { sub: user.id, name: user.name, role: user.role as UserRole },
    secret,
  );

  const res = NextResponse.json({
    ok: true,
    user: { id: user.id, name: user.name, role: user.role, phone: user.phone, email: user.email },
  });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  return res;
}
