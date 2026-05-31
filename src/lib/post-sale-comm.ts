/**
 * Per-event auto-WhatsApp after successful payment.
 *
 * The host writes a message ({{name}} and {{event}} placeholders supported)
 * and optionally attaches a PDF (URL or base64 data URL). On payment
 * verify, sendPostSale() fires the corresponding Interakt template ONCE
 * per payment_id (UNIQUE constraint on event_post_sale_attempts).
 *
 * Templates the host must register + approve at Meta:
 *   • event_post_sale_text — body "{{1}}" (1 var; the host-rendered message)
 *   • event_post_sale_doc  — header DOCUMENT, body "{{1}}"
 *
 * The lib renders {{name}}/{{event}} into the body BEFORE handing the
 * fully-rendered string to Interakt — so the WhatsApp template only ever
 * has ONE body variable to fill. Keeps template approval simple.
 *
 * Server-side only.
 */

import { nanoid } from 'nanoid';
import { getDb } from './db';
import { logAudit } from './audit';
import { getEvent } from './events';
import { sendInteraktTemplate, splitPhone, isInteraktConfigured } from './providers/whatsapp/interakt';

export type AttachmentKind = 'none' | 'pdf';

export interface PostSaleConfigRow {
  event_id: string;
  message_text: string | null;
  attachment_kind: AttachmentKind;
  attachment_url: string | null;
  enabled: number;
  template_text: string;
  template_doc: string;
  template_lang: string;
  updated_at: number;
  updated_by: string | null;
}

export interface PostSaleConfig {
  eventId: string;
  messageText: string;
  attachmentKind: AttachmentKind;
  attachmentUrl: string | null;
  enabled: boolean;
  templateText: string;
  templateDoc: string;
  templateLang: string;
  updatedAt: number;
  updatedBy: string | null;
}

const DEFAULT_TEMPLATE_TEXT = 'event_post_sale_text';
const DEFAULT_TEMPLATE_DOC = 'event_post_sale_doc';
const DEFAULT_TEMPLATE_LANG = 'en';

function defaults(eventId: string): PostSaleConfig {
  return {
    eventId,
    messageText: '',
    attachmentKind: 'none',
    attachmentUrl: null,
    enabled: false,
    templateText: DEFAULT_TEMPLATE_TEXT,
    templateDoc: DEFAULT_TEMPLATE_DOC,
    templateLang: DEFAULT_TEMPLATE_LANG,
    updatedAt: 0,
    updatedBy: null,
  };
}

