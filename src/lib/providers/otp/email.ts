/**
 * Email OTP provider — Gmail SMTP (or any SMTP server).
 *
 * Configuration via env vars (preferred for secrets) with fallback to config table:
 *   SMTP_HOST       (default: smtp.gmail.com)
 *   SMTP_PORT       (default: 465)
 *   SMTP_SECURE     ('true' for 465, 'false' for 587 STARTTLS)
 *   SMTP_USER       (your Gmail address)
 *   SMTP_PASS       (Gmail App Password — NOT your account password)
 *   SMTP_FROM       (optional display name, defaults to SMTP_USER)
 *
 * Nodemailer dep is lazy-imported so the bundle doesn't carry it when this provider isn't active.
 *
 * To activate:
 *   1. npm install nodemailer
 *   2. Set the SMTP_* env vars above (use a Google App Password)
 *   3. Set config.OTP_PROVIDER = 'email'
 */
import { getConfig } from '@/lib/db';
import type { OtpProvider, OtpDeliveryPayload, OtpDeliveryResult } from './types';

interface SmtpCreds {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

function readCreds(): SmtpCreds | null {
  const user = process.env.SMTP_USER ?? getConfig('SMTP_USER', '');
  const pass = process.env.SMTP_PASS ?? getConfig('SMTP_PASS', '');
  if (!user || !pass) return null;

  const host = process.env.SMTP_HOST ?? getConfig('SMTP_HOST', 'smtp.gmail.com');
  const portRaw = process.env.SMTP_PORT ?? getConfig('SMTP_PORT', '465');
  const port = Number(portRaw) || 465;
  const secureRaw = process.env.SMTP_SECURE ?? getConfig('SMTP_SECURE', port === 465 ? 'true' : 'false');
  const secure = secureRaw === 'true';
  const from = process.env.SMTP_FROM ?? getConfig('SMTP_FROM', '') ?? user;

  return { host, port, secure, user, pass, from };
}

export const emailOtpProvider: OtpProvider = {
  id: 'email',
  displayName: 'Email (SMTP)',

  isConfigured(): boolean {
    return readCreds() !== null;
  },

  async send(payload: OtpDeliveryPayload): Promise<OtpDeliveryResult> {
    if (payload.type !== 'email') {
      return { ok: false, channel: 'email', error: `Cannot deliver to ${payload.type} via email provider` };
    }
    const creds = readCreds();
    if (!creds) {
      return { ok: false, channel: 'email', error: 'SMTP credentials missing — set SMTP_USER + SMTP_PASS' };
    }

    let nodemailer: typeof import('nodemailer');
    try {
      nodemailer = await import('nodemailer');
    } catch {
      return {
        ok: false,
        channel: 'email',
        error: "nodemailer not installed — run 'npm install nodemailer' to enable email OTP",
      };
    }

    try {
      const transporter = nodemailer.createTransport({
        host: creds.host,
        port: creds.port,
        secure: creds.secure,
        auth: { user: creds.user, pass: creds.pass },
      });

      const expiresInMin = Math.max(1, Math.round((payload.expiresAt - Date.now()) / 60000));
      const info = await transporter.sendMail({
        from: `"${payload.venueName}" <${creds.from}>`,
        to: payload.identifier,
        subject: `${payload.code} is your ${payload.venueName} login code`,
        text:
          `Your one-time login code: ${payload.code}\n\n` +
          `It expires in ${expiresInMin} minute(s). Never share this code with anyone.`,
        html: htmlBody(payload, expiresInMin),
      });

      return { ok: true, channel: 'email', ref: info.messageId };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown SMTP error';
      return { ok: false, channel: 'email', error: msg };
    }
  },
};

function htmlBody(p: OtpDeliveryPayload, expiresInMin: number): string {
  return `
    <div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#F8F7F4;">
      <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:32px;text-align:center;">
        <div style="text-transform:uppercase;letter-spacing:.25em;color:#9CA3AF;font-size:11px;">${p.venueName}</div>
        <h1 style="margin:8px 0 24px;color:#111827;font-size:18px;">Your login code</h1>
        <div style="font-size:36px;font-weight:800;letter-spacing:.3em;color:#C1551A;padding:18px 0;
                    background:#FCEFE5;border-radius:10px;margin:0 0 20px;">
          ${p.code}
        </div>
        <p style="color:#6B7280;font-size:13px;margin:0;">
          Expires in ${expiresInMin} minute(s). Never share this code with anyone — staff will never ask for it.
        </p>
      </div>
    </div>
  `;
}
