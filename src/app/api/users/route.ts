import { NextRequest, NextResponse } from 'next/server';
import { listUsers, createUser, ALL_ROLES, type UserRole } from '@/lib/users';
import { requireRole } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  return NextResponse.json({ ok: true, users: listUsers() });
}

export async function POST(req: NextRequest) {
  const session = await requireRole(['host']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }

  const body = await req.json().catch(() => ({}));
  const role = body?.role as UserRole;

  if (!body?.name || !body?.phone || !body?.pin || !role) {
    return NextResponse.json({ ok: false, message: 'name, phone, pin, role are required' }, { status: 400 });
  }
  if (!ALL_ROLES.includes(role)) {
    return NextResponse.json({ ok: false, message: `role must be one of ${ALL_ROLES.join(', ')}` }, { status: 400 });
  }

  try {
    const user = createUser({
      name: String(body.name),
      phone: String(body.phone),
      email: body.email ? String(body.email) : undefined,
      role,
      pin: String(body.pin),
      createdBy: session.name,
    });
    return NextResponse.json({ ok: true, user });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to create user';
    return NextResponse.json({ ok: false, message: msg }, { status: 400 });
  }
}
