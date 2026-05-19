import { NextRequest, NextResponse } from 'next/server';
import {
  upsertFromWebhook,
  recordWebhookHit,
  type WebhookReservationPayload,
} from '@/lib/reservations';
import { getConfig } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/reservations/webhook/reservego
 *
 * Receives reservation creates/updates from Reservego (or any compatible
 * webhook source). Authenticated via Bearer token shared secret stored in
 * RESERVEGO_WEBHOOK_SECRET config.
 *
 * Payload shape is permissive — we accept common field name variations so
 * the operator doesn't have to transform the payload server-side at
 * Reservego.
 *
 * Idempotency: matched by (provider='reservego', external_ref). Repeated
 * deliveries update the existing row in place.
 *
 * Returns:
 *   200 { ok: true, action: 'created'|'updated'|'cancelled', reservationId }
 *   401 if signature invalid
 *   400 if payload can't be parsed
 *   404 if no event exists for the payload's date
 */
export async function POST(req: NextRequest) {
  // ─── Auth ────────────────────────────────────────────────────────────────
  const secret = getConfig('RESERVEGO_WEBHOOK_SECRET');
  if (!secret) {
    recordWebhookHit('error:not_configured', 'rejected');
    return NextResponse.json({ ok: false, message: 'Webhook not configured.' }, { status: 503 });
  }

  // Accept the secret via several common header conventions:
  //   1. Authorization: Bearer <secret>     ← standard
  //   2. Authorization: <secret>            ← Reservego style (raw token)
  //   3. Authorization: Token <secret>      ← Django/DRF style
  //   4. X-Webhook-Secret: <secret>         ← Stripe-style alt
  //   5. X-Auth-Token: <secret>             ← legacy alt
  const auth = (req.headers.get('authorization') || '').trim();
  let fromAuth = '';
  if (auth) {
    if (auth.toLowerCase().startsWith('bearer ')) fromAuth = auth.slice(7).trim();
    else if (auth.toLowerCase().startsWith('token ')) fromAuth = auth.slice(6).trim();
    else fromAuth = auth; // raw token, no scheme prefix (Reservego)
  }
  const presented =
    fromAuth ||
    (req.headers.get('x-webhook-secret') || '').trim() ||
    (req.headers.get('x-auth-token') || '').trim();

  if (!presented || !timingSafeEqual(presented, secret)) {
    recordWebhookHit('error:unauthorized', 'rejected');
    return NextResponse.json({ ok: false, message: 'Invalid webhook secret.' }, { status: 401 });
  }

  // ─── Parse permissively ──────────────────────────────────────────────────
  const raw = await req.json().catch(() => null);
  if (!raw || typeof raw !== 'object') {
    recordWebhookHit('error:bad_payload', 'rejected');
    return NextResponse.json({ ok: false, message: 'Body must be JSON.' }, { status: 400 });
  }

  let payload: WebhookReservationPayload;
  try {
    payload = parsePayload(raw as Record<string, unknown>);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to parse payload.';
    recordWebhookHit(`error:parse:${msg.slice(0, 80)}`, 'rejected');
    return NextResponse.json({ ok: false, message: msg }, { status: 400 });
  }

  // ─── Upsert ──────────────────────────────────────────────────────────────
  try {
    const result = upsertFromWebhook(payload, 'reservego');
    recordWebhookHit(result.action, 'ok');
    return NextResponse.json({
      ok: true,
      action: result.action,
      reservationId: result.reservation.id,
      eventId: result.reservation.event_id,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to upsert reservation.';
    recordWebhookHit(`error:upsert:${msg.slice(0, 80)}`, 'rejected');
    // 404 if event missing, 400 otherwise
    const status = msg.toLowerCase().includes('no matching event') ? 404 : 400;
    return NextResponse.json({ ok: false, message: msg }, { status });
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

/**
 * Permissive parser. Maps common reservation field names to the normalized
 * shape. If Reservego (or any other provider) uses an exotic field name we
 * haven't covered, the operator can configure the webhook in Reservego's
 * dashboard to send the canonical field names listed in the docs.
 */
function parsePayload(input: Record<string, unknown>): WebhookReservationPayload {
  // Some webhook platforms wrap the body, e.g. { event: 'reservation.created', data: {...} }.
  // Drill into common wrapper keys once.
  const inner = (input.data ?? input.reservation ?? input.payload ?? input.booking) as
    | Record<string, unknown>
    | undefined;
  const src = inner && typeof inner === 'object' ? { ...input, ...inner } : input;

  // Some platforms put guest fields under a nested object.
  const customer = (src.customer ?? src.guest ?? src.user) as Record<string, unknown> | undefined;
  const merged = customer ? { ...src, ...customer } : src;

  // ─── External reference ───
  // Reservego: bookingId · others: reservation_id / id
  const externalRef = String(
    mergedField(merged, 'bookingId', 'booking_id', 'reservation_id', 'reservationId', 'externalRef', 'external_ref', 'id') ?? '',
  );
  if (!externalRef || externalRef === 'undefined' || externalRef === 'null') {
    throw new Error('External reference (bookingId / reservation_id / id) missing.');
  }

  // ─── Name ───
  // Reservego: guestName · others: name / customer_name / guest_name / full_name
  const name = String(
    mergedField(merged, 'guestName', 'name', 'customer_name', 'guest_name', 'full_name', 'customerName') ?? '',
  ).trim();

  // ─── Phone ───
  // Reservego sends phone as a NUMBER (e.g. 912455432432), not a string.
  // String(phoneRaw) handles both.
  const phoneRaw = mergedField(merged, 'guestPhone', 'phone', 'mobile', 'customer_phone', 'guest_phone', 'mobile_number', 'phone_number');
  const phone = phoneRaw != null ? String(phoneRaw).trim() : '';

  // ─── Email + party size ───
  // Important: leave `pax` undefined when not provided so the upsert path
  // can fall back to the existing row's pax. Otherwise a partial "Update
  // Booking" payload that omits guestCount would silently reset pax to 1.
  const email = mergedField(merged, 'guestEmail', 'email', 'customer_email', 'guest_email');
  const paxRaw = mergedField(merged, 'guestCount', 'pax', 'party_size', 'partySize', 'guests', 'covers', 'num_guests');
  const paxNum = paxRaw != null ? Number(paxRaw) : NaN;
  const pax = Number.isFinite(paxNum) ? paxNum : undefined;

  // ─── Booking time → event_date + arrival_time (IST) ───
  // Reservego sends `bookingTime` as a single UTC ISO timestamp like
  // "2025-09-26T15:45:00.000Z". We split it into a YYYY-MM-DD event_date
  // and HH:MM arrival_time, both in IST (since the venue runs on IST).
  const bookingTime = mergedField(
    merged,
    'bookingTime', 'booking_time', 'arrival_time', 'arrivalTime',
    'time', 'slot_time', 'reservation_time',
  );
  let eventDate: string | undefined;
  let arrivalTime: string | undefined;
  if (bookingTime != null) {
    const ts = String(bookingTime);
    const date = new Date(ts);
    if (!Number.isNaN(date.getTime())) {
      // Real date → format in IST
      eventDate = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(date);
      arrivalTime = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false,
      }).format(date);
    } else {
      // Looks like "21:00" alone, or just a date
      if (/^\d{2}:\d{2}/.test(ts)) arrivalTime = ts.slice(0, 5);
      else if (/^\d{4}-\d{2}-\d{2}/.test(ts)) eventDate = ts.slice(0, 10);
    }
  }
  // Fall back to explicit event_date field
  if (!eventDate) {
    const explicit = mergedField(merged, 'event_date', 'eventDate', 'date', 'reservation_date');
    if (explicit) eventDate = String(explicit).slice(0, 10);
  }
  const eventId = mergedField(merged, 'event_id', 'eventId');

  // ─── Notes: guestComments only ───
  // Previously we concatenated tableNames + preferences into notes for lack
  // of dedicated columns. Those now have their own columns (tables_json,
  // preferences_json), so `notes` is once again just the free-text guest
  // comments field — clean and unambiguous.
  let notes: string | null = null;
  const rawNotes = mergedField(merged, 'guestComments', 'notes', 'note', 'special_requests', 'remarks');
  if (rawNotes) {
    const trimmed = String(rawNotes).trim().replace(/\s*\|\s*$/, ''); // strip trailing "| "
    notes = trimmed || null;
  }

  // ─── Structured arrays → JSON-bound columns ───
  // We pass arrays through verbatim and let upsertFromWebhook stringify
  // them. Missing/empty arrays are left `undefined` so the upsert path's
  // "don't clobber on partial update" logic kicks in.
  const tableNamesRaw = src.tableNames;
  const tables = Array.isArray(tableNamesRaw) && tableNamesRaw.length > 0
    ? (tableNamesRaw as unknown[]).map((t) => String(t))
    : undefined;
  const rsrvTagsRaw = src.rsrvTags;
  const tags = Array.isArray(rsrvTagsRaw) && rsrvTagsRaw.length > 0
    ? (rsrvTagsRaw as unknown[]).map((t) => String(t))
    : undefined;
  const custTagsRaw = src.custTags;
  const customTags = Array.isArray(custTagsRaw) && custTagsRaw.length > 0
    ? (custTagsRaw as unknown[]).map((t) => String(t))
    : undefined;
  const preferencesRaw = src.preferences;
  const preferences = Array.isArray(preferencesRaw) && preferencesRaw.length > 0
    ? (preferencesRaw as unknown[]).map((t) => String(t))
    : undefined;

  // ─── Customer-context fields ───
  // bday / anniv come as full ISO timestamps but only the date portion is
  // useful — slice to YYYY-MM-DD. totalVisits is a plain integer.
  const bdayRaw = mergedField(merged, 'bday', 'birthday', 'birth_date');
  const bday = bdayRaw != null && String(bdayRaw).length >= 10
    ? String(bdayRaw).slice(0, 10)
    : undefined;
  const annivRaw = mergedField(merged, 'anniv', 'anniversary');
  const anniv = annivRaw != null && String(annivRaw).length >= 10
    ? String(annivRaw).slice(0, 10)
    : undefined;
  const totalVisitsRaw = mergedField(merged, 'totalVisits', 'total_visits', 'visit_count');
  const totalVisitsNum = totalVisitsRaw != null ? Number(totalVisitsRaw) : NaN;
  const totalVisits = Number.isFinite(totalVisitsNum) ? totalVisitsNum : undefined;

  // ─── Status ───
  const statusRaw = mergedField(merged, 'status', 'reservation_status', 'state');

  return {
    externalRef,
    eventDate,
    eventId: eventId ? String(eventId) : undefined,
    name,
    phone,
    email: email ? String(email) : null,
    pax,
    arrivalTime: arrivalTime || null,
    notes,
    status: statusRaw != null ? String(statusRaw) : undefined,
    raw: input,
    bookingTime: bookingTime != null ? String(bookingTime) : null,
    tables,
    tags,
    customTags,
    preferences,
    bday,
    anniv,
    totalVisits,
  };
}

function mergedField(
  obj: Record<string, unknown>,
  ...keys: string[]
): string | number | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null && v !== '') {
      return typeof v === 'string' || typeof v === 'number' ? v : String(v);
    }
  }
  return undefined;
}
