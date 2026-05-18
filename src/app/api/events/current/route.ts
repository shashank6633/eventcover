import { NextResponse } from 'next/server';
import { getEventForDate } from '@/lib/events';
import { getConfig } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Returns the current event (for today's EVENT_DATE in config).
 * null if none exists — clients should fall back to config.
 */
export async function GET() {
  const date = getConfig('EVENT_DATE', '');
  if (!date) return NextResponse.json({ ok: true, event: null });
  const event = getEventForDate(date);
  return NextResponse.json({ ok: true, event, eventDate: date });
}
