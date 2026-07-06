'use client';

/**
 * Integrations section — landing card for every third-party wire-up.
 *
 * Was a discoverability gap: the /admin/settings side-nav had no entry for
 * Razorpay or Reservego at all (WhatsApp lived under Notifications, Meta
 * Pixel under Tracking, and no top-level "Integrations" tab existed). This
 * section closes the gap by grouping every integration in one place with
 * live status pills so the operator can see setup state at a glance.
 *
 * Each card links to its dedicated per-integration configuration page
 * (/admin/settings/razorpay, /admin/settings/whatsapp, etc.). The umbrella
 * /admin/settings/integrations page (a separate route with more depth) is
 * also linked at the bottom for the classic "settings summary" view.
 *
 * Status is fetched from /api/settings/all which returns a masked config
 * projection — SENSITIVE_KEYS come back as '••••••••', which is what we
 * check against to derive Configured vs Not-configured. This matches the
 * same policy the umbrella integrations page uses so both stay in sync.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { SectionShell } from './SectionShell';

interface ConfigMap {
  RAZORPAY_KEY_ID?: string;
  RAZORPAY_KEY_SECRET?: string;
  INTERAKT_API_KEY?: string;
  META_PIXEL_ID?: string;
  META_CAPI_TOKEN?: string;
  RESERVEGO_WEBHOOK_SECRET?: string;
  OTP_PROVIDER?: string;
  AUTO_SEND_WHATSAPP_PASS?: string;
}

interface Row {
  href: string;
  title: string;
  description: string;
  configured: boolean;
  status: string;
  statusTone: 'ok' | 'warn' | 'off';
  icon: React.ReactNode;
}

export function IntegrationsSection() {
  const [config, setConfig] = useState<ConfigMap | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/settings/all')
      .then((r) => r.json())
      .then((d) => {
        // GET /api/settings/all returns SENSITIVE_KEYS masked as '••••••••',
        // which is truthy — we treat any non-empty value as "set". For
        // OTP_PROVIDER + AUTO_SEND_WHATSAPP_PASS (non-sensitive), we see
        // the real value.
        if (d?.ok) setConfig(d.config || {});
      })
      .catch(() => setConfig({}))
      .finally(() => setLoading(false));
  }, []);

  // Derivations — same policy as /admin/settings/integrations so pills stay
  // consistent across the two views.
  const rows: Row[] = (() => {
    if (!config) return [];
    const razorpayConfigured = !!config.RAZORPAY_KEY_ID && !!config.RAZORPAY_KEY_SECRET;
    const razorpayLive = razorpayConfigured && !!config.RAZORPAY_KEY_ID?.startsWith('rzp_live_');
    const interaktConfigured = !!config.INTERAKT_API_KEY;
    const whatsappOtp = config.OTP_PROVIDER === 'whatsapp';
    const autoSendPass =
      config.AUTO_SEND_WHATSAPP_PASS === '1' ||
      config.AUTO_SEND_WHATSAPP_PASS?.toLowerCase() === 'true';
    const metaConfigured = !!config.META_PIXEL_ID;
    const metaFullyConfigured = metaConfigured && !!config.META_CAPI_TOKEN;
    const reservegoConfigured = !!config.RESERVEGO_WEBHOOK_SECRET;

    return [
      {
        href: '/admin/settings/razorpay',
        title: 'Razorpay',
        description: 'Payment gateway for online bookings + Reservego prepay links.',
        configured: razorpayConfigured,
        status: razorpayConfigured
          ? razorpayLive ? 'Live mode' : 'Test mode'
          : 'Not configured',
        statusTone: razorpayConfigured ? (razorpayLive ? 'ok' : 'warn') : 'off',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-5 h-5" aria-hidden>
            <path d="M3 6h18l-4 12h-9L3 6ZM8 22a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM17 22a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z" />
          </svg>
        ),
      },
      {
        href: '/admin/settings/whatsapp',
        title: 'WhatsApp (Interakt)',
        description: 'Wallet pass delivery, event reminders, host booking alerts, OTP login.',
        configured: interaktConfigured,
        status: !interaktConfigured
          ? 'Not configured'
          : autoSendPass && whatsappOtp
            ? 'Passes + OTP active'
            : autoSendPass
              ? 'Passes only'
              : whatsappOtp
                ? 'OTP only'
                : 'Key set · sends disabled',
        statusTone: !interaktConfigured
          ? 'off'
          : autoSendPass && whatsappOtp
            ? 'ok'
            : 'warn',
        icon: (
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5" aria-hidden>
            <path d="M12 2a10 10 0 0 0-8.5 15.2L2 22l4.9-1.4A10 10 0 1 0 12 2Zm5.4 14.2c-.2.7-1.2 1.3-1.9 1.4-.5.1-1.1.2-3.8-.8-3.2-1.3-5.2-4.5-5.4-4.7-.2-.2-1.3-1.7-1.3-3.2 0-1.5.8-2.3 1.1-2.6.3-.3.6-.4.8-.4h.5c.2 0 .5 0 .7.5.3.6.8 2 .9 2.2.1.2.1.4 0 .6-.1.2-.2.4-.4.6-.2.2-.4.5-.5.6-.2.2-.3.4-.1.7.2.4 1 1.6 2.1 2.6 1.4 1.2 2.6 1.6 3 1.8.4.2.6.1.8-.1.2-.2.9-1.1 1.2-1.4.2-.4.5-.3.8-.2.3.1 2 1 2.4 1.1.4.2.6.3.7.5.1.2.1.9-.1 1.7Z" />
          </svg>
        ),
      },
      {
        href: '/admin/settings/meta',
        title: 'Meta Pixel + CAPI',
        description: 'Facebook Ads tracking — Pixel for browser, CAPI for server-side events.',
        configured: metaConfigured,
        status: !metaConfigured
          ? 'Not configured'
          : metaFullyConfigured
            ? 'Pixel + CAPI active'
            : 'Pixel only (no CAPI)',
        statusTone: !metaConfigured ? 'off' : metaFullyConfigured ? 'ok' : 'warn',
        icon: (
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5" aria-hidden>
            <path d="M22 12a10 10 0 1 0-11.6 9.9v-7H8V12h2.4V9.8c0-2.4 1.4-3.7 3.6-3.7 1 0 2.1.2 2.1.2v2.3h-1.2c-1.2 0-1.6.7-1.6 1.5V12H16l-.4 2.9h-2.2v7A10 10 0 0 0 22 12Z" />
          </svg>
        ),
      },
      {
        href: '/admin/settings/reservego',
        title: 'Reservego',
        description: 'Table reservation webhook — auto-import bookings from Reservego.',
        configured: reservegoConfigured,
        status: reservegoConfigured ? 'Webhook active' : 'Not configured',
        statusTone: reservegoConfigured ? 'ok' : 'off',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-5 h-5" aria-hidden>
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M3 10h18M8 4v3M16 4v3M8 14h3M13 14h3" />
          </svg>
        ),
      },
    ];
  })();

  return (
    <SectionShell
      title="Integrations"
      description="Connect Razorpay, WhatsApp, Meta Pixel, and Reservego. Each integration has its own configuration page — set the credentials there, then the whole platform picks them up automatically."
    >
      {loading ? (
        <div className="text-sm text-slate-500">Loading integrations…</div>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <Link
              key={r.href}
              href={r.href}
              className="group flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3.5 hover:border-brand-300 hover:bg-brand-50/30 transition"
            >
              <div
                className={
                  'w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 border ' +
                  (r.configured
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-slate-50 text-slate-400 border-slate-200')
                }
              >
                {r.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="text-sm font-semibold text-slate-900 group-hover:text-brand-800">
                    {r.title}
                  </div>
                  <StatusPill tone={r.statusTone} label={r.status} />
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">{r.description}</div>
              </div>
              <div className="text-slate-300 group-hover:text-brand-500 self-center">→</div>
            </Link>
          ))}

          {/* Umbrella overview link — the classic /admin/settings/integrations
              page has deeper detail (masked keys, test-send buttons for each
              provider). Kept as a secondary entry point rather than the
              primary one because the cards above are more scannable. */}
          <Link
            href="/admin/settings/integrations"
            className="block text-[11px] text-slate-400 hover:text-brand-600 hover:underline text-center pt-2"
          >
            View integrations overview page →
          </Link>
        </div>
      )}
    </SectionShell>
  );
}

function StatusPill({
  tone,
  label,
}: {
  tone: 'ok' | 'warn' | 'off';
  label: string;
}) {
  const cls =
    tone === 'ok'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : tone === 'warn'
        ? 'bg-amber-50 text-amber-700 border-amber-200'
        : 'bg-slate-100 text-slate-500 border-slate-200';
  return (
    <span
      className={
        'text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border font-semibold whitespace-nowrap ' +
        cls
      }
    >
      {label}
    </span>
  );
}
