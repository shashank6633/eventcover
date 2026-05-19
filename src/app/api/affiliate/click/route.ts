import { NextRequest, NextResponse } from 'next/server';
import { getAffiliateByCode, recordClick } from '@/lib/affiliates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Public endpoint. Logs a click when a customer lands on any page with
 * ?ref=CODE. Returns 200 even on bad/unknown codes so the client-side
 * fire-and-forget never logs a console error in the visitor's browser.
 */
export async function POST(req: NextRequest) {
  let body: { code?: string; eventId?: string | null; referer?: string | null } = {};
  try {
    body = await req.json();
  } catch {
    /* malformed JSON → treat as no-op */
  }

  const code = String(body.code || '').trim().toUpperCase();
  if (!code || code.length > 32) {
    return NextResponse.json({ ok: true, recorded: false });
  }

  const aff = getAffiliateByCode(code);
  if (!aff) {
    return NextResponse.json({ ok: true, recorded: false });
  }

  // Best-effort IP capture — Caddy forwards X-Forwarded-For
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    null;
  const ua = req.headers.get('user-agent') || null;
  const ref = body.referer || req.headers.get('referer') || null;

  recordClick({
    affiliateId: aff.id,
    eventId: body.eventId || null,
    ip,
    userAgent: ua?.slice(0, 500) ?? null,
    referer: ref?.slice(0, 500) ?? null,
  });

  return NextResponse.json({ ok: true, recorded: true });
}
