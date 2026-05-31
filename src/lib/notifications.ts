/**
 * Settings V2 — host notifications.
 *
 * Two fire-and-forget side effects:
 *   1. sendBookingAlertWhatsApp() — when WHATSAPP_BOOKING_ALERTS_ENABLED='1'
 *      and HOST_PHONE is set, ping the host with a WhatsApp template message
 *      naming the guest, event, and amount.
 *   2. sendSaleWebhook() — when SALE_WEBHOOK_URL is set, POST the full sale
 *      transaction JSON to it with a 5s timeout. No retries.
 *
 * Both helpers swallow errors silently — they're called from hot booking /
 * payment paths and must NEVER block the customer's response.
 */
import { getConfig } from './db';
import { logAudit } from './audit';
import {
  sendInteraktTemplate,
  splitPhone,
  isInteraktConfigured,
} from './providers/whatsapp/interakt';

const HOST_BOOKING_ALERT_TEMPLATE = 'akan_host_booking_alert';
const HOST_BOOKING_ALERT_LANG = 'en';
const SALE_WEBHOOK_TIMEOUT_MS = 5000;

function formatINR(amount: number): string {
  // Match the style used elsewhere ("₹1,234"). Currency.format with INR
  // locale would also work but pulls in Intl data we don't need here.
  const n = Math.round(Number(amount) || 0);
  const s = n.toString();
  // Indian grouping: last 3 then groups of 2 (1,23,456).
  if (s.length <= 3) return `₹${s}`;
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3);
  const grouped = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `₹${grouped},${last3}`;
}

export interface BookingAlertInput {
  guestName: string;
  eventName: string;
  amount: number;
}

/**
 * Fire-and-forget WhatsApp alert to the host phone. Resolves to true if the
 * template was actually sent; false otherwise. Callers should NOT await — use
 * .catch(() => {}) if you want to be explicit about ignoring the result.
 */
export async function sendBookingAlertWhatsApp(
  input: BookingAlertInput,
): Promise<boolean> {
  if (getConfig('WHATSAPP_BOOKING_ALERTS_ENABLED', '0') !== '1') return false;
  if (!isInteraktConfigured()) return false;

  const hostPhone = getConfig('HOST_PHONE', '').trim();
  if (!hostPhone) return false;

  const { countryCode, phoneNumber } = splitPhone(hostPhone);
  if (!phoneNumber) return false;

  const result = await sendInteraktTemplate({
    countryCode,
    phoneNumber,
    templateName: HOST_BOOKING_ALERT_TEMPLATE,
    languageCode: HOST_BOOKING_ALERT_LANG,
    bodyValues: [input.guestName, input.eventName, formatINR(input.amount)],
    callbackData: 'host_booking_alert',
  });

  // Log non-success so the operator can spot misconfigured templates
  // (e.g. template not approved on Interakt) without trawling the API logs.
  if (!result.ok) {
    logAudit({
      actor: 'system',
      action: 'host_booking_alert_failed',
      details: {
        error: result.error,
        status: result.status,
        template: HOST_BOOKING_ALERT_TEMPLATE,
      },
    });
  }
  return result.ok;
}

export interface SaleWebhookPayload {
  paymentId: string;
  razorpayPaymentId: string | null;
  amount: number;
  currency: string;
  eventId: string;
  eventName: string;
  customerName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  capturedAt: number;
  // Optional extras — pass-through fields some downstream handlers may want.
  items?: unknown;
  reservationId?: string | null;
  paymentMode?: string | null;
  couponCode?: string | null;
}

/**
 * POST the sale payload to SALE_WEBHOOK_URL with a 5s timeout. Returns true
 * on a 2xx response. Designed to be called WITHOUT await — the .catch
 * suppresses any abort or network error so the caller's hot path is
 * unblocked.
 */
export async function sendSaleWebhook(
  payload: SaleWebhookPayload,
): Promise<boolean> {
  const url = getConfig('SALE_WEBHOOK_URL', '').trim();
  if (!url) return false;

  // Quick URL sanity check — we don't want to issue requests against
  // file:// or javascript: schemes if the config got corrupted somehow.
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  } catch {
    return false;
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      // AbortSignal.timeout is supported in Node 18+ which Next 15 ships on.
      signal: AbortSignal.timeout(SALE_WEBHOOK_TIMEOUT_MS),
    });
    if (!res.ok) {
      logAudit({
        actor: 'system',
        action: 'sale_webhook_non_2xx',
        details: { url, status: res.status, paymentId: payload.paymentId },
      });
      return false;
    }
    return true;
  } catch (err) {
    logAudit({
      actor: 'system',
      action: 'sale_webhook_failed',
      details: {
        url,
        paymentId: payload.paymentId,
        error: err instanceof Error ? err.message : 'unknown',
      },
    });
    return false;
  }
}
