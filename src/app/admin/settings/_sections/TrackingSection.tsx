'use client';

import { SectionShell } from './SectionShell';
import { useConfigSection } from './useConfigSection';

const KEYS = ['META_PIXEL_ID'];

const AUTO_EVENTS: { name: string; desc: string }[] = [
  { name: 'PageView',     desc: 'Fires on every event invite + booking page load.' },
  { name: 'ViewContent',  desc: 'When a guest opens a public event invite.' },
  { name: 'InitiateCheckout', desc: 'Guest opens the booking form.' },
  { name: 'AddPaymentInfo', desc: 'Guest reaches the payment step.' },
  { name: 'Purchase',     desc: 'Booking confirmed and paid (CAPI-mirrored).' },
];

export function TrackingSection() {
  const { config, set, save, loaded, saving, saved, error } = useConfigSection(KEYS);

  if (!loaded) {
    return <div className="text-slate-400 text-sm">Loading…</div>;
  }

  const pixelId = config.META_PIXEL_ID || '';
  const hasPixel = !!pixelId.trim();

  return (
    <SectionShell
      eyebrow="Brand Page"
      title="Tracking"
      description="Add your Meta Pixel ID to track ad performance across your public event pages."
      onSave={save}
      saving={saving}
      saved={saved}
      error={error}
    >
      <div className="card space-y-4">
        <div className="text-xs uppercase tracking-widest text-slate-500">
          Meta Pixel
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2">
          <input
            className="input"
            value={pixelId}
            onChange={(e) => set('META_PIXEL_ID', e.target.value)}
            placeholder="e.g. 1234567890123456"
          />
          <button
            onClick={() => save()}
            disabled={saving}
            className="btn btn-primary md:w-auto"
          >
            {hasPixel ? 'Update' : 'Add'}
          </button>
        </div>

        <div className="text-xs text-slate-500">
          Find your Pixel ID in{' '}
          <a
            href="https://business.facebook.com/events_manager2"
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand-600 hover:underline"
          >
            Meta Events Manager
          </a>{' '}
          → Data Sources → your Pixel → Settings.
        </div>
      </div>

      <div className="card space-y-3 border-sky-200 bg-sky-50/50">
        <div className="text-xs uppercase tracking-widest text-sky-700">
          Auto-tracked Events
        </div>
        <p className="text-sm text-slate-700">
          Once your Pixel ID is set, the following events fire automatically
          across your public event pages — no extra code required. Server-side
          mirroring via Conversions API is configured separately on the
          host-only{' '}
          <a
            href="/admin/settings/meta"
            className="text-brand-600 hover:underline"
          >
            Meta integration page
          </a>
          .
        </p>
        <ul className="space-y-2">
          {AUTO_EVENTS.map((ev) => (
            <li
              key={ev.name}
              className="flex items-start gap-3 text-sm"
            >
              <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-white border border-sky-200 text-sky-700 flex-shrink-0 mt-0.5">
                {ev.name}
              </span>
              <span className="text-slate-600">{ev.desc}</span>
            </li>
          ))}
        </ul>
      </div>
    </SectionShell>
  );
}
