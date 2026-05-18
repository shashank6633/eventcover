/**
 * Console OTP provider — prints OTP to the server log.
 *
 * Used as the default in development + as a graceful fallback if email/WhatsApp providers
 * aren't configured yet. The operator reads the OTP from the running terminal.
 *
 * In production, set OTP_PROVIDER=email or OTP_PROVIDER=whatsapp once the corresponding
 * provider is configured.
 */
import type { OtpProvider, OtpDeliveryPayload, OtpDeliveryResult } from './types';

export const consoleOtpProvider: OtpProvider = {
  id: 'console',
  displayName: 'Console (server log)',

  isConfigured(): boolean {
    return true; // Always configured — no creds required.
  },

  async send(payload: OtpDeliveryPayload): Promise<OtpDeliveryResult> {
    const target = payload.type === 'email' ? `📧 ${payload.identifier}` : `📱 ${payload.identifier}`;
    const expiresInMin = Math.max(1, Math.round((payload.expiresAt - Date.now()) / 60000));

    // Render a high-visibility banner so operators can spot it quickly.
    const bar = '═'.repeat(46);
    /* eslint-disable no-console */
    console.log(`\n╔${bar}╗`);
    console.log(`║  ${payload.venueName.padEnd(42)}  ║`);
    console.log(`║  Login OTP  →  ${payload.code.padEnd(28)}  ║`);
    console.log(`║  Recipient  →  ${target.padEnd(28)}  ║`);
    console.log(`║  Expires    →  ${expiresInMin} minute(s)`.padEnd(46) + '  ║');
    console.log(`╚${bar}╝\n`);
    /* eslint-enable no-console */

    return { ok: true, channel: 'console' };
  },
};
