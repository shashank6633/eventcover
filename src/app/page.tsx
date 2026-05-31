import { redirect } from 'next/navigation';

/**
 * Root route — server-side redirect to the admin dashboard.
 *
 * EventCover is an internal staff tool; there is no public landing page. If
 * the user isn't authenticated, /admin will bounce them through middleware
 * to /login, then back to /admin on success. Customers reach individual
 * events directly via /event/[slug] (deep links from WhatsApp / ads), and
 * the customer self-service wallet lives at /w/[token] — neither path goes
 * through here.
 */
export default function RootPage(): never {
  redirect('/admin');
}
