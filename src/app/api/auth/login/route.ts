import { NextRequest, NextResponse } from 'next/server';
import { verifyUserPin } from '@/lib/users';
import { signSession, SESSION_COOKIE, SESSION_TTL_MS } from '@/lib/session';
import { getConfig } from '@/lib/db';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const phone = String(body?.phone || '').trim();
  const pin = String(body?.pin || '').trim();

  if (!phone || !pin) {
    return NextResponse.json({ ok: false, message: 'Phone and PIN are required.' }, { status: 400 });
  }

  const user = verifyUserPin(phone, pin);
  if (!user) {
    logAudit({ actor: phone, action: 'login_fail', details: { reason: 'bad_credentials_or_inactive' } });
    return NextResponse.json({ ok: false, message: 'Invalid phone or PIN.' }, { status: 401 });
  }

  const secret = getConfig('SESSION_SECRET');
  if (!secret) {
    return NextResponse.json({ ok: false, message: 'Server misconfigured (no SESSION_SECRET).' }, { status: 500 });
  }

  const token = await signSession({ sub: user.id, name: user.name, role: user.role as 'host' | 'manager' | 'captain' | 'entry' }, secret);

  const res = NextResponse.json({
    ok: true,
    user: { id: user.id, name: user.name, role: user.role, phone: user.phone },
  });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });

  logAudit({ actor: user.name, action: 'login', entityType: 'user', entityId: user.id, details: { role: user.role } });
  return res;
}
