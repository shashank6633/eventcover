import { NextResponse } from 'next/server';
import { getConfig } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Public branding endpoint.
 *
 * Returns only the venue's display name + logo — safe to call from the login
 * page or any unauthenticated surface. Deliberately narrower than /api/config
 * so we don't leak host email / phone / PIN length etc. to anonymous callers.
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    venueName: getConfig('VENUE_NAME', 'EventCover'),
    venueLogo: getConfig('VENUE_LOGO', ''),
  });
}
