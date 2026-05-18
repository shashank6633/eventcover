import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getUser } from '@/lib/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, message: 'Not authenticated' }, { status: 401 });

  // Re-read the DB record so a deactivated account can't keep using an old cookie.
  const user = getUser(session.sub);
  if (!user || !user.active) {
    return NextResponse.json({ ok: false, message: 'Session invalid' }, { status: 401 });
  }

  return NextResponse.json({
    ok: true,
    user: { id: user.id, name: user.name, role: user.role, phone: user.phone, email: user.email },
  });
}
