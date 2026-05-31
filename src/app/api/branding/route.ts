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
    // The marketing front-end (/, /events) reads About HTML to derive a
    // tagline and the About section copy. Phone/email power the footer.
    // These are all already public-facing, so safe to expose here.
    brandAboutHtml: getConfig('BRAND_ABOUT_HTML', ''),
    brandSocialLinksJson: getConfig('BRAND_SOCIAL_LINKS_JSON', ''),
    hostPhone: getConfig('HOST_PHONE', ''),
    hostEmail: getConfig('HOST_EMAIL', ''),
    venueAddress: getConfig('VENUE_ADDRESS', ''),
  });
}
