'use client';

import { SectionShell } from './SectionShell';
import { useConfigSection } from './useConfigSection';

/**
 * EventsSection — Brand Page → Events.
 *
 * Surfaces the legacy "global event default" config keys so the host can set
 * the starting values that a brand-new event uses. These ride alongside the
 * per-event editors on /admin (per-event values always win); changing them
 * here only affects events created _after_ the save.
 */
const KEYS = ['DEFAULT_ENTRY_FEE', 'EVENT_CUTOFF_HOUR', 'PIN_LENGTH'];

export function EventsSection() {
  const { config, set, save, loaded, saving, saved, error } = useConfigSection(KEYS);

  if (!loaded) {
    return <div className="text-slate-400 text-sm">Loading…</div>;
  }

  return (
    <SectionShell
      eyebrow="Brand Page"
      title="Events"
      description="Default settings used when you create a new event. These never overwrite an existing event."
      onSave={save}
      saving={saving}
      saved={saved}
      error={error}
    >
      <div className="card space-y-4">
        <div className="text-xs uppercase tracking-widest text-slate-500">
          Event Defaults
        </div>
        <p className="text-sm text-slate-500">
          When a new event is created, these become its starting values. Per-event
          editors on the <a href="/admin" className="text-brand-600 hover:underline">Events</a> page
          always take precedence.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="label">Default entry fee (₹)</label>
            <input
              className="input"
              type="number"
              min={0}
              step={50}
              value={config.DEFAULT_ENTRY_FEE || ''}
              onChange={(e) => set('DEFAULT_ENTRY_FEE', e.target.value)}
              placeholder="1500"
            />
            <div className="text-xs text-slate-500 mt-1.5">
              Per-person door entry, seeded into the booking form.
            </div>
          </div>

          <div>
            <label className="label">Cutoff hour</label>
            <input
              className="input"
              type="number"
              min={0}
              max={23}
              step={1}
              value={config.EVENT_CUTOFF_HOUR || ''}
              onChange={(e) => set('EVENT_CUTOFF_HOUR', e.target.value)}
              placeholder="2"
            />
            <div className="text-xs text-slate-500 mt-1.5">
              Hour (0–23) after midnight when door closes — wallets stop being
              issuable.
            </div>
          </div>

          <div>
            <label className="label">PIN length</label>
            <input
              className="input"
              type="number"
              min={4}
              max={8}
              step={1}
              value={config.PIN_LENGTH || ''}
              onChange={(e) => set('PIN_LENGTH', e.target.value)}
              placeholder="6"
            />
            <div className="text-xs text-slate-500 mt-1.5">
              Digits in the per-wallet redemption PIN. 4–8 supported.
            </div>
          </div>
        </div>
      </div>
    </SectionShell>
  );
}
