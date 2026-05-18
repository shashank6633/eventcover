import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/lib/session';

/**
 * Gate /admin/* routes behind a session cookie.
 *
 * We only check cookie *presence* here — middleware runs on the Edge and can't access
 * the DB to read the signing secret. Real verification happens inside pages/APIs via
 * `getSession()` from lib/auth. An invalid cookie lets the user through middleware
 * but the server component / API will redirect to /login or return 401.
 *
 * This is defense-in-depth — the edge gate keeps unauthenticated users from even seeing
 * the admin shell, while the node-side check is authoritative.
 */
export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (!pathname.startsWith('/admin')) return NextResponse.next();

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (token) return NextResponse.next();

  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = '/login';
  loginUrl.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/admin/:path*'],
};
