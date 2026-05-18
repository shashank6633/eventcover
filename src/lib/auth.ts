/**
 * Server-side auth helpers for page server components and API routes.
 * These use next/headers (Node runtime only — do not import from middleware).
 */
import { cookies } from 'next/headers';
import { getConfig } from './db';
import { verifySession, SESSION_COOKIE, type SessionPayload } from './session';
import type { UserRole } from './users';

export async function getSession(): Promise<SessionPayload | null> {
  const c = await cookies();
  const token = c.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const secret = getConfig('SESSION_SECRET');
  if (!secret) return null;
  return verifySession(token, secret);
}

export async function requireRole(allowed: UserRole[]): Promise<SessionPayload | { forbidden: true; status: number; message: string }> {
  const session = await getSession();
  if (!session) return { forbidden: true, status: 401, message: 'Not authenticated' };
  if (!allowed.includes(session.role)) {
    return { forbidden: true, status: 403, message: `Requires role: ${allowed.join(' / ')}` };
  }
  return session;
}

export function isAllowed(role: UserRole, allowed: UserRole[]): boolean {
  return allowed.includes(role);
}
