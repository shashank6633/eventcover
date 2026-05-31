/**
 * Wallet-pass WhatsApp sender.
 *
 * Glues together: (a) wallet lookup, (b) signed public URL for the PNG,
 * (c) Interakt template send with image header.
 *
 * Why an image template? The customer sees the QR inline in chat — no
 * need to tap to open a PDF. Captain scans straight off their screen.
 *
 * Template the venue must approve in Interakt + Meta:
 *   Name (default):  akan_cover_pass
 *   Language:        en
 *   Header:          IMAGE
 *   Body:            "Hi {{1}}, your cover pass for {{2}} is ready.
 *                    View balance: {{3}}"
 *   No buttons.
 *
 * The 3rd body variable ({{3}} = wallet-view URL) is gated by the
 * WALLET_PASS_TEMPLATE_INCLUDE_LINK config flag — when '0' we omit it so
 * older 2-variable templates that were approved before the wallet-view
 * page existed still send successfully.
 *
 * Caller never gets thrown at — failures return {ok:false}. The wallet
 * issue flow must NOT block on WhatsApp.
 */

import { getConfig } from '@/lib/db';
import { lookupWallet } from '@/lib/wallet';
import { getEvent } from '@/lib/events';
import { signWalletPassToken, signWalletViewToken } from '@/lib/signed-url';
import { sendInteraktTemplate, splitPhone, isInteraktConfigured } from '@/lib/providers/whatsapp/interakt';
import { logAudit } from '@/lib/audit';

export interface SendPassResult {
  ok: boolean;
  messageId?: string;
  error?: string;
  /** The public URL that was sent to Interakt — useful for debug + audit. */
  passUrl?: string;
  /** Set when WhatsApp send was deliberately skipped (toggle off, etc.). */
  skipped?: 'auto_send_off' | 'interakt_not_configured' | 'no_phone' | 'wallet_voided';
}

export interface SendPassInput {
  /** Wallet txn_id. */
  txnId: string;
  /** Origin base URL (e.g. "https://wallet.akanhyd.com"). Required since we
   *  can't introspect from a fire-and-forget helper. */
  origin: string;
  /** Human-readable 4-digit code shown under the QR in the pass image. */
  qrCodeId?: string;
  /** Who triggered this (for audit). Default: 'system'. */
  actor?: string;
  /** Force-send even if AUTO_SEND_WHATSAPP_PASS is off. Used by the manual
   *  "Resend" button on the admin UI. */
  force?: boolean;
}

export async function sendWalletPassWhatsApp(input: SendPassInput): Promise<SendPassResult> {
  const actor = input.actor || 'system';

  if (!input.force) {
    const auto = getConfig('AUTO_SEND_WHATSAPP_PASS', '0').trim();
    if (auto !== '1' && auto.toLowerCase() !== 'true') {
      return { ok: false, skipped: 'auto_send_off' };
    }
  }

  if (!isInteraktConfigured()) {
    return { ok: false, skipped: 'interakt_not_configured' };
  }

  const wallet = lookupWallet(input.txnId);
  if (!wallet) {
    return { ok: false, error: 'Wallet not found.' };
  }
  if (wallet.status === 'exhausted') {
    return { ok: false, skipped: 'wallet_voided' };
  }
  if (!wallet.phone) {
    return { ok: false, skipped: 'no_phone' };
  }

  // Resolve event name for the body
  let eventName = 'tonight';
  const walletEventId = (wallet as unknown as { event_id?: string | null }).event_id;
  if (walletEventId) {
    try {
      const ev = getEvent(walletEventId);
      if (ev?.name) eventName = ev.name;
    } catch { /* ignore */ }
  } else {
    const cfg = getConfig('EVENT_NAME', '').trim();
    if (cfg) eventName = cfg;
  }

  // Mint the signed public URL for the PNG
  const token = signWalletPassToken({ txnId: input.txnId, qrCodeId: input.qrCodeId });
  const origin = input.origin.replace(/\/$/, '');
  const passUrl = `${origin}/api/public/wallet-pass/${token}`;

  // Optionally mint a wallet-view URL for the 3rd body variable. Feature
  // flag because not every venue's already-approved WhatsApp template has
  // a 3-variable body — flipping the config to '0' restores back-compat.
  const includeLinkRaw = getConfig('WALLET_PASS_TEMPLATE_INCLUDE_LINK', '1').trim().toLowerCase();
  const includeLink = includeLinkRaw === '1' || includeLinkRaw === 'true';
  let walletUrl: string | undefined;
  let viewTokenTtlDays: number | undefined;
  if (includeLink) {
    const ttlDaysRaw = parseInt(getConfig('WALLET_VIEW_TOKEN_TTL_DAYS', '90').trim(), 10);
    viewTokenTtlDays = Number.isFinite(ttlDaysRaw) && ttlDaysRaw > 0 ? ttlDaysRaw : 90;
    const viewToken = signWalletViewToken({
      txnId: input.txnId,
      ttlSeconds: viewTokenTtlDays * 24 * 60 * 60,
    });
    walletUrl = `${origin}/w/${viewToken}`;
  }

  const { countryCode, phoneNumber } = splitPhone(wallet.phone);
  const templateName = getConfig('WALLET_PASS_TEMPLATE', 'akan_cover_pass').trim() || 'akan_cover_pass';
  const languageCode = getConfig('WALLET_PASS_TEMPLATE_LANG', 'en').trim() || 'en';

  const bodyValues = walletUrl
    ? [wallet.name || 'Guest', eventName, walletUrl]
    : [wallet.name || 'Guest', eventName];

  const result = await sendInteraktTemplate({
    countryCode,
    phoneNumber,
    templateName,
    languageCode,
    headerValues: [passUrl],
    bodyValues,
    callbackData: `wallet_pass:${input.txnId}`,
  });

  logAudit({
    actor,
    action: result.ok ? 'wallet_pass_whatsapp_sent' : 'wallet_pass_whatsapp_failed',
    entityType: 'wallet',
    entityId: input.txnId,
    details: {
      template: templateName,
      to: `${countryCode}${phoneNumber.slice(-4).padStart(phoneNumber.length, '*')}`,
      message_id: result.messageId ?? null,
      error: result.error ?? null,
      status: result.status ?? null,
      pass_url_host: new URL(passUrl).host,
      wallet_url_host: walletUrl ? new URL(walletUrl).host : null,
      view_url_minted: Boolean(walletUrl),
      view_token_ttl_days: viewTokenTtlDays ?? null,
    },
  });

  return {
    ok: result.ok,
    messageId: result.messageId,
    error: result.error,
    passUrl,
  };
}
