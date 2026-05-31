'use client';

import { ImageUpload } from '@/components/ImageUpload';
import { PhoneInput } from '@/components/PhoneInput';
import { SectionShell } from './SectionShell';
import { useConfigSection } from './useConfigSection';

const KEYS = [
  'VENUE_NAME',
  'VENUE_LOGO',
  'VENUE_PUBLIC_URL',
  'VENUE_FAVICON_URL',
  'HOST_PHONE',
  'HOST_EMAIL',
  'VENUE_ADDRESS',
  'VENUE_CITY',
];

export function WebsiteSection() {
  const { config, set, save, loaded, saving, saved, error } = useConfigSection(KEYS);

  if (!loaded) {
    return <div className="text-slate-400 text-sm">Loading…</div>;
  }

  return (
    <SectionShell
      eyebrow="Brand Page"
      title="Website"
      description="Your venue's public identity — name, logo and the URL guests land on."
      onSave={save}
      saving={saving}
      saved={saved}
      error={error}
    >
      <div className="card space-y-4">
        <div className="text-xs uppercase tracking-widest text-slate-500">Venue Identity</div>

        <div>
          <label className="label">
            Venue name <span className="text-rose-600">*</span>
          </label>
          <input
            className="input"
            value={config.VENUE_NAME || ''}
            onChange={(e) => set('VENUE_NAME', e.target.value)}
            placeholder="e.g. Akan Hyderabad"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[240px_1fr] gap-5 items-start">
          <ImageUpload
            value={config.VENUE_LOGO || ''}
            onChange={(d) => set('VENUE_LOGO', d ?? '')}
            label="Logo"
            helperText="Click or drop. Square works best."
          />
          <div className="text-sm text-slate-500 leading-relaxed">
            Your venue's logo — appears on the admin shell, event invites,
            receipts and share previews. A square format with a transparent
            background reads best.
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label">Public URL</label>
            <input
              className="input"
              value={config.VENUE_PUBLIC_URL || ''}
              onChange={(e) => set('VENUE_PUBLIC_URL', e.target.value)}
              placeholder="https://your-venue.com"
            />
            <div className="text-xs text-slate-500 mt-1.5">
              The default domain customers see in receipts &amp; share cards.
            </div>
          </div>
          <div>
            <label className="label">Favicon URL</label>
            <input
              className="input"
              value={config.VENUE_FAVICON_URL || ''}
              onChange={(e) => set('VENUE_FAVICON_URL', e.target.value)}
              placeholder="https://cdn.example.com/favicon.ico"
            />
            <div className="text-xs text-slate-500 mt-1.5">
              32×32 PNG or ICO. Shown in browser tabs.
            </div>
          </div>
        </div>
      </div>

      <div className="card space-y-4">
        <div className="text-xs uppercase tracking-widest text-slate-500">Contact</div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label">Host email</label>
            <input
              className="input"
              type="email"
              value={config.HOST_EMAIL || ''}
              onChange={(e) => set('HOST_EMAIL', e.target.value)}
              placeholder="host@venue.com"
            />
          </div>
          <div>
            <label className="label">Host phone</label>
            <PhoneInput
              value={config.HOST_PHONE || ''}
              onChange={(e164) => set('HOST_PHONE', e164)}
              placeholder="10-digit mobile number"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-4">
          <div>
            <label className="label">Address</label>
            <input
              className="input"
              value={config.VENUE_ADDRESS || ''}
              onChange={(e) => set('VENUE_ADDRESS', e.target.value)}
              placeholder="Street / area"
            />
          </div>
          <div>
            <label className="label">City</label>
            <input
              className="input"
              value={config.VENUE_CITY || ''}
              onChange={(e) => set('VENUE_CITY', e.target.value)}
              placeholder="Hyderabad"
            />
          </div>
        </div>
      </div>
    </SectionShell>
  );
}
