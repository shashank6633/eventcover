'use client';

import { useEffect, useState } from 'react';
import type { Venue } from '@/lib/venues';
import type { WizardState } from './types';

interface Props {
  state: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
}

/**
 * Location section — venue picker. Address/map detail comes from the
 * selected venue's record so hosts maintain venues in one place rather
 * than re-typing for every event.
 */
export function SectionLocation({ state, onChange }: Props) {
  const [venues, setVenues] = useState<Venue[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/venues').then((r) => r.json()).then((d) => {
      if (d?.ok) setVenues(d.venues || []);
      setLoading(false);
    });
  }, []);

  const selected = venues.find((v) => v.id === state.venue_id) || null;

  return (
    <div className="card space-y-5">
      <header>
        <h2 className="text-lg font-semibold text-slate-900">Location</h2>
        <p className="text-sm text-slate-500 mt-1">
          Pick the venue. Address + map link come from the venue record.
        </p>
      </header>

      <div>
        <label className="label">Venue</label>
        <select
          className="input"
          value={state.venue_id}
          onChange={(e) => onChange({ venue_id: e.target.value })}
          disabled={loading}
        >
          <option value="">To Be Disclosed</option>
          {venues.map((v) => (
            <option key={v.id} value={v.id}>{v.name} · {v.city}</option>
          ))}
        </select>
        <div className="text-[11px] text-slate-400 mt-1">
          Need to add a new venue?{' '}
          <a href="/admin/venues" target="_blank" className="text-brand-600 underline">
            Open Venues
          </a>
          {' '}in a new tab.
        </div>
      </div>

      {selected && (
        <div className="rounded-lg bg-slate-50 border border-slate-200 p-4 space-y-2">
          <div className="text-[10px] uppercase tracking-widest text-slate-500">
            From venue record
          </div>
          <div className="text-sm font-semibold text-slate-900">{selected.name}</div>
          {selected.address && (
            <div className="text-sm text-slate-700">{selected.address}</div>
          )}
          <div className="text-xs text-slate-500">{selected.city}</div>
          {selected.google_maps_url && (
            <a
              href={selected.google_maps_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700 mt-1"
            >
              View on Google Maps ↗
            </a>
          )}
        </div>
      )}

      {!selected && !loading && state.venue_id === '' && (
        <div className="text-xs text-slate-400 italic">
          No venue picked. The public event page will show &quot;Location: To be disclosed&quot;.
        </div>
      )}
    </div>
  );
}
