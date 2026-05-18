import { NextRequest, NextResponse } from 'next/server';
import { getUser, updateUser, deleteUser, ALL_ROLES, type UserRole } from '@/lib/users';
import { requireRole } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['host', 'manager']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  const { id } = await ctx.params;
  const user = getUser(id);
  if (!user) return NextResponse.json({ ok: false, message: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true, user });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['host']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  const { id } = await ctx.params;

  const body = await req.json().catch(() => ({}));
  const patch: Parameters<typeof updateUser>[1] = {};
  if (typeof body.name === 'string') patch.name = body.name;
  if (typeof body.phone === 'string') patch.phone = body.phone;
  if ('email' in body) patch.email = body.email || '';
  if (typeof body.role === 'string') {
    if (!ALL_ROLES.includes(body.role as UserRole)) {
      return NextResponse.json({ ok: false, message: 'invalid role' }, { status: 400 });
    }
    patch.role = body.role as UserRole;
  }
  if (typeof body.pin === 'string') patch.pin = body.pin;
  if (typeof body.active === 'boolean') patch.active = body.active;

  try {
    const user = updateUser(id, patch, session.name);
    if (!user) return NextResponse.json({ ok: false, message: 'not found' }, { status: 404 });
    return NextResponse.json({ ok: true, user });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'update failed';
    return NextResponse.json({ ok: false, message: msg }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['host']);
  if ('forbidden' in session) {
    return NextResponse.json({ ok: false, message: session.message }, { status: session.status });
  }
  const { id } = await ctx.params;
  if (id === session.sub) {
    return NextResponse.json({ ok: false, message: 'Cannot delete your own account.' }, { status: 400 });
  }
  const ok = deleteUser(id, session.name);
  if (!ok) return NextResponse.json({ ok: false, message: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
