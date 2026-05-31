import { NextRequest, NextResponse } from 'next/server';
import { getAllConfig, setConfig } from '@/lib/db';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Editable config keys. The Settings page exposes the venue-level ones; the
 * event-level fields (EVENT_DATE / CUTOFF / DEFAULT_ENTRY_FEE) remain in the
 * allow-list as legacy fallbacks but are configured per-event in /admin/events
 * — not from the Settings UI.
 */
const EDITABLE_KEYS = new Set([
  // Venue (Settings page)
  'VENUE_NAME',
  'VENUE_DESCRIPTION',
  'VENUE_LOGO',
  'VENUE_ADDRESS',
  'VENUE_CITY',
  'HOST_EMAIL',
  'HOST_PHONE',
  // Terms (Terms page)
  'TNC_TEXT',
  // WhatsApp / Interakt (host-only sub-page)
  'INTERAKT_API_SECRET',
  'INTERAKT_BUSINESS_PHONE',
  'OTP_PROVIDER',           // 'console' (dev) | 'whatsapp' (production via Interakt) | 'email'
  'WHATSAPP_OTP_TEMPLATE',  // approved template slug, defaults to 'akan_login_otp'
  'WHATSAPP_OTP_LANGUAGE',  // language code, defaults to 'en'
  // Reservego webhook (host-only sub-page)
  'RESERVEGO_WEBHOOK_SECRET',
  'RESERVEGO_AUTO_CREATE_EVENTS',
  // Meta Pixel + Conversions API (host-only sub-page)
  'META_PIXEL_ID',
  'META_CAPI_ACCESS_TOKEN',
  'META_TEST_EVENT_CODE',
  // Auto-send wallet pass over WhatsApp on issue (host-only WhatsApp sub-page)
  'AUTO_SEND_WHATSAPP_PASS',
  'WALLET_PASS_TEMPLATE',
  'WALLET_PASS_TEMPLATE_LANG',
  'WALLET_PASS_TEMPLATE_INCLUDE_LINK',
  'WALLET_VIEW_TOKEN_TTL_DAYS',
  // Razorpay payment gateway (host-only sub-page)
  'RAZORPAY_MODE',
  'RAZORPAY_KEY_ID',
  'RAZORPAY_KEY_SECRET',
  'RAZORPAY_WEBHOOK_SECRET',
  // Legacy / fallback — kept writable so per-event config can still seed the
  // global default, but no longer surfaced on the Settings page.
  'EVENT_NAME',
  'EVENT_DATE',
  'EVENT_CUTOFF_HOUR',
  'DEFAULT_ENTRY_FEE',
  'PIN_LENGTH',
  // Settings V2 — Brand
  'BRAND_ABOUT_HTML',
  'BRAND_SOCIAL_LINKS_JSON',
  'VENUE_FAVICON_URL',
  'VENUE_PUBLIC_URL',
  // Settings V2 — General → Notifications
  'WHATSAPP_BOOKING_ALERTS_ENABLED',
  'SALE_WEBHOOK_URL',
  // Settings V2 — Finance → Bank Details
  'BANK_ACCOUNT_HOLDER',
  'BANK_ACCOUNT_NUMBER',
  'BANK_IFSC',
  'BANK_UPI_ID',
  'BANK_GSTIN',
]);

/**
 * Keys that must never be returned in plain text from GET responses. The
 * client gets either an empty string (not set) or '••••••••' (set) — never the
 * real value. Setting these keys is still allowed via POST (they're in
 * EDITABLE_KEYS), but reading them back out of the API is impossible.
 */
const SENSITIVE_KEYS = new Set([
  'INTERAKT_API_SECRET',
  'RESERVEGO_WEBHOOK_SECRET',
  'META_CAPI_ACCESS_TOKEN',
  'INTERNAL_TOKEN_SECRET',  // HMAC key for signed URLs — never exposed
  'RAZORPAY_KEY_SECRET',
  'RAZORPAY_WEBHOOK_SECRET',
  // Settings V2 — bank account number is sensitive; mask in GET responses
  'BANK_ACCOUNT_NUMBER',
]);

const MASKED = '••••••••';

function safeConfig(): Record<string, string> {
  const all = getAllConfig();
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(all)) {
    if (SENSITIVE_KEYS.has(k)) {
      out[k] = v ? MASKED : '';
    } else {
      out[k] = v;
    }
  }
  return out;
}

export async function GET() {
  return NextResponse.json({ ok: true, config: safeConfig() });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const updates = body?.updates;
  if (!updates || typeof updates !== 'object') {
    return NextResponse.json({ ok: false, message: 'updates object required' }, { status: 400 });
  }

  const applied: Record<string, string> = {};
  const rejected: string[] = [];
  for (const [key, value] of Object.entries(updates)) {
    if (!EDITABLE_KEYS.has(key)) { rejected.push(key); continue; }
    const v = value == null ? '' : String(value);
    // Posting back the masked placeholder must NOT overwrite the real secret.
    // The Settings UI sends '••••••••' when the field wasn't edited.
    if (SENSITIVE_KEYS.has(key) && v === MASKED) { continue; }
    setConfig(key, v);
    // Never echo a sensitive value back in the response — only acknowledge it
    // was set.
    applied[key] = SENSITIVE_KEYS.has(key) ? (v ? MASKED : '') : v;
  }

  logAudit({ actor: 'admin', action: 'config_update', details: applied });

  return NextResponse.json({
    ok: true,
    applied,
    rejected,
    config: safeConfig(),
  });
}
