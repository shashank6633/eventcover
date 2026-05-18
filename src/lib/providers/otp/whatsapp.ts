/**
 * WhatsApp OTP provider — Meta WhatsApp Cloud API.
 *
 * Stub: full impl needs an approved utility/authentication template + permanent access token.
 * Drop creds into env (or config) and flip OTP_PROVIDER=whatsapp to activate.
 *
 * Env vars (preferred — secrets should never live in the DB):
 *   WHATSAPP_TOKEN              (permanent token from Meta Business Suite)
 *   WHATSAPP_PHONE_NUMBER_ID    (the registered sender's phone_number_id)
 *   WHATSAPP_TEMPLATE_NAME      (approved authentication template name)
 *   WHATSAPP_TEMPLATE_LANG      (e.g. en_US — must match the template's locale)
 */
import type { OtpProvider, OtpDeliveryPayload, OtpDeliveryResult } from './types';
import { getConfig } from '@/lib/db';

function token(): string {
  return process.env.WHATSAPP_TOKEN ?? getConfig('WHATSAPP_TOKEN', '');
}
function phoneNumberId(): string {
  return process.env.WHATSAPP_PHONE_NUMBER_ID ?? getConfig('WHATSAPP_PHONE_NUMBER_ID', '');
}
function templateName(): string {
  return process.env.WHATSAPP_TEMPLATE_NAME ?? getConfig('WHATSAPP_TEMPLATE_NAME', '');
}
function templateLang(): string {
  return process.env.WHATSAPP_TEMPLATE_LANG ?? getConfig('WHATSAPP_TEMPLATE_LANG', 'en_US');
}

export const whatsappOtpProvider: OtpProvider = {
  id: 'whatsapp',
  displayName: 'WhatsApp (Meta Cloud API)',

  isConfigured(): boolean {
    return !!(token() && phoneNumberId() && templateName());
  },

  async send(payload: OtpDeliveryPayload): Promise<OtpDeliveryResult> {
    if (payload.type !== 'phone') {
      return { ok: false, channel: 'whatsapp', error: `Cannot deliver to ${payload.type} via WhatsApp` };
    }
    if (!this.isConfigured()) {
      return {
        ok: false,
        channel: 'whatsapp',
        error: 'WhatsApp not configured — set WHATSAPP_TOKEN + WHATSAPP_PHONE_NUMBER_ID + WHATSAPP_TEMPLATE_NAME',
      };
    }

    // Meta Cloud API authentication-template payload.
    // The template should be defined as "authentication" category in Meta Business Manager
    // with one body variable for the OTP code.
    const to = payload.identifier.replace(/[^\d+]/g, '').replace(/^\+/, '');
    const url = `https://graph.facebook.com/v20.0/${phoneNumberId()}/messages`;
    const body = {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: templateName(),
        language: { code: templateLang() },
        components: [
          {
            type: 'body',
            parameters: [{ type: 'text', text: payload.code }],
          },
          {
            type: 'button',
            sub_type: 'url',
            index: '0',
            parameters: [{ type: 'text', text: payload.code }],
          },
        ],
      },
    };

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return { ok: false, channel: 'whatsapp', error: `Meta API ${res.status}: ${text.slice(0, 200)}` };
      }
      const json = (await res.json()) as { messages?: { id: string }[] };
      return { ok: true, channel: 'whatsapp', ref: json.messages?.[0]?.id };
    } catch (err) {
      return { ok: false, channel: 'whatsapp', error: err instanceof Error ? err.message : 'network error' };
    }
  },
};
