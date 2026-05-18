'use client';

import { useEffect, useState } from 'react';
import { ImageUpload } from '@/components/ImageUpload';
import { RichTextEditor } from '@/components/RichTextEditor';
import type { WizardState } from './types';
import type { Artist } from '@/lib/artists';
import type { Venue } from '@/lib/venues';

interface Props {
  state: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
}

const GENRES = [
  'EDM', 'House', 'Techno', 'Hip-Hop', 'Bollywood',
  'Live Band', 'Acoustic', 'Jazz', 'Commercial', 'Open Format',
];

export function StepDetails({ state, onChange }: Props) {
  const [venues, setVenues] = useState<Venue[]>([]);
  const [artists, setArtists] = useState<Artist[]>([]);
  const [tagInput, setTagInput] = useState('');

  useEffect(() => {
    fetch('/api/venues').then((r) => r.json()).then((d) => { if (d.ok) setVenues(d.venues || []); });
    fetch('/api/artists').then((r) => r.json()).then((d) => { if (d.ok) setArtists(d.artists || []); });
  }, []);

  function toggleArtist(id: string) {
    const next = state.artist_ids.includes(id)
      ? state.artist_ids.filter((x) => x !== id)
      : [...state.artist_ids, id];
    onChange({ artist_ids: next });
  }

  function addTag(raw: string) {
    const t = raw.trim();
    if (!t) return;
    if (state.tags.includes(t)) return;
    onChange({ tags: [...state.tags, t] });
    setTagInput('');
  }

  function removeTag(t: string) {
    onChange({ tags: state.tags.filter((x) => x !== t) });
  }

  function handleTagKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag(tagInput);
    } else if (e.key === 'Backspace' && tagInput === '' && state.tags.length > 0) {
      onChange({ tags: state.tags.slice(0, -1) });
    }
  }

  // Format Y-M-D as "Fri 15 May 2026" for the date tile
  const dateDisplay = state.event_date
    ? new Date(state.event_date + 'T00:00:00').toLocaleDateString('en-IN', {
        weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
      })
    : 'Pick a date';
  const dateDay = state.event_date ? state.event_date.split('-')[2] : '--';

  return (
    <div className="grid grid-cols-1 md:grid-cols-[220px,1fr] gap-6 items-start">
      {/* Left column: image + date + visibility + artists */}
      <div className="space-y-5">
        <ImageUpload
          value={state.image_data}
          onChange={(d) => onChange({ image_data: d })}
          label="Event image / DJ reel"
          helperText="Click or drop. 800×800 auto-resize."
        />

        <div>
          <div className="text-[11px] uppercase tracking-widest text-slate-500 mb-2">Date</div>
          <div className="flex items-center gap-3">
            <div className="w-14 h-14 rounded-xl bg-brand-50 border border-brand-200 text-brand-700 flex flex-col items-center justify-center leading-tight">
              <div className="text-[9px] uppercase tracking-wider">Day</div>
              <div className="text-xl font-bold">{dateDay}</div>
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-900">{dateDisplay}</div>
              <input
                type="date"
                className="text-xs text-slate-500 mt-1 outline-none"
                value={state.event_date}
                onChange={(e) => onChange({ event_date: e.target.value })}
              />
            </div>
          </div>
        </div>

        <div>
          <div className="text-[11px] uppercase tracking-widest text-slate-500 mb-2">Visibility</div>
          <Toggle
            checked={state.is_public}
            onChange={(v) => onChange({ is_public: v })}
            onLabel="Public"
            offLabel="Private"
          />
        </div>

        <div>
          <div className="text-[11px] uppercase tracking-widest text-slate-500 mb-2">
            Artists / Event Hosts
          </div>
          <div className="text-xs text-slate-500 mb-2">Choose / Search</div>
          {artists.length === 0 ? (
            <div className="text-xs text-slate-400 italic">
              No artists yet. Add them in Artists / Event Hosts.
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {artists.map((a) => {
                const selected = state.artist_ids.includes(a.id);
                return (
                  <button
                    type="button"
                    key={a.id}
                    onClick={() => toggleArtist(a.id)}
                    className={`text-xs px-2.5 py-1 rounded-full border transition ${
                      selected
                        ? 'bg-brand-500 border-brand-500 text-white'
                        : 'bg-white border-slate-200 text-slate-700 hover:border-slate-400'
                    }`}
                  >
                    {a.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Right column: title, description, venue, datetime, genre, tags */}
      <div className="space-y-4">
        <div>
          <label className="label">Event Title <span className="text-rose-600">*</span></label>
          <input
            className="input"
            value={state.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="Enter Event title"
          />
        </div>

        <div>
          <label className="label">Description</label>
          <RichTextEditor
            value={state.description}
            onChange={(html) => onChange({ description: html })}
            placeholder="Insert Text Here…"
            minHeight={180}
          />
        </div>

        <div>
          <label className="label">Choose Venue</label>
          <select
            className="input"
            value={state.venue_id}
            onChange={(e) => onChange({ venue_id: e.target.value })}
          >
            <option value="">To Be Disclosed</option>
            {venues.map((v) => (
              <option key={v.id} value={v.id}>{v.name} · {v.city}</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Start Date</label>
            <input
              className="input"
              type="date"
              value={state.event_date}
              onChange={(e) => onChange({ event_date: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Start Time</label>
            <input
              className="input"
              type="time"
              value={state.start_time}
              onChange={(e) => onChange({ start_time: e.target.value })}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Genre</label>
            <select
              className="input"
              value={state.genre}
              onChange={(e) => onChange({ genre: e.target.value })}
            >
              <option value="">Select genre</option>
              {GENRES.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Tags</label>
            <div className="input flex flex-wrap items-center gap-1 min-h-[42px] py-1.5">
              {state.tags.map((t) => (
                <span key={t} className="inline-flex items-center gap-1 bg-brand-100 text-brand-700 text-xs rounded-full pl-2.5 pr-1 py-0.5">
                  {t}
                  <button
                    type="button"
                    onClick={() => removeTag(t)}
                    className="hover:bg-brand-200 rounded-full p-0.5"
                    aria-label={`Remove tag ${t}`}
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 6L6 18M6 6l12 12"/>
                    </svg>
                  </button>
                </span>
              ))}
              <input
                className="flex-1 min-w-[80px] outline-none text-sm bg-transparent"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={handleTagKey}
                onBlur={() => tagInput && addTag(tagInput)}
                placeholder={state.tags.length === 0 ? 'Type & press comma or enter' : ''}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Toggle({ checked, onChange, onLabel, offLabel }: {
  checked: boolean; onChange: (v: boolean) => void; onLabel: string; offLabel: string;
}) {
  return (
    <div className="inline-flex items-center gap-3">
      <span className={`text-xs whitespace-nowrap ${checked ? 'text-slate-900 font-medium' : 'text-slate-400'}`}>{onLabel}</span>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative w-9 h-5 rounded-full transition flex-shrink-0 ${checked ? 'bg-brand-500' : 'bg-slate-300'}`}
        aria-pressed={checked}
      >
        <span
          className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-[18px]' : 'translate-x-0.5'
          }`}
        />
      </button>
      <span className={`text-xs whitespace-nowrap ${!checked ? 'text-slate-900 font-medium' : 'text-slate-400'}`}>{offLabel}</span>
    </div>
  );
}
