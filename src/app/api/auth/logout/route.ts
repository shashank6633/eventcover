import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/lib/session';
import { getSession } from '@/lib/auth';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  const session = await getSession();
  if (session) {
    logAudit({ actor: session.name, action: 'logout', entityType: 'user', entityId: session.sub });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
  return res;
}