function hydrate(row: PostSaleConfigRow): PostSaleConfig {
  return {
    eventId: row.event_id,
    messageText: row.message_text ?? '',
    attachmentKind: row.attachment_kind,
    attachmentUrl: row.attachment_url,
    enabled: row.enabled === 1,
    templateText: row.template_text,
    templateDoc: row.template_doc,
    templateLang: row.template_lang,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

export function getConfig(eventId: string): PostSaleConfig {
  if (!eventId) return defaults(eventId);
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM event_post_sale_comm WHERE event_id = ?')
    .get(eventId) as PostSaleConfigRow | undefined;
  if (!row) return defaults(eventId);
  return hydrate(row);
}

export interface UpsertConfigInput {
  eventId: string;
  messageText?: string | null;
  attachmentKind?: AttachmentKind;
  attachmentUrl?: string | null;
  enabled?: boolean;
  actor: string;
}

export function upsertConfig(input: UpsertConfigInput): PostSaleConfig {
  if (!input.eventId) throw new Error('eventId is required.');
  const ev = getEvent(input.eventId);
  if (!ev) throw new Error('Event not found.');

  const existing = getConfig(input.eventId);
  const message = (input.messageText ?? existing.messageText ?? '').toString();
  const attachmentKind: AttachmentKind = input.attachmentKind ?? existing.attachmentKind;
  let attachmentUrl: string | null = input.attachmentUrl ?? existing.attachmentUrl;
  if (attachmentKind === 'none') attachmentUrl = null;
  const enabledFlag = input.enabled !== undefined ? (input.enabled ? 1 : 0) : (existing.enabled ? 1 : 0);

  // Sanity-check the URL when present. PDF attachments must be reachable
  // by Interakt's media-template downloader — either an https URL or a
  // base64 data: URL (which the lib re-uploads / inlines as appropriate).
  if (attachmentKind === 'pdf' && attachmentUrl) {
    if (!/^(data:application\/pdf|https?:\/\/)/i.test(attachmentUrl)) {
      throw new Error('PDF attachment must be a https URL or data:application/pdf;base64,... URL.');
    }
  }

  // Reject enabling the feature without a message — would silently send
  // empty WhatsApps. The UI should also gate this, defense in depth here.
  if (enabledFlag === 1 && !message.trim()) {
    throw new Error('Message text is required when enabling post-sale comms.');
  }
  // And when attachmentKind=pdf but no URL — same reasoning.
  if (enabledFlag === 1 && attachmentKind === 'pdf' && !attachmentUrl) {
    throw new Error('Attachment URL is required for "Text + Document" mode.');
  }

  const now = Date.now();
  const db = getDb();
  db.prepare(
    `INSERT INTO event_post_sale_comm
       (event_id, message_text, attachment_kind, attachment_url, enabled,
        template_text, template_doc, template_lang, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(event_id) DO UPDATE SET
       message_text    = excluded.message_text,
       attachment_kind = excluded.attachment_kind,
       attachment_url  = excluded.attachment_url,
       enabled         = excluded.enabled,
       updated_at      = excluded.updated_at,
       updated_by      = excluded.updated_by`,
  ).run(
    input.eventId,
    message.trim() ? message : null,
    attachmentKind,
    attachmentUrl,
    enabledFlag,
    existing.templateText || DEFAULT_TEMPLATE_TEXT,
    existing.templateDoc || DEFAULT_TEMPLATE_DOC,
    existing.templateLang || DEFAULT_TEMPLATE_LANG,
    now,
    input.actor || null,
  );

  logAudit({
    actor: input.actor,
    action: 'event_post_sale_save',
    entityType: 'event',
    entityId: input.eventId,
    details: {
      enabled: !!enabledFlag,
      attachment_kind: attachmentKind,
      has_url: !!attachmentUrl,
      message_chars: message.length,
    },
  });

  return getConfig(input.eventId);
}

function renderMessage(template: string, vars: { name: string; event: string }): string {
  return (template || '')
    .replace(/\{\{\s*name\s*\}\}/gi, vars.name)
    .replace(/\{\{\s*event\s*\}\}/gi, vars.event);
}

export interface SendPostSaleInput {
  eventId: string;
  paymentId: string;
  reservationId?: string | null;
  name: string;
  phone: string;
}

export interface SendPostSaleResult {
  ok: boolean;
  skipped?: 'not_configured' | 'disabled' | 'no_message' | 'no_phone' | 'already_sent' | 'interakt_not_configured';
  messageId?: string;
  error?: string;
}

/**
 * Fire-and-forget WhatsApp send for a single payment. NEVER throws —
 * callers (especially /api/payments/verify) must not be blocked by WA.
 *
 * Idempotency: UNIQUE(payment_id) on event_post_sale_attempts. A repeat
 * call for the same payment_id catches the SQLITE_CONSTRAINT_UNIQUE and
 * returns skipped:'already_sent'.
 */
export async function sendPostSale(input: SendPostSaleInput): Promise<SendPostSaleResult> {
  try {
    if (!input.eventId || !input.paymentId) {
      return { ok: false, error: 'eventId and paymentId are required.' };
    }

    const config = getConfig(input.eventId);
    if (!config.enabled) return { ok: false, skipped: 'disabled' };
    if (!config.messageText.trim()) return { ok: false, skipped: 'no_message' };
    if (!input.phone) return { ok: false, skipped: 'no_phone' };
    if (!isInteraktConfigured()) return { ok: false, skipped: 'interakt_not_configured' };

    const db = getDb();
    // Pre-check dedup. INSERT-OR-IGNORE pattern below is the canonical
    // guard but this short-circuits the WA call when we already know.
    const dup = db
      .prepare(`SELECT 1 FROM event_post_sale_attempts WHERE payment_id = ? LIMIT 1`)
      .get(input.paymentId);
    if (dup) return { ok: false, skipped: 'already_sent' };

    const ev = getEvent(input.eventId);
    const eventName = ev?.name || 'your event';
    const renderedBody = renderMessage(config.messageText, {
      name: (input.name || 'Guest').trim(),
      event: eventName,
    });

    const { countryCode, phoneNumber } = splitPhone(input.phone);
    const isDoc = config.attachmentKind === 'pdf' && !!config.attachmentUrl;
    const templateName = isDoc ? (config.templateDoc || DEFAULT_TEMPLATE_DOC) : (config.templateText || DEFAULT_TEMPLATE_TEXT);

    const send = await sendInteraktTemplate({
      countryCode,
      phoneNumber,
      templateName,
      languageCode: config.templateLang || DEFAULT_TEMPLATE_LANG,
      bodyValues: [renderedBody],
      headerValues: isDoc && config.attachmentUrl ? [config.attachmentUrl] : [],
      callbackData: `event_post_sale:${input.paymentId}`,
    });

    const attemptId = nanoid();
    try {
      db.prepare(
        `INSERT INTO event_post_sale_attempts
           (id, event_id, payment_id, reservation_id, interakt_message_id, error, sent_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        attemptId,
        input.eventId,
        input.paymentId,
        input.reservationId || null,
        send.ok ? send.messageId || null : null,
        send.ok ? null : (send.error || 'unknown'),
        Date.now(),
      );
    } catch (err) {
      // UNIQUE — another concurrent verify beat us. Treat as success.
      const msg = err instanceof Error ? err.message : String(err);
      if (/UNIQUE/i.test(msg)) return { ok: false, skipped: 'already_sent' };
      throw err;
    }

    logAudit({
      actor: 'system',
      action: 'event_post_sale_send',
      entityType: 'event',
      entityId: input.eventId,
      details: {
        payment_id: input.paymentId,
        template: templateName,
        kind: isDoc ? 'doc' : 'text',
        ok: send.ok,
        error: send.error ?? null,
      },
    });

    return { ok: send.ok, messageId: send.messageId, error: send.error };
  } catch (err) {
    // Never throw from a fire-and-forget caller.
    return { ok: false, error: err instanceof Error ? err.message : 'unknown error' };
  }
}
