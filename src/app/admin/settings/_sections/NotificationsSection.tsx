'use client';

import { useEffect, useState } from 'react';
import { SectionShell } from './SectionShell';
import { useConfigSection } from './useConfigSection';

const KEYS = [
  'WHATSAPP_BOOKING_ALERTS_ENABLED',
  'SALE_WEBHOOK_URL',
  // Read-only — we need to know whether Interakt is connected to enable the
  // booking-alerts toggle. The API returns either '••••••••' (set) or '' (not).
  'INTERAKT_API_SECRET',
];

export function NotificationsSection() {
  const { config, set, save, loaded, saving, saved, error } = useConfigSection(KEYS);
  const [interaktConfigured, setInteraktConfigured] = useState(false);

  // Mirror the masked sentinel into a boolean for the toggle disabled state.
  // Done in an effect (rather than at render) so the WhatsApp pill flips
  // immediately if the user just connected Interakt and reloaded the page.
  useEffect(() => {
    setInteraktConfigured(config.INTERAKT_API_SECRET === '••••••••');
  }, [config.INTERAKT_API_SECRET]);

  if (!loaded) {
    return <div className="text-slate-400 text-sm">Loading…</div>;
  }

  const alertsOn = config.WHATSAPP_BOOKING_ALERTS_ENABLED === '1';
  const webhookUrl = config.SALE_WEBHOOK_URL || '';

  // Only persist the keys this section actually owns — INTERAKT_API_SECRET
  // is read-only here and writing the masked sentinel back would be a no-op
  // anyway (the API filters it), but explicit is better than implicit.
  const handleSave = () =>
    save({
      WHATSAPP_BOOKING_ALERTS_ENABLED: alertsOn ? '1' : '0',
      SALE_WEBHOOK_URL: webhookUrl,
    });

  return (
    <SectionShell
      eyebrow="General"
      title="Notifications"
      description="Real-time alerts and webhooks fired when guests book and pay."
      onSave={handleSave}
      saving={saving}
      saved={saved}
      error={error}
    >
      {/* ─── WhatsApp Booking Alerts ─────────────────────────────────── */}
      <div className="card space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-900">
              WhatsApp Booking Alerts
            </div>
            <p className="text-sm text-slate-500 mt-1">
              Send a WhatsApp message to your host phone whenever a new
              booking is created (manual entry, public web, or Reservego).
              Uses the <code className="text-xs">akan_host_booking_alert</code>{' '}
              template on Interakt.
            </p>
          </div>
          <label className="inline-flex items-center cursor-pointer flex-shrink-0">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={alertsOn}
              disabled={!interaktConfigured}
              onChange={(e) =>
                set('WHATSAPP_BOOKING_ALERTS_ENABLED', e.target.checked ? '1' : '0')
              }
            />
            <div
              className={`relative w-11 h-6 rounded-full transition ${
                alertsOn
                  ? 'bg-brand-600'
                  : 'bg-slate-200 peer-disabled:bg-slate-100'
              } peer-disabled:cursor-not-allowed`}
            >
              <div
                className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition ${
                  alertsOn ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </div>
          </label>
        </div>

        {!interaktConfigured && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 text-amber-800 px-3 py-2 text-xs">
            Connect WhatsApp (Interakt) in{' '}
            <a
              href="/admin/settings/whatsapp"
              className="font-semibold underline"
            >
              Settings → WhatsApp
            </a>{' '}
            before enabling this toggle.
          </div>
        )}
      </div>

      {/* ─── Sale Webhook ────────────────────────────────────────────── */}
      <div className="card space-y-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">Sale Webhook</div>
          <p className="text-sm text-slate-500 mt-1">
            We&apos;ll POST the complete sale transaction JSON to this URL when
            a payment is captured. Use{' '}
            <a
              href="https://webhook.site"
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand-600 hover:underline"
            >
              webhook.site
            </a>{' '}
            to test.
          </p>
        </div>

        <input
          className="input"
          type="url"
          inputMode="url"
          placeholder="https://example.com/webhooks/sale"
          value={webhookUrl}
          onChange={(e) => set('SALE_WEBHOOK_URL', e.target.value)}
        />

        <div className="text-xs text-slate-500 leading-relaxed">
          Fired once per captured payment. Body shape:{' '}
          <code className="text-[11px] px-1 py-0.5 rounded bg-slate-100 text-slate-700">
            {'{ paymentId, razorpayPaymentId, amount, currency, eventId, eventName, customerName, customerPhone, customerEmail, capturedAt }'}
          </code>
          . Delivery is fire-and-forget with a 5s timeout — no retries. Use a
          queue (e.g. Zapier, n8n) if you need durable delivery.
        </div>
      </div>
    </SectionShell>
  );
}
