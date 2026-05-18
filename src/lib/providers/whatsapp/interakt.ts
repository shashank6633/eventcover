/**
 * Interakt — WhatsApp Business Solution Provider.
 *
 * Sends pre-approved template messages over the Interakt Public API. Used by:
 *   • WhatsApp OTP login (template: akan_login_otp)
 *   • Reservation confirmation (template: reservation_confirmed)
 *   • Ticket confirmation (template: ticket_confirmed)
 *
 * Credentials live in the config table (host-only sub-page in Settings):
 *   INTERAKT_API_SECRET       — Basic Auth secret from Interakt dashboard
 *   INTERAKT_BUSINESS_PHONE   — your verified WhatsApp Business number (display)
 *
 * Rate limit (current Interakt plan): 40 req/min. The sender enforces a
 * 1500 ms minimum gap between calls so batch sends don't 429.
 */
import { getConfig } from '@/lib/db';

const INTERAKT_ENDPOINT = 'https://api.interakt.ai/v1/public/message/';

export interface InteraktSendInput {
  /** Country code with leading +, e.g. "+91". */
  countryCode: string;
  /** Phone number WITHOUT country code, digits only, e.g. "9876543210". */
  phoneNumber: string;
  /** Approved template slug (case-sensitive). */
  templateName: string;
  /** Language code as approved by Meta (e.g. "en"). */
  languageCode: string;
  /** Values for {{1}}, {{2}}, ... in template body order. */
  bodyValues?: string[];
  /** Values for header variables, if the header has any. */
  headerValues?: string[];
  /**
   * Values for buttons that take variables (e.g. Authentication templates'
   * Copy Code button must receive the OTP code as a parameter).
   * Format: { "<button index>": [value1, value2, ...] }
   * For OTP: { "0": ["1234"] }
   */
  buttonValues?: Record<string, string[]>;
  /** Free-form ref string Interakt echoes back on webhooks (good for matching). */
  callbackData?: string;
}

export interface InteraktSendResult {
  ok: boolean;
  /** Interakt's message id on success. */
  messageId?: string;
  /** Human-readable error reason on failure. */
  error?: string;
  /** Raw upstream status for callers that want to react (429, 401, etc.). */
  status?: number;
}

export function isInteraktConfigured(): boolean {
  return !!getConfig('INTERAKT_API_SECRET', '');
}

function authHeader(): string {
  // Interakt's "API Secret" in their dashboard is already the base64-encoded
  // token. We just prefix with `Basic `. Don't re-encode — that produces a
  // double-encoded token and Interakt rejects with "Invalid token provided".
  // Tolerate two paste variants:
  //   1. raw secret  → "Basic <raw>"
  //   2. full header → "Basic XXXX..." (left as-is)
  const raw = getConfig('INTERAKT_API_SECRET', '').trim();
  if (!raw) return '';
  if (raw.toLowerCase().startsWith('basic ')) return raw;
  return `Basic ${raw}`;
}

/** Normalise an Indian-format phone into { countryCode, phoneNumber } digits. */
export function splitPhone(input: string): { countryCode: string; phoneNumber: string } {
  const cleaned = String(input || '').replace(/[^\d+]/g, '');
  if (cleaned.startsWith('+91')) return { countryCode: '+91', phoneNumber: cleaned.slice(3) };
  if (cleaned.startsWith('91') && cleaned.length === 12) return { countryCode: '+91', phoneNumber: cleaned.slice(2) };
  if (cleaned.length === 10) return { countryCode: '+91', phoneNumber: cleaned };
  // Generic E.164 — try to split at the +
  if (cleaned.startsWith('+')) {
    // Treat first 1-3 digits after + as country code (best effort)
    const m = cleaned.match(/^\+(\d{1,3})(\d+)$/);
    if (m) return { countryCode: `+${m[1]}`, phoneNumber: m[2] };
  }
  return { countryCode: '+91', phoneNumber: cleaned };
}

/**
 * Send a pre-approved template message via Interakt.
 *
 * Returns a normalised result — never throws. Caller decides whether to retry.
 */
export async function sendInteraktTemplate(input: InteraktSendInput): Promise<InteraktSendResult> {
  if (!isInteraktConfigured()) {
    return { ok: false, error: 'Interakt not configured. Add API secret in Settings → WhatsApp.' };
  }

  const auth = authHeader();
  const body: Record<string, unknown> = {
    countryCode: input.countryCode,
    phoneNumber: input.phoneNumber,
    callbackData: input.callbackData ?? '',
    type: 'Template',
    template: {
      name: input.templateName,
      languageCode: input.languageCode,
      headerValues: input.headerValues ?? [],
      bodyValues: input.bodyValues ?? [],
      ...(input.buttonValues ? { buttonValues: input.buttonValues } : {}),
    },
  };

  // Diagnostic summary — does NOT leak the secret. Shows length, first 4,
  // last 4 chars so we can sanity-check what's stored vs what the user pasted.
  const secret = getConfig('INTERAKT_API_SECRET', '').trim();
  const secretSummary = secret
    ? `len=${secret.length}, head=${secret.slice(0, 4)}…tail=…${secret.slice(-4)}`
    : '(empty)';
  /* eslint-disable no-console */
  console.log(`[interakt] POST ${INTERAKT_ENDPOINT}`);
  console.log(`[interakt] auth: ${auth.slice(0, 10)}… (${secretSummary})`);
  console.log(`[interakt] body:`, JSON.stringify(body));
  /* eslint-enable no-console */

  let res: Response;
  try {
    res = await fetch(INTERAKT_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'network error' };
  }

  const status = res.status;
  let payload: Record<string, unknown> = {};
  let rawText = '';
  try {
    rawText = await res.text();
    payload = rawText ? JSON.parse(rawText) as Record<string, unknown> : {};
  } catch { /* not all errors return JSON */ }

  /* eslint-disable no-console */
  console.log(`[interakt] ← ${status} :: ${rawText.slice(0, 300)}`);
  /* eslint-enable no-console */

  if (!res.ok) {
    const message =
      (payload?.message as string) ||
      (payload?.result as string) ||
      `Interakt API ${status}`;
    return { ok: false, error: message, status };
  }

  // Interakt success envelope varies by version — pull a message id where we can find it.
  const messageId =
    (payload?.id as string) ||
    ((payload?.data as Record<string, string>)?.id as string) ||
    undefined;

  return { ok: true, messageId, status };
}
