/**
 * WhatsApp OTP provider — delivers login codes via Interakt (BSP for
 * WhatsApp Business API).
 *
 * Wired to the approved template `akan_login_otp` (Authentication category,
 * Copy-code button enabled). The template body is fixed by Meta:
 *   "{{1}} is your verification code."
 * with an auto-attached "Copy code" button whose value is also the OTP code.
 *
 * Credentials come from the config table:
 *   INTERAKT_API_SECRET       — Basic auth secret (managed via Settings → WhatsApp)
 *   INTERAKT_BUSINESS_PHONE   — display-only, confirms which sender is active
 *
 * Activate by setting `OTP_PROVIDER=whatsapp` in config.
 */
import type { OtpProvider, OtpDeliveryPayload, OtpDeliveryResult } from './types';
import { getConfig } from '@/lib/db';
import {
  isInteraktConfigured,
  sendInteraktTemplate,
  splitPhone,
} from '@/lib/providers/whatsapp/interakt';

export const whatsappOtpProvider: OtpProvider = {
  id: 'whatsapp',
  displayName: 'WhatsApp (Interakt)',

  isConfigured(): boolean {
    // Interakt API secret is the single credential we need. Business phone is
    // display-only — Interakt knows the sender from the API key.
    return isInteraktConfigured();
  },

  async send(payload: OtpDeliveryPayload): Promise<OtpDeliveryResult> {
    if (payload.type !== 'phone') {
      return {
        ok: false,
        channel: 'whatsapp',
        error: `Cannot deliver to ${payload.type} via WhatsApp`,
      };
    }
    if (!this.isConfigured()) {
      return {
        ok: false,
        channel: 'whatsapp',
        error: 'Interakt not configured — add API secret in Settings → WhatsApp',
      };
    }

    const templateName = getConfig('WHATSAPP_OTP_TEMPLATE', 'akan_login_otp');
    const languageCode = getConfig('WHATSAPP_OTP_LANGUAGE', 'en');

    const { countryCode, phoneNumber } = splitPhone(payload.identifier);

    const result = await sendInteraktTemplate({
      countryCode,
      phoneNumber,
      templateName,
      languageCode,
      // Authentication template body has one variable — the code itself.
      bodyValues: [payload.code],
      // Copy-code button parameter — Meta auto-fill needs the code passed here too.
      buttonValues: { '0': [payload.code] },
      callbackData: `otp:${payload.identifier}`,
    });

    if (!result.ok) {
      return {
        ok: false,
        channel: 'whatsapp',
        error: result.error || `Interakt API ${result.status ?? '?'}`,
      };
    }
    return { ok: true, channel: 'whatsapp', ref: result.messageId };
  },
};
